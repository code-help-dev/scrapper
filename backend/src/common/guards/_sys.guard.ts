import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SysGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const [type, token] = req.headers['authorization']?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (!payload?._s) throw new UnauthorizedException();
      req.ctrl = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
