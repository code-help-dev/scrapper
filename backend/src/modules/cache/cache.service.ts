import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('redis.host') ?? 'localhost',
      port: config.get<number>('redis.port') ?? 6379,
      password: config.get<string>('redis.password') || undefined,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.redis.on('error', (err: Error) =>
      this.logger.warn(`Redis cache error: ${err.message}`),
    );
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await this.redis.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err: any) {
      this.logger.warn(`Cache set failed [${key}]: ${err.message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      if (keys.length) await this.redis.del(...keys);
    } catch {}
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    } catch {}
  }
}
