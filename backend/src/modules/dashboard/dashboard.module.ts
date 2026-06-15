import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
