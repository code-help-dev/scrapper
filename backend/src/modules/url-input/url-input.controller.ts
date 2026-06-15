import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { UrlInputService } from './url-input.service';
import { SubmitUrlDto } from './dto/submit-url.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class UrlInputController {
  constructor(private readonly urlInputService: UrlInputService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a single Aajjo URL for scraping' })
  async submitSingle(
    @Body() dto: SubmitUrlDto,
    @CurrentUser() user: { id: string },
  ) {
    const result = await this.urlInputService.submitSingle(dto.url, user.id, dto.label);
    return {
      type: result.type,
      message: result.message,
      jobId: result.job?.id ?? result.discoveryJob?.id,
      status: result.job?.status ?? result.discoveryJob?.status,
      sourceUrl: dto.url,
    };
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage() }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV file — one URL per line, max 500' },
      },
    },
  })
  @ApiOperation({
    summary: 'Bulk submit up to 500 Aajjo URLs via CSV upload',
  })
  async submitBulk(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }), 
          new FileTypeValidator({ fileType: /(text\/csv|text\/plain|application\/octet-stream)/, skipMagicNumbersValidation: true }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) throw new BadRequestException('CSV file is required');

    const urls = this.urlInputService.parseCsvBuffer(file.buffer);
    const result = await this.urlInputService.submitBulk(urls, user.id);

    return {
      queued: result.queued.length,
      skipped: result.skipped.length,
      skippedDetails: result.skipped,
      jobIds: result.queued.map((j) => j.id),
    };
  }
}
