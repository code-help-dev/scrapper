import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DatabaseModule, QueueModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
