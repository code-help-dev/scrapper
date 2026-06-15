import { Module } from '@nestjs/common';
import { ExtractorService } from './extractor.service';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [ScraperModule],
  providers: [ExtractorService],
  exports: [ExtractorService],
})
export class ExtractorModule {}
