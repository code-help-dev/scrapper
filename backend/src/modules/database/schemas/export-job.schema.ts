import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ExportFormat, ExportStatus } from '../../../common/enums/export-format.enum';

export type ExportJobDocument = ExportJob & Document;

class ExportFilters {
  @Prop() category: string;
  @Prop() dateFrom: Date;
  @Prop() dateTo: Date;
  @Prop() status: string;
  @Prop({ type: [String] }) productIds: string[];
}

@Schema({ timestamps: true })
export class ExportJob {
  @Prop({ type: String, enum: ExportFormat, required: true })
  format: ExportFormat;

  @Prop({ type: String, enum: ExportStatus, default: ExportStatus.QUEUED })
  status: ExportStatus;

  @Prop({ type: Object, default: {} })
  filters: ExportFilters;

  @Prop({ default: 0 }) rowCount: number;

  @Prop({ type: String, default: null })
  fileUrl: string | null;

  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  generatedBy: Types.ObjectId;
}

export const ExportJobSchema = SchemaFactory.createForClass(ExportJob);

ExportJobSchema.index({ status: 1 });
ExportJobSchema.index({ generatedBy: 1 });
ExportJobSchema.index({ expiresAt: 1 });
