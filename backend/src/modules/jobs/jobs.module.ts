import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { JobsController } from './jobs.controller';

@Module({
  imports: [DatabaseModule, QueueModule],
  controllers: [JobsController],
})
export class JobsModule {}
