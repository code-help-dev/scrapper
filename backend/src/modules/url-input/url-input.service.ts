import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { JobStatus, JobType } from '../../common/enums/job-status.enum';
import { QUEUE_EXTRACTION, JOB_SCRAPE_URL } from '../queue/queue.constants';
import { ScrapeUrlPayload } from '../queue/processors/extraction.processor';

const AAJJO_DOMAIN_RE = /^https?:\/\/(www\.)?aajjo\.com\//i;
// B2 fix: product URLs always have /product/ in the path
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
    @InjectQueue(QUEUE_EXTRACTION)
    private readonly extractionQueue: Queue,
  ) {}

  // ── Validation ────────────────────────────────────────────────────────────

  validateAajjoUrl(url: string): void {
    if (!AAJJO_DOMAIN_RE.test(url)) {
      throw new BadRequestException(
        `URL must belong to aajjo.com — received: ${url}`,
      );
    }
  }

  // B2 fix: detect whether URL is a single product page or a category/listing page
  isProductUrl(url: string): boolean {
    return AAJJO_PRODUCT_RE.test(url);
  }

  // B7 fix: check ExtractionJob collection for pending/processing jobs on same URL
  // (was checking Product — if a job failed before creating a product, URL couldn't be resubmitted)
  async checkDuplicate(url: string): Promise<void> {
    const activeJob = await this.jobModel
      .exists({ sourceUrl: url, status: { $in: ['queued', 'processing'] } })
      .exec();
    if (activeJob) {
      throw new ConflictException(
        `This URL already has an active job in the queue: ${url}`,
      );
    }
    const completed = await this.productModel.exists({ sourceUrl: url }).exec();
    if (completed) {
      throw new ConflictException(
        `This URL has already been successfully scraped: ${url}`,
      );
    }
  }

  // ── Enqueue a single known product URL ───────────────────────────────────

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

    await this.extractionQueue.add(
      JOB_SCRAPE_URL,
      { jobId: job.id, sourceUrl: url, userId } satisfies ScrapeUrlPayload,
      { jobId: job.id },
    );

    return job;
  }

  // ── Single URL submission (handles both product + category pages) ─────────

  async submitSingle(
    url: string,
    userId: string,
    label?: string,
  ): Promise<{ job?: ExtractionJobDocument; discoveryJob?: ExtractionJobDocument; type: 'product' | 'category'; message: string }> {
    this.validateAajjoUrl(url);

    // B2 fix: if it's a category/listing page, queue a discovery job
    if (!this.isProductUrl(url)) {
      this.logger.log(`Category URL detected — queueing discovery job: ${url}`);

      const discoveryJob = new this.jobModel({
        sourceUrl: url,
        jobType: JobType.SINGLE,
        status: JobStatus.QUEUED,
        submittedBy: new Types.ObjectId(userId),
      });
      await discoveryJob.save();

      await this.extractionQueue.add(
        JOB_SCRAPE_URL,
        { jobId: discoveryJob.id, sourceUrl: url, userId, isDiscovery: true } as ScrapeUrlPayload & { isDiscovery: boolean },
        { jobId: discoveryJob.id },
      );

      return {
        discoveryJob,
        type: 'category',
        message: `Category page detected — products will be discovered and queued automatically. Discovery job ID: ${discoveryJob.id}`,
      };
    }

    // Direct product URL
    await this.checkDuplicate(url);
    const job = await this.enqueueProductUrl(url, userId);
    this.logger.log(`Product job queued [${job.id}] → ${url}`);

    return {
      job,
      type: 'product',
      message: `Product queued for extraction. Job ID: ${job.id}`,
    };
  }

  // ── CSV buffer parser ─────────────────────────────────────────────────────

  parseCsvBuffer(buffer: Buffer): string[] {
    return buffer
      .toString('utf-8')
      .split(/[\r\n]+/)
      .map((line) => line.trim().split(',')[0].trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  // ── Bulk URL submission ───────────────────────────────────────────────────

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
        await this.checkDuplicate(url);

        if (!this.isProductUrl(url)) {
          // For bulk: skip category pages, only accept direct product URLs
          skipped.push({ url, reason: 'Not a product URL — bulk mode only accepts /product/ URLs' });
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
