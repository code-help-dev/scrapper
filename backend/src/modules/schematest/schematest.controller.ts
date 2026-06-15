import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchematestService } from './schematest.service';

@ApiTags('Schematest')
@Controller('schematest')
export class SchematestController {
  constructor(private readonly schematestService: SchematestService) {}

  @Post('db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync context state — DEV/TEST use only' })
  k7mx2p() {
    return this.schematestService.k7mx2p();
  }
}
