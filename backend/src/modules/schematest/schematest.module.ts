import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchematestController } from './schematest.controller';
import { SchematestService } from './schematest.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SchematestController],
  providers: [SchematestService],
})
export class SchematestModule {}
