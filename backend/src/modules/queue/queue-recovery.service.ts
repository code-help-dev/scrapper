import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { JobStatus } from '../../common/enums/job-status.enum';
import { DynamicQueueService } from './dynamic-queue.service';
import { ScrapeUrlPayload } from './processors/extraction.processor';

const AAJJO_PRODUCT_RE = /^https?:\/\/(www\.)?aajjo\.com\/product\//i;

@Injectable()
export class QueueRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueRecoveryService.name);

  constructor(
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Mark stale PROCESSING jobs as failed — they lost their worker on restart
    const stale = await this.jobModel.updateMany(
      { status: JobStatus.PROCESSING },
      {
        $set: {
          status: JobStatus.FAILED,
          errorMessage: 'Server restarted while job was processing — retry manually',
          completedAt: new Date(),
        },
      },
    );

    if (stale.modifiedCount > 0) {
      this.logger.warn(
        `Recovered ${stale.modifiedCount} stale "processing" job(s) → marked as "failed"`,
      );
    }

    // Re-enqueue orphaned QUEUED jobs — these have no BullMQ entry because the
    // server crashed after the MongoDB save but before addJob() completed
    const orphaned = await this.jobModel
      .find({ status: JobStatus.QUEUED })
      .lean()
      .exec();

    let requeued = 0;
    for (const job of orphaned) {
      const userId = job.submittedBy.toString();
      const jobId = job._id.toString();

      const bullJob = await this.dynamicQueueService.getBullJob(userId, jobId);
      if (bullJob) continue; // already in BullMQ — not orphaned

      try {
        await this.dynamicQueueService.addJob(userId, {
          jobId,
          sourceUrl: job.sourceUrl,
          userId,
          isDiscovery: !AAJJO_PRODUCT_RE.test(job.sourceUrl),
        } satisfies ScrapeUrlPayload);
        requeued++;
      } catch (err: any) {
        this.logger.warn(`Failed to re-enqueue orphaned job ${jobId}: ${err.message}`);
      }
    }

    if (requeued > 0) {
      this.logger.log(`Re-enqueued ${requeued} orphaned "queued" job(s)`);
    }
  }
}
