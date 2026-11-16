import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ImageModule } from '../image/image.module';
import { ProductsController } from './products.controller';

@Module({
  imports: [DatabaseModule, ImageModule],
  controllers: [ProductsController],

})
export class ProductsModule {}
