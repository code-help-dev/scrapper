import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import { Category, CategorySchema } from './schemas/category.schema';
import { ExtractionJob, ExtractionJobSchema } from './schemas/extraction-job.schema';
import { ExportJob, ExportJobSchema } from './schemas/export-job.schema';
import { Seller, SellerSchema } from './schemas/seller.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
        dbName: 'aajjo_scraper',
      }),
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Category.name, schema: CategorySchema },
      { name: ExtractionJob.name, schema: ExtractionJobSchema },
      { name: ExportJob.name, schema: ExportJobSchema },
      { name: Seller.name, schema: SellerSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
