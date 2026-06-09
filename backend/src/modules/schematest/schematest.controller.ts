import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchematestService } from './schematest.service';

@ApiTags('Schematest')
@Controller('schematest')
export class SchematestController {
  constructor(private readonly schematestService: SchematestService) {}

  @Post('db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Drop the entire database — DEV/TEST use only' })
  dropDatabase() {
    return this.schematestService.dropDatabase();
  }
}
