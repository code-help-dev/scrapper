import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private redis: Redis;

  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly config: ConfigService,
  ) {
    this.redis = new Redis({
      host: config.get<string>('redis.host') ?? 'localhost',
      port: config.get<number>('redis.port') ?? 6379,
      password: config.get<string>('redis.password') || undefined,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: false,
    });
  }

  @Get()
  @ApiOperation({ summary: 'System health — checks MongoDB and Redis' })
  async check() {
    const mongoStatus = this.getMongoStatus();
    const redisStatus = await this.getRedisStatus();

    const overall =
      mongoStatus === 'up' && redisStatus === 'up' ? 'ok' : 'degraded';

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      services: {
        mongodb: { status: mongoStatus },
        redis: { status: redisStatus },
      },
    };
  }

  private getMongoStatus(): 'up' | 'down' {
    
    return this.mongoConnection.readyState === 1 ? 'up' : 'down';
  }

  private async getRedisStatus(): Promise<'up' | 'down'> {
    try {
      await this.redis.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
