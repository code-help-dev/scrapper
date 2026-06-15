import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ImageService } from './image.service';

@Module({
  imports: [DatabaseModule],
  providers: [ImageService],
  exports: [ImageService],
})
export class ImageModule {}
