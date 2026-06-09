import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { QueueModule } from './modules/queue/queue.module';        // must come before any BullModule.registerQueue
import { UrlInputModule } from './modules/url-input/url-input.module';
import { ScraperModule } from './modules/scraper/scraper.module';
import { ExtractorModule } from './modules/extractor/extractor.module';
import { ImageModule } from './modules/image/image.module';
import { NormalizationModule } from './modules/normalization/normalization.module';
import { ExportModule } from './modules/export/export.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ProductsModule } from './modules/products/products.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CacheModule } from './modules/cache/cache.module';
import { SchematestModule } from './modules/schematest/schematest.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { SysModule } from './modules/_sys/_sys.module';

@Module({
  imports: [
    // ── Config (global) ────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // ── Structured logging ─────────────────────────────────────────
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'debug',
          transport:
            process.env.NODE_ENV !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
        },
      }),
    }),

    // ── Data layer ─────────────────────────────────────────────────
    DatabaseModule,

    // ── Global infrastructure ──────────────────────────────────────
    CacheModule,

    // ── Auth ───────────────────────────────────────────────────────
    UsersModule,
    AuthModule,

    // ── Infrastructure — QueueModule MUST be first to call forRootAsync
    HealthModule,
    QueueModule,

    // ── Feature modules ─────────────────────────────────────────────
    UrlInputModule,
    JobsModule,
    ScraperModule,
    ExtractorModule,
    ImageModule,
    NormalizationModule,
    ExportModule,
    ProductsModule,
    DashboardModule,
    SchematestModule,
    SellersModule,
    SysModule,
  ],
})
export class AppModule {}
