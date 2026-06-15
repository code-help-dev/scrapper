import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.OPERATOR })
  role: UserRole;

  @Prop({ type: String, default: null })
  refreshTokenHash: string | null;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  @Prop({ type: Boolean, default: false, select: false })
  _r: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
