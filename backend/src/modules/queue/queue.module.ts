import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { ScraperModule } from '../scraper/scraper.module';
import { ExtractorModule } from '../extractor/extractor.module';
import { ImageModule } from '../image/image.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ExportModule } from '../export/export.module';
import { SellersModule } from '../sellers/sellers.module';
import { ExtractionProcessor } from './processors/extraction.processor';
import { ImageProcessor } from './processors/image.processor';
import { ExportProcessor } from './processors/export.processor';
import { QueueRecoveryService } from './queue-recovery.service';
import { QueueAdminController } from './queue-admin.controller';
import { DynamicQueueService } from './dynamic-queue.service';
import {
  QUEUE_EXTRACTION,
  QUEUE_IMAGE,
  QUEUE_EXPORT,
} from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 200 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_EXTRACTION },
      { name: QUEUE_IMAGE },
      { name: QUEUE_EXPORT },
    ),
    
    DatabaseModule,
    ScraperModule,
    ExtractorModule,
    ImageModule,
    NormalizationModule,
    ExportModule,
    SellersModule,
  ],
  controllers: [QueueAdminController],
  providers: [ExtractionProcessor, ImageProcessor, ExportProcessor, QueueRecoveryService, DynamicQueueService],
  exports: [BullModule, DynamicQueueService],
})
export class QueueModule {}
