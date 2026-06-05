import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_EXTRACTION } from '../queue/queue.constants';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_EXTRACTION }),
  ],
  controllers: [JobsController],
})
export class JobsModule {}
