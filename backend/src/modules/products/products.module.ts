import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductsController } from './products.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [ProductsController],
  // CacheService is injected via the global CacheModule registered in AppModule
})
export class ProductsModule {}
