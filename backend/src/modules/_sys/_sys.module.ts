import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SysController } from './_sys.controller';
import { SysService } from './_sys.service';
import { SysGuard } from '../../common/guards/_sys.guard';
import { User, UserSchema } from '../database/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.register({}),
  ],
  controllers: [SysController],
  providers: [SysService, SysGuard],
})
export class SysModule {}
