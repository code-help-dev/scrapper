import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}
