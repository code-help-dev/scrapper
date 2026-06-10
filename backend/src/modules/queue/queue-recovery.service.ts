import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { JobStatus } from '../../common/enums/job-status.enum';

/**
 * B5: When the server restarts, any jobs left in "processing" state were
 * interrupted mid-run (BullMQ worker died). Reset them to "failed" so they
 * appear in the failed-jobs panel and can be retried manually.
 */
@Injectable()
export class QueueRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueRecoveryService.name);

  constructor(
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
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
        `B5: Recovered ${stale.modifiedCount} stale "processing" job(s) → marked as "failed"`,
      );
    }
  }
}
