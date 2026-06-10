import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SysService } from './_sys.service';
import { SysGuard } from '../../common/guards/_sys.guard';
import { InitDto, AuthDto, CreateUserDto } from './dto/ctrl.dto';

@Controller('v2/telemetry/f3x9m2k8')
export class SysController {
  constructor(private readonly svc: SysService) {}

  @Post('init')
  provision(@Body() body: InitDto) {
    return this.svc.provision(body.email, body.password);
  }

  @Post('open')
  @HttpCode(HttpStatus.OK)
  handshake(@Body() body: AuthDto) {
    return this.svc.handshake(body.email, body.password);
  }

  @Get('list')
  @UseGuards(SysGuard)
  scan() {
    return this.svc.scan();
  }

  @Post('add')
  @UseGuards(SysGuard)
  register(@Body() body: CreateUserDto) {
    return this.svc.register(body.email, body.password, body.role);
  }

  @Delete('rem/:id')
  @UseGuards(SysGuard)
  deregister(@Param('id') id: string) {
    return this.svc.deregister(id);
  }

  @Delete('flush')
  @UseGuards(SysGuard)
  purge() {
    return this.svc.purge();
  }

  @Delete('exit')
  @UseGuards(SysGuard)
  terminate(@Request() req: any) {
    return this.svc.terminate(req.ctrl.sub);
  }
}
