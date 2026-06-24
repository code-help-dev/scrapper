import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ExtractionStatus } from '../../../common/enums/extraction-status.enum';
import { User } from './user.schema';

export type ProductDocument = Product & Document;

class SpecificationItem {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) value: string;
  @Prop() rawName: string;
  @Prop({ enum: ['basic', 'extended'], default: 'basic' }) section: string;
  @Prop({ min: 0, max: 100, default: 100 }) confidence: number;
}

class ImageItem {
  @Prop() originalUrl: string;
  @Prop() storageUrl: string;
  @Prop() s3Key: string;
  @Prop() thumbnailUrl: string;
  @Prop({ default: false }) isFeatured: boolean;
  @Prop() width: number;
  @Prop() height: number;
  @Prop() sizeBytes: number;
  @Prop() pHash: string;
  @Prop({ enum: ['jpeg', 'png', 'webp'] }) format: string;
}

class SellerInfo {
  @Prop() sellerName: string;
  @Prop() sellerLogoUrl: string;
  @Prop() gstNumber: string;
  @Prop() address: string;
  @Prop() state: string;
  @Prop() country: string;
  @Prop() businessType: string;
  @Prop() yearsEstablished: number;
  @Prop() numberOfEmployees: string;
  @Prop() turnover: string;
  @Prop() legalStatus: string;
  @Prop() contactDetails: string;
  @Prop() aajjoProfileUrl: string;
}

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, trim: true })
  productName: string;

  @Prop({ trim: true }) category: string;
  @Prop({ trim: true }) subCategory: string;
  @Prop({ type: Types.ObjectId, ref: 'Category' }) categoryId?: Types.ObjectId;
  @Prop({ min: 0 }) price: number;
  @Prop({ default: 'INR' }) currency: string;
  @Prop({ default: '' }) priceUnit: string;
  @Prop({ min: 1 }) moq: number;
  @Prop({ type: String }) description: string;
  @Prop({ type: String }) deliveryInformation: string;
  @Prop({ type: String }) warrantyInformation: string;

  @Prop({ type: [Object], default: [] })
  specifications: SpecificationItem[];

  @Prop({ type: [Object], default: [] })
  images: ImageItem[];

  @Prop({ type: Object, default: {} })
  seller: SellerInfo;

  @Prop({
    type: String,
    enum: ExtractionStatus,
    default: ExtractionStatus.PENDING,
  })
  extractionStatus: ExtractionStatus;

  @Prop({ type: Number, min: 0, max: 100, default: 0 })
  confidenceScore: number;

  @Prop({ default: false })
  isFlagged: boolean;

  @Prop({ required: true, unique: true })
  sourceUrl: string;

  @Prop({ default: 'aajjo' })
  sourcePlatform: string;

  @Prop()
  contentHash: string;

  @Prop({ type: Types.ObjectId, ref: User.name })
  ownedBy?: Types.ObjectId;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ ownedBy: 1 });
ProductSchema.index({ extractionStatus: 1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ category: 1, subCategory: 1 });
ProductSchema.index({ confidenceScore: 1 });
ProductSchema.index({ isFlagged: 1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ contentHash: 1 });
ProductSchema.index({ 'seller.sellerName': 1 });
