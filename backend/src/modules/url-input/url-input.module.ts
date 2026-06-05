import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_EXTRACTION } from '../queue/queue.constants';
import { UrlInputController } from './url-input.controller';
import { UrlInputService } from './url-input.service';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_EXTRACTION }),
  ],
  controllers: [UrlInputController],
  providers: [UrlInputService],
  exports: [UrlInputService],
})
export class UrlInputModule {}
