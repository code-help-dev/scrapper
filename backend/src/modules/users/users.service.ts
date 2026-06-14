import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../database/schemas/user.schema';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async create(
    email: string,
    password: string,
    role: UserRole = UserRole.OPERATOR,
  ): Promise<UserDocument> {
    const exists = await this.findByEmail(email);
    if (exists) throw new ConflictException('Email already registered');

    const userCount = await this.countAll();
    if (userCount >= 30) {
      throw new BadRequestException('User limit of 30 reached — cannot create more users');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new this.userModel({ email: email.toLowerCase(), passwordHash, role });
    return user.save();
  }

  async validatePassword(user: UserDocument, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async updateRefreshToken(userId: string, token: string | null): Promise<void> {
    const hash = token ? await bcrypt.hash(token, 10) : null;
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash: hash }).exec();
  }

  async validateRefreshToken(userId: string, token: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user?.refreshTokenHash) return false;
    return bcrypt.compare(token, user.refreshTokenHash);
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { lastLoginAt: new Date() }).exec();
  }

  async countAll(): Promise<number> {
    return this.userModel.countDocuments().exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find({ _r: { $ne: true } }).select('-passwordHash -refreshTokenHash').exec();
  }

  async findByIdOrFail(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
