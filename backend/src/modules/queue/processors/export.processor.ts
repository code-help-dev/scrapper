import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_EXPORT } from '../queue.constants';
import { ExportService } from '../../export/export.service';
import { ExportFormat } from '../../../common/enums/export-format.enum';

export interface GenerateExportPayload {
  exportJobId: string;
  format: ExportFormat;
  filters: {
    category?: string;
    subCategory?: string;
    dateFrom?: Date;
    dateTo?: Date;
    status?: string;
    productIds?: string[];
  };
  userId: string;
}

@Processor(QUEUE_EXPORT)
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private readonly exportService: ExportService) {
    super();
  }

  async process(job: Job<GenerateExportPayload>): Promise<void> {
    const { exportJobId, format, filters } = job.data;
    this.logger.log(`[Export] Processing export job [${exportJobId}] format=${format}`);

    await this.exportService.generateExport(exportJobId, format, filters);
  }
}
