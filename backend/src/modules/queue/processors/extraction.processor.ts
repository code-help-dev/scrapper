import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import {
  QUEUE_IMAGE,
  JOB_PROCESS_IMAGE,
} from '../queue.constants';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../../database/schemas/extraction-job.schema';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { JobStatus, JobType } from '../../../common/enums/job-status.enum';
import { ExtractionStatus } from '../../../common/enums/extraction-status.enum';
import { ScraperService } from '../../scraper/scraper.service';
import { ExtractorService } from '../../extractor/extractor.service';
import { NormalizationService } from '../../normalization/normalization.service';
import { SellersService } from '../../sellers/sellers.service';
import { DynamicQueueService } from '../dynamic-queue.service';

export interface ScrapeUrlPayload {
  jobId: string;
  sourceUrl: string;
  userId: string;
  isDiscovery?: boolean; 
  parentJobId?: string;  
}

export interface ProcessImagePayload {
  productId: string;
  images: { originalUrl: string; isFeatured: boolean }[];
}

@Injectable()
export class ExtractionProcessor {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectQueue(QUEUE_IMAGE)
    private readonly imageQueue: Queue,
    @Inject(forwardRef(() => DynamicQueueService))
    private readonly dynamicQueueService: DynamicQueueService,
    private readonly scraperService: ScraperService,
    private readonly extractorService: ExtractorService,
    private readonly normalizationService: NormalizationService,
    private readonly sellersService: SellersService,
  ) {}

  async process(job: Job<ScrapeUrlPayload>): Promise<void> {
    const { jobId, sourceUrl, userId, isDiscovery, parentJobId } = job.data;

    await this.jobModel.findByIdAndUpdate(jobId, {
      status: JobStatus.PROCESSING,
      startedAt: new Date(),
      $inc: { attempts: 1 },
    });

    try {
      if (isDiscovery) {
        await this.processDiscovery(jobId, sourceUrl, userId);
      } else {
        await this.processProduct(jobId, sourceUrl, userId);
        await this.bumpParent(parentJobId, 'processedCount');
      }
    } catch (error: any) {
      this.logger.error(`[${jobId}] Failed: ${error.message}`);
      await this.jobModel.findByIdAndUpdate(jobId, {
        status: JobStatus.FAILED,
        errorMessage: error.message,
        completedAt: new Date(),
      });
      if (!isDiscovery) await this.bumpParent(parentJobId, 'failedCount');
      throw error;
    }
  }

  private async bumpParent(
    parentJobId: string | undefined,
    field: 'processedCount' | 'failedCount',
  ): Promise<void> {
    if (!parentJobId) return;
    const parent = await this.jobModel.findByIdAndUpdate(
      parentJobId,
      { $inc: { [field]: 1 } },
      { new: true },
    );
    if (
      parent &&
      parent.status !== JobStatus.COMPLETED &&
      parent.totalProducts > 0 &&
      parent.processedCount + parent.failedCount >= parent.totalProducts
    ) {
      await this.jobModel.findByIdAndUpdate(parentJobId, {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      });
    }
  }

  private async processDiscovery(jobId: string, listingUrl: string, userId: string): Promise<void> {
    this.logger.log(`[${jobId}] Discovery: scanning ${listingUrl}`);

    const productUrls = await this.scraperService.discoverProductUrls(listingUrl);
    this.logger.log(`[${jobId}] Discovered ${productUrls.length} products`);

    let queued = 0;
    for (const url of productUrls) {
      
      const exists = await this.productModel.exists({ sourceUrl: url });
      if (exists) continue;

      const childJob = new this.jobModel({
        sourceUrl: url,
        jobType: JobType.BULK,
        status: JobStatus.QUEUED,
        submittedBy: new Types.ObjectId(userId),
        parentJobId: new Types.ObjectId(jobId),
      });
      await childJob.save();

      await this.dynamicQueueService.addJob(userId, {
        jobId: childJob.id,
        sourceUrl: url,
        userId,
        parentJobId: jobId,
      } satisfies ScrapeUrlPayload);
      queued++;
    }

    if (queued === 0) {
      const reason = productUrls.length === 0
        ? 'No product URLs found on listing page'
        : `All ${productUrls.length} discovered products are already in the database`;
      this.logger.warn(`[${jobId}] Discovery completed with 0 new jobs: ${reason}`);
      await this.jobModel.findByIdAndUpdate(jobId, {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
        totalProducts: productUrls.length,
        processedCount: 0,
        errorMessage: reason,
      });
    } else {
      await this.jobModel.findByIdAndUpdate(jobId, {
        status: JobStatus.PROCESSING,
        totalProducts: queued,
        processedCount: 0,
        failedCount: 0,
      });
    }

    this.logger.log(`[${jobId}] Discovery done — ${queued} product jobs queued`);
  }

  private async processProduct(jobId: string, sourceUrl: string, userId: string): Promise<void> {
    this.logger.log(`[${jobId}] Extracting ${sourceUrl}`);

    const extracted = await this.scraperService.withPage(
      sourceUrl,
      (page) => this.extractorService.extractProduct(page, sourceUrl),
    );

    const normalized = this.normalizationService.normalize(extracted);

    const contentHash = createHash('sha256')
      .update(`${normalized.productName}::${sourceUrl}`)
      .digest('hex');

    const savedProduct = await this.productModel.findOneAndUpdate(
      { sourceUrl },
      {
        $set: {
          productName: normalized.productName,
          category: normalized.category,
          subCategory: normalized.subCategory,
          price: normalized.price,
          currency: normalized.currency,
          priceUnit: normalized.priceUnit,
          moq: normalized.moq,
          description: normalized.description,
          deliveryInformation: normalized.deliveryInformation,
          warrantyInformation: normalized.warrantyInformation,
          specifications: normalized.specifications,
          seller: normalized.seller,
          images: normalized.images.map((img) => ({
            originalUrl: img.originalUrl,
            isFeatured: img.isFeatured,
            storageUrl: '',
            s3Key: '',
            thumbnailUrl: '',
            format: '',
          })),
          extractionStatus: ExtractionStatus.COMPLETED,
          confidenceScore: normalized.confidenceScore,
          isFlagged: normalized.confidenceScore < 70,
          contentHash,
          sourcePlatform: 'aajjo',
          ownedBy: new Types.ObjectId(userId),
        },
      },
      { upsert: true, new: true },
    );

    this.logger.log(
      `[${jobId}] Saved "${normalized.productName}" — confidence: ${normalized.confidenceScore}%`,
    );

    await this.sellersService.upsertFromProduct(normalized.seller);

    if (normalized.category) {
      try {
        const slug = normalized.category
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        const cat = await this.categoryModel.findOneAndUpdate(
          { slug },
          {
            $setOnInsert: { name: normalized.category, slug },
            $inc: { productCount: 1 },
          },
          { upsert: true, new: true },
        );

        if (normalized.subCategory) {
          const normalizedSubName = normalized.subCategory.trim();
          const subSlug = normalizedSubName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          await this.categoryModel.updateOne(
            { _id: cat._id, 'subCategories.slug': { $ne: subSlug } },
            { $push: { subCategories: { name: normalizedSubName, slug: subSlug } } },
          );
        }

        await this.productModel.findByIdAndUpdate(savedProduct.id, { categoryId: cat._id });
      } catch (e: any) {
        this.logger.warn(`[${jobId}] Category upsert failed: ${e.message}`);
      }
    }

    if (normalized.images.length > 0) {
      await this.imageQueue.add(
        JOB_PROCESS_IMAGE,
        { productId: savedProduct.id, images: normalized.images } satisfies ProcessImagePayload,
        { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
      );
    }

    await this.jobModel.findByIdAndUpdate(jobId, {
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
      processedCount: 1,
      productIds: [new Types.ObjectId(savedProduct.id)],
      errorMessage: null,
    });
  }
}
