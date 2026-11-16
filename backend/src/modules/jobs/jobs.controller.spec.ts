import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { ExtractionJob } from '../database/schemas/extraction-job.schema';
import { Product } from '../database/schemas/product.schema';
import { DynamicQueueService } from '../queue/dynamic-queue.service';
import { JobStatus } from '../../common/enums/job-status.enum';

// Minimal chainable query-builder mock covering the .select()/.sort()/.skip()/
// .limit()/.lean()/.exec() calls the controller actually makes — every method
// returns the same object so any subset/order of chaining resolves fine.
function chainable(resolvedValue: unknown) {
  const obj: any = {};
  ['select', 'sort', 'skip', 'limit', 'lean'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.exec = jest.fn().mockResolvedValue(resolvedValue);
  return obj;
}

describe('JobsController', () => {
  let controller: JobsController;
  let jobModel: any;
  let productModel: any;
  let queueService: any;

  const user = { id: '507f1f77bcf86cd799439011', role: 'operator' };

  const makeJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'job1',
    _id: 'job1',
    submittedBy: { toString: () => user.id },
    status: JobStatus.FAILED,
    processedCount: 1,
    failedCount: 2,
    totalProducts: 3,
    errorMessage: 'boom',
    sourceUrl: 'https://www.aajjo.com/product/x',
    productIds: [],
    ...overrides,
  });

  beforeEach(async () => {
    jobModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };
    productModel = { find: jest.fn() };
    queueService = {
      removeJob: jest.fn().mockResolvedValue(undefined),
      addJob: jest.fn().mockResolvedValue(undefined),
      getBullJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: getModelToken(ExtractionJob.name), useValue: jobModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: DynamicQueueService, useValue: queueService },
      ],
    }).compile();

    controller = module.get(JobsController);
  });

  describe('bulkRetry', () => {
    it('rejects when no selector, or more than one selector, is provided', async () => {
      await expect(controller.bulkRetry({} as any, user)).rejects.toThrow(BadRequestException);
      await expect(
        controller.bulkRetry({ jobIds: ['a'], all: true } as any, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('removes the BullMQ entry before re-adding it (regression: silent no-op retry bug)', async () => {
      const job = makeJob();
      jobModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([job]) });

      const callOrder: string[] = [];
      queueService.removeJob.mockImplementation(async () => { callOrder.push('remove'); });
      queueService.addJob.mockImplementation(async () => { callOrder.push('add'); });
      jobModel.findByIdAndUpdate.mockResolvedValue(undefined);

      const result = await controller.bulkRetry({ jobIds: ['job1'] } as any, user);

      expect(callOrder).toEqual(['remove', 'add']);
      expect(result).toEqual({ requested: 1, retried: 1, failed: [] });
    });

    it('snapshots history, caps retryHistory at 20, and bumps retryCount atomically', async () => {
      const job = makeJob();
      jobModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([job]) });
      let capturedUpdate: any;
      jobModel.findByIdAndUpdate.mockImplementation((_id: string, update: any) => {
        capturedUpdate = update;
        return Promise.resolve(undefined);
      });

      await controller.bulkRetry({ jobIds: ['job1'] } as any, user);

      expect(capturedUpdate.$set.status).toBe(JobStatus.QUEUED);
      expect(capturedUpdate.$set.processedCount).toBe(0);
      expect(capturedUpdate.$inc.retryCount).toBe(1);
      expect(capturedUpdate.$push.retryHistory.$slice).toBe(-20);
      expect(capturedUpdate.$push.retryHistory.$each[0].previousStatus).toBe(JobStatus.FAILED);
      expect(capturedUpdate.$push.retryHistory.$each[0].previousErrorMessage).toBe('boom');
    });

    it('"all" mode retries only FAILED jobs, never COMPLETED ones', async () => {
      const findSpy = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      jobModel.find = findSpy;

      await controller.bulkRetry({ all: true } as any, user);

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.status).toBe(JobStatus.FAILED);
    });

    it('onlyFlagged mode matches jobs whose productIds include a flagged product', async () => {
      productModel.find.mockReturnValue(chainable([{ _id: 'flaggedProd1' }]));
      const findSpy = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      jobModel.find = findSpy;

      await controller.bulkRetry({ onlyFlagged: true } as any, user);

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.productIds).toEqual({ $in: ['flaggedProd1'] });
      expect(filterArg.status).toEqual({ $in: [JobStatus.FAILED, JobStatus.COMPLETED] });
    });
  });

  describe('bulkDelete', () => {
    it('requires confirm to be true', async () => {
      await expect(
        controller.bulkDelete({ all: true, confirm: false } as any, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires exactly one selector', async () => {
      await expect(controller.bulkDelete({ confirm: true } as any, user)).rejects.toThrow(BadRequestException);
      await expect(
        controller.bulkDelete({ jobIds: ['a'], all: true, confirm: true } as any, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('cascades to child jobs and removes each BullMQ entry before deleting the doc', async () => {
      const parent = { _id: 'p1', submittedBy: { toString: () => user.id } };
      const child = { _id: 'c1', submittedBy: { toString: () => user.id } };

      jobModel.find
        .mockReturnValueOnce(chainable([parent])) // targets
        .mockReturnValueOnce(chainable([child])); // children

      const callOrder: string[] = [];
      queueService.removeJob.mockImplementation(async () => { callOrder.push('removeJob'); });
      jobModel.deleteOne.mockImplementation(() => {
        callOrder.push('deleteOne');
        return { exec: jest.fn().mockResolvedValue(undefined) };
      });

      const result = await controller.bulkDelete({ jobIds: ['p1'], confirm: true } as any, user);

      expect(result).toEqual({ requested: 2, deleted: 2, failed: [] });
      expect(queueService.removeJob).toHaveBeenCalledTimes(2);
      expect(jobModel.deleteOne).toHaveBeenCalledTimes(2);
      // each job's BullMQ entry is removed before its doc is deleted
      expect(callOrder).toEqual(['removeJob', 'deleteOne', 'removeJob', 'deleteOne']);
    });

    it('does not double-count a child that is also an explicit target', async () => {
      const parent = { _id: 'p1', submittedBy: { toString: () => user.id } };

      jobModel.find
        .mockReturnValueOnce(chainable([parent]))
        .mockReturnValueOnce(chainable([parent])); // "child" query happens to return the same doc

      jobModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

      const result = await controller.bulkDelete({ jobIds: ['p1'], confirm: true } as any, user);

      expect(result.requested).toBe(1);
      expect(jobModel.deleteOne).toHaveBeenCalledTimes(1);
    });

    it('status=flagged resolves flagged product ids and matches on productIds', async () => {
      productModel.find.mockReturnValue(chainable([{ _id: 'flaggedProd1' }]));
      const findSpy = jest.fn().mockReturnValue(chainable([]));
      jobModel.find = findSpy;

      await controller.bulkDelete({ status: 'flagged', confirm: true } as any, user);

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.productIds).toEqual({ $in: ['flaggedProd1'] });
    });
  });

  describe('findAll', () => {
    it('merges flagged product ids into the filter when flagged=true', async () => {
      productModel.find.mockReturnValueOnce(chainable([{ _id: 'flaggedProd1' }]));
      jobModel.find.mockReturnValueOnce(chainable([]));
      jobModel.countDocuments.mockReturnValueOnce(chainable(0));

      const result = await controller.findAll(user, 1, 20, undefined, undefined, 'true');

      const filterArg = jobModel.find.mock.calls[0][0];
      expect(filterArg.productIds).toEqual({ $in: ['flaggedProd1'] });
      expect(result.data).toEqual([]);
    });

    it('marks rows whose linked product is flagged, without a full-collection scan', async () => {
      const job = makeJob({ productIds: ['prodA', 'prodB'] });
      jobModel.find.mockReturnValueOnce(chainable([job]));
      jobModel.countDocuments.mockReturnValueOnce(chainable(1));
      productModel.find.mockReturnValueOnce(chainable([{ _id: 'prodA' }]));

      const result = await controller.findAll(user, 1, 20);

      expect(result.data[0]).toMatchObject({ hasFlaggedProduct: true });
      // bounded to this page's productIds, not every flagged product in the system
      const perPageFilterArg = productModel.find.mock.calls[0][0];
      expect(perPageFilterArg._id).toEqual({ $in: ['prodA', 'prodB'] });
    });
  });
});
