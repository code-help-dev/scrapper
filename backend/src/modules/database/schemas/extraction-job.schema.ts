import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { JobStatus, JobType } from '../../../common/enums/job-status.enum';

export type ExtractionJobDocument = ExtractionJob & Document;

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

  // Set on child product jobs spawned by a category/listing discovery job.
  // Lets the discovery (batch) job aggregate live scrape progress.
  @Prop({ type: Types.ObjectId, ref: 'ExtractionJob', default: null })
  parentJobId: Types.ObjectId | null;

  @Prop({ type: Date, default: null }) startedAt: Date | null;
  @Prop({ type: Date, default: null }) completedAt: Date | null;
  @Prop({ type: Date, default: null }) pausedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  submittedBy: Types.ObjectId;
}

export const ExtractionJobSchema = SchemaFactory.createForClass(ExtractionJob);

ExtractionJobSchema.index({ status: 1 });
ExtractionJobSchema.index({ submittedBy: 1 });
ExtractionJobSchema.index({ createdAt: -1 });
ExtractionJobSchema.index({ status: 1, createdAt: -1 });
ExtractionJobSchema.index({ sourceUrl: 1 });
