import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../database/schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { DynamicQueueService } from '../queue/dynamic-queue.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserDocument | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    const valid = await this.usersService.validatePassword(user, password);
    return valid ? user : null;
  }

  async login(user: UserDocument) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
    });

    await this.usersService.updateRefreshToken(user.id, refreshToken);
    await this.usersService.updateLastLogin(user.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async register(dto: RegisterDto) {
    const role = dto.role ?? UserRole.OPERATOR;
    const user = await this.usersService.create(dto.email, dto.password, role);
    this.dynamicQueueService.createQueueForUser(user.id);
    return user;
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const valid = await this.usersService.validateRefreshToken(userId, refreshToken);
    if (!valid) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.usersService.findByIdOrFail(userId);
    const payload = { sub: user.id, email: user.email, role: user.role };

    const newAccessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn'),
    });

    return { access_token: newAccessToken };
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
  }

  async resetPassword(dto: ResetPasswordDto) {
    await this.usersService.updatePasswordByEmail(dto.email, dto.newPassword);
    return { message: 'Password updated successfully' };
  }
}
