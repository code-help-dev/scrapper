import { Module } from '@nestjs/common';
import { BrowserPoolService } from './browser-pool.service';
import { ScraperService } from './scraper.service';

@Module({
  providers: [BrowserPoolService, ScraperService],
  exports: [ScraperService, BrowserPoolService],
})
export class ScraperModule {}
