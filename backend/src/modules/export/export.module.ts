import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_EXPORT } from '../queue/queue.constants';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

@Module({
  imports: [
    DatabaseModule,
    
    BullModule.registerQueue({ name: QUEUE_EXPORT }),
  ],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
