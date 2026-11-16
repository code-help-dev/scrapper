import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { Product } from '../database/schemas/product.schema';
import { Category } from '../database/schemas/category.schema';
import { ExtractionJob } from '../database/schemas/extraction-job.schema';
import { CacheService } from '../cache/cache.service';
import { ImageService } from '../image/image.service';

function chainable(resolvedValue: unknown) {
  const obj: any = {};
  ['select', 'sort', 'skip', 'limit', 'lean'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.exec = jest.fn().mockResolvedValue(resolvedValue);
  return obj;
}

describe('ProductsController', () => {
  let controller: ProductsController;
  let productModel: any;
  let extractionJobModel: any;
  let cacheService: any;
  let imageService: any;

  const user = { id: '507f1f77bcf86cd799439011', role: 'operator' };

  beforeEach(async () => {
    productModel = {
      find: jest.fn(),
      findById: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };
    extractionJobModel = { updateMany: jest.fn().mockResolvedValue(undefined) };
    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
    };
    imageService = { deleteImage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Category.name), useValue: {} },
        { provide: getModelToken(ExtractionJob.name), useValue: extractionJobModel },
        { provide: CacheService, useValue: cacheService },
        { provide: ImageService, useValue: imageService },
      ],
    }).compile();

    controller = module.get(ProductsController);
  });

  describe('bulkDelete', () => {
    it('requires confirm to be true', async () => {
      await expect(
        controller.bulkDelete({ productIds: ['a'], confirm: false } as any, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires exactly one of productIds or a non-empty filter', async () => {
      await expect(controller.bulkDelete({ confirm: true } as any, user)).rejects.toThrow(BadRequestException);
      await expect(
        controller.bulkDelete(
          { productIds: ['a'], filter: { flagged: true }, confirm: true } as any,
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('cleans up job references and images before deleting the doc, in that order', async () => {
      const productId = { toString: () => 'prod1' };
      productModel.find
        .mockReturnValueOnce(chainable([{ _id: productId }])) // id resolution for productIds mode
        .mockReturnValueOnce(
          chainable([{ _id: productId, images: [{ s3Key: 'img1' }, { s3Key: 'img2' }] }]),
        ); // fetch for image cleanup inside deleteProductsByIds

      const callOrder: string[] = [];
      extractionJobModel.updateMany.mockImplementation(async () => { callOrder.push('pullFromJobs'); });
      imageService.deleteImage.mockImplementation(async () => { callOrder.push('deleteImage'); });
      productModel.deleteOne.mockImplementation(() => {
        callOrder.push('deleteDoc');
        return { exec: jest.fn().mockResolvedValue(undefined) };
      });

      const result = await controller.bulkDelete({ productIds: ['prod1'], confirm: true } as any, user);

      expect(result).toEqual({ requested: 1, deleted: 1, failed: [] });
      expect(extractionJobModel.updateMany).toHaveBeenCalledTimes(1);
      expect(imageService.deleteImage).toHaveBeenCalledTimes(2);
      // referential cleanup, then S3 cleanup, then the doc itself — see comment in deleteProductsByIds
      expect(callOrder).toEqual(['pullFromJobs', 'deleteImage', 'deleteImage', 'deleteDoc']);
      expect(cacheService.delPattern).toHaveBeenCalledWith('products:*');
    });

    it('filter mode resolves matching ids first, without requiring an explicit id list', async () => {
      const findSpy = jest.fn();
      findSpy
        .mockReturnValueOnce(chainable([{ _id: 'flaggedA' }, { _id: 'flaggedB' }]))
        .mockReturnValueOnce(chainable([])); // no products found for the (mocked) image-fetch step
      productModel.find = findSpy;
      productModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

      const result = await controller.bulkDelete(
        { filter: { flagged: true }, confirm: true } as any,
        user,
      );

      const matchFilterArg = findSpy.mock.calls[0][0];
      expect(matchFilterArg.isFlagged).toBe(true);
      expect(result.requested).toBe(2);
    });

    it('reports per-product failures without aborting the rest of the batch', async () => {
      const idOk = { toString: () => 'ok' };
      const idBad = { toString: () => 'bad' };
      productModel.find
        .mockReturnValueOnce(chainable([{ _id: idOk }, { _id: idBad }]))
        .mockReturnValueOnce(chainable([{ _id: idOk, images: [] }, { _id: idBad, images: [] }]));

      productModel.deleteOne.mockImplementation((query: any) => ({
        exec: () =>
          query._id === idBad
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(undefined),
      }));

      const result = await controller.bulkDelete(
        { productIds: ['ok', 'bad'], confirm: true } as any,
        user,
      );

      expect(result.deleted).toBe(1);
      expect(result.failed).toEqual([{ id: 'bad', reason: 'boom' }]);
    });
  });

  describe('remove (single delete)', () => {
    it('reuses the same cleanup path as bulk-delete (image + job reference cleanup)', async () => {
      const product = { _id: { toString: () => 'prod1' }, ownedBy: { toString: () => user.id } };
      productModel.findById.mockReturnValue(chainable(product));
      productModel.find.mockReturnValueOnce(
        chainable([{ _id: product._id, images: [{ s3Key: 'img1' }] }]),
      );
      productModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });

      await controller.remove('prod1', user);

      expect(extractionJobModel.updateMany).toHaveBeenCalledTimes(1);
      expect(imageService.deleteImage).toHaveBeenCalledWith('img1');
      expect(cacheService.delPattern).toHaveBeenCalledWith('products:*');
    });
  });

  describe('findAll confidence filter', () => {
    it('builds a confidenceScore range from minConfidence/maxConfidence and sorts by it', async () => {
      const findSpy = jest.fn().mockReturnValue(chainable([]));
      productModel.find = findSpy;
      productModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await controller.findAll(
        user, 1, 20, undefined, undefined, undefined, undefined, undefined, undefined,
        40, 60, 'confidence', 'asc',
      );

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.confidenceScore).toEqual({ $gte: 40, $lte: 60 });
    });

    // Regression: Nest's global ValidationPipe (enableImplicitConversion) turns an
    // absent optional `@Query() x?: number` into Number(undefined) = NaN, not
    // undefined. A naive `!== undefined` check missed this and built
    // {confidenceScore: {$gte: NaN, $lte: NaN}} on every plain "no filter" request,
    // which matches zero documents — this silently hid every product on the list page.
    it('does not filter by confidence when Nest coerces absent query params to NaN', async () => {
      const findSpy = jest.fn().mockReturnValue(chainable([]));
      productModel.find = findSpy;
      productModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await controller.findAll(
        user, 1, 20, undefined, undefined, undefined, undefined, undefined, undefined,
        NaN, NaN, undefined, undefined,
      );

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.confidenceScore).toBeUndefined();
    });
  });

  describe('findAll search', () => {
    it('builds a case-insensitive, regex-escaped productName filter from search', async () => {
      const findSpy = jest.fn().mockReturnValue(chainable([]));
      productModel.find = findSpy;
      productModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await controller.findAll(
        user, 1, 20, undefined, undefined, undefined, undefined, 'epson (l1800)',
      );

      const filterArg = findSpy.mock.calls[0][0];
      expect(filterArg.productName).toEqual({ $regex: 'epson \\(l1800\\)', $options: 'i' });
    });
  });
});
