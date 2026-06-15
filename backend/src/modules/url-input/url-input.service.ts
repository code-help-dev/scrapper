import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { JobStatus, JobType } from '../../common/enums/job-status.enum';
import { ScrapeUrlPayload } from '../queue/processors/extraction.processor';
import { DynamicQueueService } from '../queue/dynamic-queue.service';

const AAJJO_DOMAIN_RE = /^https?:\/\/(www\.)?aajjo\.com\//i;
const AAJJO_PRODUCT_RE = /^https?:\/\/(www\.)?aajjo\.com\/product\//i;
const MAX_BULK = 500;

@Injectable()
export class UrlInputService {
  private readonly logger = new Logger(UrlInputService.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  validateAajjoUrl(url: string): void {
    if (!AAJJO_DOMAIN_RE.test(url)) {
      throw new BadRequestException(
        `URL must belong to aajjo.com — received: ${url}`,
      );
    }
  }

  isProductUrl(url: string): boolean {
    return AAJJO_PRODUCT_RE.test(url);
  }

  async checkDuplicate(url: string): Promise<{ isDuplicate: boolean; reason?: string }> {
    const activeJob = await this.jobModel
      .exists({ sourceUrl: url, status: { $in: ['queued', 'processing'] } })
      .exec();
    if (activeJob) {
      return { isDuplicate: true, reason: `URL already has an active job in the queue` };
    }
    const completed = await this.productModel.exists({ sourceUrl: url }).exec();
    if (completed) {
      return { isDuplicate: true, reason: `URL already processed — product exists in the catalog` };
    }
    return { isDuplicate: false };
  }

  async enqueueProductUrl(
    url: string,
    userId: string,
    jobType: JobType = JobType.SINGLE,
  ): Promise<ExtractionJobDocument> {
    const job = new this.jobModel({
      sourceUrl: url,
      jobType,
      status: JobStatus.QUEUED,
      submittedBy: new Types.ObjectId(userId),
    });
    await job.save();

    await this.dynamicQueueService.addJob(userId, {
      jobId: job.id,
      sourceUrl: url,
      userId,
    } satisfies ScrapeUrlPayload);

    return job;
  }

  async submitSingle(
    url: string,
    userId: string,
    label?: string,
  ): Promise<{ job?: ExtractionJobDocument; discoveryJob?: ExtractionJobDocument; type: 'product' | 'category'; skipped?: boolean; message: string }> {
    this.validateAajjoUrl(url);

    if (!this.isProductUrl(url)) {
      this.logger.log(`Category URL detected — queueing discovery job: ${url}`);

      const discoveryJob = new this.jobModel({
        sourceUrl: url,
        jobType: JobType.SINGLE,
        status: JobStatus.QUEUED,
        submittedBy: new Types.ObjectId(userId),
      });
      await discoveryJob.save();

      await this.dynamicQueueService.addJob(userId, {
        jobId: discoveryJob.id,
        sourceUrl: url,
        userId,
        isDiscovery: true,
      } satisfies ScrapeUrlPayload);

      return {
        discoveryJob,
        type: 'category',
        message: `Category page detected — products will be discovered and queued automatically. Discovery job ID: ${discoveryJob.id}`,
      };
    }

    const duplicate = await this.checkDuplicate(url);
    if (duplicate.isDuplicate) {
      this.logger.log(`Skipping duplicate URL: ${url} — ${duplicate.reason}`);
      return {
        type: 'product',
        skipped: true,
        message: duplicate.reason!,
      };
    }

    const job = await this.enqueueProductUrl(url, userId);
    this.logger.log(`Product job queued [${job.id}] → ${url}`);

    return {
      job,
      type: 'product',
      message: `Product queued for extraction. Job ID: ${job.id}`,
    };
  }

  parseCsvBuffer(buffer: Buffer): string[] {
    return buffer
      .toString('utf-8')
      .split(/[\r\n]+/)
      .map((line) => line.trim().split(',')[0].trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  async submitBulk(
    urls: string[],
    userId: string,
  ): Promise<{
    queued: ExtractionJobDocument[];
    skipped: { url: string; reason: string }[];
  }> {
    if (urls.length > MAX_BULK) {
      throw new BadRequestException(
        `Maximum ${MAX_BULK} URLs per batch — received ${urls.length}`,
      );
    }

    const queued: ExtractionJobDocument[] = [];
    const skipped: { url: string; reason: string }[] = [];

    for (const url of urls) {
      try {
        this.validateAajjoUrl(url);

        if (!this.isProductUrl(url)) {
          
          const activeJob = await this.jobModel
            .exists({ sourceUrl: url, status: { $in: ['queued', 'processing'] } })
            .exec();
          if (activeJob) {
            skipped.push({ url, reason: `This URL already has an active discovery job in the queue: ${url}` });
            continue;
          }

          const discoveryJob = new this.jobModel({
            sourceUrl: url,
            jobType: JobType.BULK,
            status: JobStatus.QUEUED,
            submittedBy: new Types.ObjectId(userId),
          });
          await discoveryJob.save();
          await this.dynamicQueueService.addJob(userId, {
            jobId: discoveryJob.id,
            sourceUrl: url,
            userId,
            isDiscovery: true,
          } satisfies ScrapeUrlPayload);
          queued.push(discoveryJob);
          continue;
        }

        const duplicate = await this.checkDuplicate(url);
        if (duplicate.isDuplicate) {
          skipped.push({ url, reason: duplicate.reason! });
          continue;
        }
        const job = await this.enqueueProductUrl(url, userId, JobType.BULK);
        queued.push(job);
      } catch (err: any) {
        skipped.push({ url, reason: err.message });
      }
    }

    this.logger.log(`Bulk: ${queued.length} queued, ${skipped.length} skipped`);
    return { queued, skipped };
  }
}
