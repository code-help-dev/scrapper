import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SellerDocument = Seller & Document;

@Schema({ timestamps: true })
export class Seller {
  @Prop({ required: true, unique: true, trim: true })
  sellerName: string;

  @Prop({ default: '' }) sellerLogoUrl: string;
  @Prop({ default: '' }) gstNumber: string;
  @Prop({ default: '' }) address: string;
  @Prop({ default: '' }) state: string;
  @Prop({ default: '' }) country: string;
  @Prop({ default: '' }) businessType: string;
  @Prop({ default: null }) yearsEstablished: number;
  @Prop({ default: '' }) numberOfEmployees: string;
  @Prop({ default: '' }) turnover: string;
  @Prop({ default: '' }) legalStatus: string;
  @Prop({ default: '' }) contactDetails: string;
  @Prop({ default: '' }) aajjoProfileUrl: string;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);
SellerSchema.index({ sellerName: 1 });
