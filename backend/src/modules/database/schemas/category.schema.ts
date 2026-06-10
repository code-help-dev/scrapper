import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CategoryDocument = Category & Document;

class SubCategoryItem {
  name: string;
  slug: string;
}

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: [{ name: String, slug: String, _id: false }], default: [] })
  subCategories: SubCategoryItem[];

  @Prop({ default: 0, min: 0 })
  productCount: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ slug: 1 });
CategorySchema.index({ productCount: -1 });
