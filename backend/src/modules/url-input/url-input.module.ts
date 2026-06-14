import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { UrlInputController } from './url-input.controller';
import { UrlInputService } from './url-input.service';

@Module({
  imports: [DatabaseModule, QueueModule],
  controllers: [UrlInputController],
  providers: [UrlInputService],
  exports: [UrlInputService],
})
export class UrlInputModule {}
