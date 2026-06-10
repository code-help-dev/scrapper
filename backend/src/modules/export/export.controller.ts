import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsDateString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExportJob, ExportJobDocument } from '../database/schemas/export-job.schema';
import { ExportFormat, ExportStatus } from '../../common/enums/export-format.enum';
import { ExportService } from './export.service';
import { QUEUE_EXPORT, JOB_GENERATE_EXPORT } from '../queue/queue.constants';
import { GenerateExportPayload } from '../queue/processors/export.processor';

class TriggerExportDto {
  @ApiProperty({ enum: ExportFormat })
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() seller?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}

@ApiTags('Export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('export')
export class ExportController {
  constructor(
    @InjectModel(ExportJob.name)
    private readonly exportJobModel: Model<ExportJobDocument>,
    @InjectQueue(QUEUE_EXPORT)
    private readonly exportQueue: Queue,
    private readonly exportService: ExportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Trigger an export — returns export job ID' })
  @ApiBody({ type: TriggerExportDto })
  async trigger(
    @Body() dto: TriggerExportDto,
    @CurrentUser() user: { id: string },
  ) {
    const filters = {
      category: dto.category,
      subCategory: dto.subCategory,
      seller: dto.seller,
      dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : undefined,
      dateTo: dto.dateTo ? new Date(dto.dateTo) : undefined,
      status: dto.status,
      productIds: dto.productIds?.length ? dto.productIds : undefined,
    };

    const exportJob = new this.exportJobModel({
      format: dto.format,
      status: ExportStatus.QUEUED,
      filters,
      generatedBy: new Types.ObjectId(user.id),
    });
    await exportJob.save();

    await this.exportQueue.add(
      JOB_GENERATE_EXPORT,
      {
        exportJobId: exportJob.id,
        format: dto.format,
        filters,
        userId: user.id,
      } satisfies GenerateExportPayload,
    );

    return {
      exportJobId: exportJob.id,
      format: dto.format,
      status: ExportStatus.QUEUED,
      message: 'Export queued — poll /api/export/:id/status for completion',
    };
  }

  @Get()
  @ApiOperation({ summary: 'Export job history' })
  async findAll(@CurrentUser() user: { id: string }) {
    const jobs = await this.exportJobModel
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return { data: jobs };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Poll export job status' })
  async status(@Param('id') id: string) {
    const job = await this.exportJobModel.findById(id).lean().exec();
    if (!job) throw new NotFoundException('Export job not found');
    return {
      exportJobId: id,
      status: job.status,
      format: job.format,
      rowCount: job.rowCount,
      fileUrl: job.fileUrl,
      expiresAt: job.expiresAt,
    };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the completed export file' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const filePath = await this.exportService.getExportFilePath(id);
    const fileName = path.basename(filePath);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }

  @Post('direct')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate and stream export immediately — no file saved' })
  @ApiBody({ type: TriggerExportDto })
  async directDownload(
    @Body() dto: TriggerExportDto,
    @Res() res: Response,
  ) {
    const filters = {
      category: dto.category,
      subCategory: dto.subCategory,
      seller: dto.seller,
      dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : undefined,
      dateTo: dto.dateTo ? new Date(dto.dateTo) : undefined,
      status: dto.status,
      productIds: dto.productIds?.length ? dto.productIds : undefined,
    };

    const { buffer, fileName, contentType } =
      await this.exportService.generateBuffer(dto.format, filters);

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
