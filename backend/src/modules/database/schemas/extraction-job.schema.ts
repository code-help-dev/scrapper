import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { JobStatus, JobType } from '../../../common/enums/job-status.enum';

export type ExtractionJobDocument = ExtractionJob & Document;

@Schema({ _id: false })
export class RetryHistoryEntry {
  @Prop({ type: Date, default: Date.now })
  attemptedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  initiatedBy: Types.ObjectId | null;

  @Prop({ type: String, enum: JobStatus })
  previousStatus: JobStatus;

  @Prop({ default: 0 }) previousProcessedCount: number;
  @Prop({ default: 0 }) previousFailedCount: number;
  @Prop({ default: 0 }) previousTotalProducts: number;

  @Prop({ type: String, default: null })
  previousErrorMessage: string | null;
}

export const RetryHistoryEntrySchema = SchemaFactory.createForClass(RetryHistoryEntry);

@Schema({ timestamps: true })
export class ExtractionJob {
  @Prop({ required: true })
  sourceUrl: string;

  @Prop({ type: String, enum: JobType, default: JobType.SINGLE })
  jobType: JobType;

  @Prop({ type: String, enum: JobStatus, default: JobStatus.QUEUED })
  status: JobStatus;

  @Prop({ default: 0 }) totalProducts: number;
  @Prop({ default: 0 }) processedCount: number;
  @Prop({ default: 0 }) failedCount: number;
  @Prop({ default: 0 }) attempts: number;

  @Prop({ type: String, default: null })
  errorMessage: string | null;

  @Prop({ type: [Types.ObjectId], ref: 'Product', default: [] })
  productIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'ExtractionJob', default: null })
  parentJobId: Types.ObjectId | null;

  @Prop({ type: Date, default: null }) startedAt: Date | null;
  @Prop({ type: Date, default: null }) completedAt: Date | null;
  @Prop({ type: Date, default: null }) pausedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  submittedBy: Types.ObjectId;

  @Prop({ default: 0 }) retryCount: number;

  @Prop({ type: Date, default: null })
  lastRetriedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lastRetriedBy: Types.ObjectId | null;

  @Prop({ type: [RetryHistoryEntrySchema], default: [] })
  retryHistory: RetryHistoryEntry[];
}

export const ExtractionJobSchema = SchemaFactory.createForClass(ExtractionJob);

ExtractionJobSchema.index({ status: 1 });
ExtractionJobSchema.index({ submittedBy: 1 });
ExtractionJobSchema.index({ createdAt: -1 });
ExtractionJobSchema.index({ status: 1, createdAt: -1 });
ExtractionJobSchema.index({ sourceUrl: 1 });
ExtractionJobSchema.index({ productIds: 1 });
ExtractionJobSchema.index({ parentJobId: 1 });
