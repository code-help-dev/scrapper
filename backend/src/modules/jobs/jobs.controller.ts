import {
  Controller,
  Get,
  Param,
  Delete,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Sse,
  MessageEvent,
  Logger,
} from '@nestjs/common';

// Aajjo hosts single-item detail pages under both /product/ and /service/ —
// anything else under the domain is a category/listing page to discover-crawl.
const AAJJO_PRODUCT_RE = /^https?:\/\/(www\.)?aajjo\.com\/(product|service)\//i;
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Observable, interval, from } from 'rxjs';
import { map, switchMap, takeWhile } from 'rxjs/operators';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { JobStatus } from '../../common/enums/job-status.enum';
import { FLAG_CONFIDENCE_THRESHOLD } from '../../common/enums/extraction-status.enum';
import { ScrapeUrlPayload } from '../queue/processors/extraction.processor';
import { DynamicQueueService } from '../queue/dynamic-queue.service';

const TERMINAL_STATUSES = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.PAUSED,
];

type JobDeleteStatusFilter = 'completed' | 'failed' | 'flagged';

class BulkRetryJobsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  jobIds?: string[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() all?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlyFlagged?: boolean;

  @ApiPropertyOptional({
    description:
      'Only meaningful with onlyFlagged — further restricts to flagged products with ' +
      'confidenceScore <= this value (0-100), e.g. re-run only the lowest-confidence flags first.',
  })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  maxConfidence?: number;
}

class BulkDeleteJobsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  jobIds?: string[];

  @ApiPropertyOptional({ enum: ['completed', 'failed', 'flagged'] })
  @IsOptional() @IsIn(['completed', 'failed', 'flagged'])
  status?: JobDeleteStatusFilter;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() all?: boolean;
  @ApiProperty() @IsBoolean() confirm: boolean;
}

interface BulkResult {
  requested: number;
  deleted?: number;
  retried?: number;
  failed: { id: string; reason: string }[];
}

@ApiTags('Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  // "Flagged job" is derived, not stored — a job is flagged when it produced at
  // least one Product with isFlagged=true. Kept as an $in match (not a $lookup)
  // on the hot, paginated list endpoint so existing filters/sort/pagination are
  // untouched; the one-off export endpoint below can afford a real aggregation.
  private async flaggedProductIds(maxConfidence?: number): Promise<Types.ObjectId[]> {
    const query: Record<string, unknown> = { isFlagged: true };
    if (maxConfidence != null) query.confidenceScore = { $lte: maxConfidence };
    const flagged = await this.productModel
      .find(query, { _id: 1 })
      .lean()
      .exec();
    return flagged.map((p) => p._id as Types.ObjectId);
  }

  @Get()
  @ApiOperation({ summary: 'List extraction jobs — paginated, filterable, searchable' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: JobStatus })
  @ApiQuery({ name: 'search', required: false, description: 'Search by source URL' })
  @ApiQuery({ name: 'flagged', required: false, type: Boolean, description: 'Only jobs that produced a flagged product' })
  @ApiQuery({ name: 'maxConfidence', required: false, type: Number, description: 'With flagged=true, only jobs whose flagged product scored <= this confidence (0-100)' })
  async findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('flagged') flagged?: string,
    @Query('maxConfidence') maxConfidence?: string,
  ): Promise<{ data: unknown[]; meta: { total: number; page: number; limit: number; pages: number } }> {
    const skip = (Number(page) - 1) * Number(limit);
    const isAdmin = user.role === UserRole.ADMIN;

    this.logger.log(`GET /jobs — userId=${user.id} role="${user.role}" isAdmin=${isAdmin}`);

    const filter: Record<string, unknown> = {};
    if (!isAdmin) {
      if (!user.id || !Types.ObjectId.isValid(user.id)) {
        this.logger.error(`Invalid userId in JWT: "${user.id}"`);
        return { data: [], meta: { total: 0, page: Number(page), limit: Number(limit), pages: 0 } };
      }
      filter.submittedBy = { $eq: new Types.ObjectId(user.id) };
    }
    if (status) filter.status = status;
    if (search) filter.sourceUrl = { $regex: search, $options: 'i' };
    const maxConfidenceNum = maxConfidence != null && maxConfidence !== '' ? Number(maxConfidence) : undefined;
    if (flagged === 'true') {
      filter.productIds = { $in: await this.flaggedProductIds(maxConfidenceNum) };
    }

    const [items, total] = await Promise.all([
      this.jobModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .exec(),
      this.jobModel.countDocuments(filter).exec(),
    ]);

    this.logger.log(`GET /jobs — matched=${total} filter=${JSON.stringify({ submittedBy: filter.submittedBy ? user.id : 'ALL' })}`);

    // Cheap per-page flag indicator so the table can badge rows even when the
    // "flagged" filter isn't active — bounded by this page's productIds only,
    // never a full-collection scan.
    const pageProductIds = items.flatMap((j) => j.productIds ?? []);
    let flaggedConfidenceById = new Map<string, number>();
    if (pageProductIds.length) {
      const flaggedHere = await this.productModel
        .find({ _id: { $in: pageProductIds }, isFlagged: true }, { _id: 1, confidenceScore: 1 })
        .lean()
        .exec();
      flaggedConfidenceById = new Map(
        flaggedHere.map((p) => [p._id.toString(), p.confidenceScore]),
      );
    }
    const data = items.map((job) => {
      const confidences = (job.productIds ?? [])
        .map((id) => flaggedConfidenceById.get(id.toString()))
        .filter((v): v is number => v != null);
      return {
        ...job,
        hasFlaggedProduct: confidences.length > 0,
        // Lowest score among this job's flagged products — surfaced so the UI can
        // let users retry only the lowest-confidence flags instead of all of them.
        flaggedConfidence: confidences.length ? Math.min(...confidences) : undefined,
      };
    });

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  @Get('flagged/export')
  @ApiOperation({ summary: 'Export flagged job source URLs as CSV or Excel' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  async exportFlagged(
    @CurrentUser() user: { id: string; role: string },
    @Res() res: Response,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
  ) {
    const isAdmin = user.role === UserRole.ADMIN;
    const matchStage: Record<string, unknown> = {};
    if (!isAdmin) matchStage.submittedBy = new Types.ObjectId(user.id);

    const rows = await this.jobModel.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'products',
          localField: 'productIds',
          foreignField: '_id',
          as: 'flaggedProducts',
          pipeline: [{ $match: { isFlagged: true } }],
        },
      },
      { $match: { 'flaggedProducts.0': { $exists: true } } },
      { $addFields: { flaggedProduct: { $first: '$flaggedProducts' } } },
      { $sort: { createdAt: -1 } },
    ]).exec();

    const records = rows.map((r: any) => ({
      'Source URL': r.sourceUrl ?? '',
      'Job ID': r._id.toString(),
      Supplier: r.flaggedProduct?.seller?.sellerName ?? '',
      'Confidence Score': r.flaggedProduct?.confidenceScore ?? '',
      'Flag Reason':
        r.flaggedProduct?.confidenceScore != null
          ? `Low confidence (${r.flaggedProduct.confidenceScore}%), below ${FLAG_CONFIDENCE_THRESHOLD}% threshold`
          : '',
      Status: r.status ?? '',
      'Created Date': r.createdAt ? new Date(r.createdAt).toISOString() : '',
      'Last Attempt': (r.lastRetriedAt ?? r.startedAt)
        ? new Date(r.lastRetriedAt ?? r.startedAt).toISOString()
        : '',
      'Retry Count': r.retryCount ?? 0,
    }));

    const columns = [
      'Source URL', 'Job ID', 'Supplier', 'Confidence Score', 'Flag Reason',
      'Status', 'Created Date', 'Last Attempt', 'Retry Count',
    ];
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    this.logger.log(`GET /jobs/flagged/export — userId=${user.id} format=${format} rows=${records.length}`);

    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Flagged Jobs');
      ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.min(Math.max(c.length + 4, 14), 60) }));
      ws.getRow(1).font = { bold: true };
      records.forEach((r) => ws.addRow(r));
      const buffer = await wb.xlsx.writeBuffer();

      res.setHeader('Content-Disposition', `attachment; filename="flagged_jobs_${ts}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(Buffer.from(buffer as ArrayBuffer));
      return;
    }

    const csv = records.length
      ? stringify(records, { header: true, columns })
      : columns.join(',') + '\n';

    res.setHeader('Content-Disposition', `attachment; filename="flagged_jobs_${ts}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(Buffer.from(csv, 'utf-8'));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get extraction job detail + current BullMQ state' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ): Promise<Record<string, unknown>> {
    const job = await this.jobModel.findById(id).lean().exec();
    if (!job) throw new NotFoundException('Job not found');
    if (user.role !== UserRole.ADMIN && job.submittedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    let bullState: string | undefined;
    try {
      const bullJob = await this.dynamicQueueService.getBullJob(job.submittedBy.toString(), id);
      bullState = bullJob ? await bullJob.getState() : undefined;
    } catch {
      // bull job may not exist yet
    }

    return { ...job, bullState };
  }

  @Sse(':id/events')
  @ApiOperation({ summary: 'SSE stream — emits job state every 2s until terminal' })
  jobEvents(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ): Observable<MessageEvent> {
    return interval(2000).pipe(
      switchMap(() => from(this.jobModel.findById(id).lean().exec())),
      takeWhile(
        (job) => {
          if (
            job &&
            user.role !== UserRole.ADMIN &&
            job.submittedBy?.toString() !== user.id
          ) return false;
          return (
            job != null &&
            !TERMINAL_STATUSES.includes((job as any).status as JobStatus)
          );
        },
        true,
      ),
      map(
        (job) =>
          ({
            data: job ?? { _id: id, status: 'not_found' },
          }) as MessageEvent,
      ),
    );
  }

  @Post('stop-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop all active jobs',
    description:
      'Cancels every job in QUEUED, PROCESSING, PAUSED, or RETRY state. ' +
      'Admins stop jobs across all users; regular users stop only their own.',
  })
  async stopAll(@CurrentUser() user: { id: string; role: string }) {
    const isAdmin = user.role === UserRole.ADMIN;
    const activeStatuses = [
      JobStatus.QUEUED,
      JobStatus.PROCESSING,
      JobStatus.PAUSED,
      JobStatus.RETRY,
    ];

    const filter: Record<string, unknown> = { status: { $in: activeStatuses } };
    if (!isAdmin) {
      filter.submittedBy = new Types.ObjectId(user.id);
    }

    const jobs = await this.jobModel
      .find(filter)
      .select('_id submittedBy')
      .lean()
      .exec();

    if (jobs.length === 0) {
      return { message: 'No active jobs found', stopped: 0 };
    }

    // Remove from BullMQ queues; active (locked) jobs silently fail remove — that's fine
    await Promise.all(
      jobs.map((job) =>
        this.dynamicQueueService.removeJob(
          job.submittedBy.toString(),
          (job._id as Types.ObjectId).toString(),
        ),
      ),
    );

    await this.jobModel.updateMany(filter, {
      status: JobStatus.FAILED,
      errorMessage: 'Stopped by user',
      completedAt: new Date(),
    });

    this.logger.log(
      `stop-all — userId=${user.id} role=${user.role} stopped=${jobs.length}`,
    );

    return { message: `Stopped ${jobs.length} job(s)`, stopped: jobs.length };
  }

  @Post('bulk-retry')
  @ApiOperation({
    summary: 'Retry multiple jobs at once',
    description:
      'Provide exactly one selector: jobIds (explicit multi-select — each must be ' +
      'FAILED or COMPLETED, same rule as the single-job retry endpoint), all=true ' +
      '("retry all failed jobs" — FAILED only, COMPLETED jobs are never bulk-retried ' +
      'implicitly), or onlyFlagged=true (every job that produced a flagged product, ' +
      'FAILED or COMPLETED). onlyFlagged can be paired with maxConfidence to only retry ' +
      'flagged jobs at or below a given confidence score.',
  })
  async bulkRetry(
    @Body() dto: BulkRetryJobsDto,
    @CurrentUser() user: { id: string; role: string },
  ): Promise<BulkResult> {
    const isAdmin = user.role === UserRole.ADMIN;
    const selectorCount = [dto.jobIds?.length, dto.all, dto.onlyFlagged].filter(Boolean).length;
    if (selectorCount !== 1) {
      throw new BadRequestException('Provide exactly one of jobIds, all, or onlyFlagged');
    }

    const filter: Record<string, unknown> = {};
    if (!isAdmin) filter.submittedBy = new Types.ObjectId(user.id);

    if (dto.jobIds?.length) {
      const ids = dto.jobIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      filter._id = { $in: ids };
      filter.status = { $in: [JobStatus.FAILED, JobStatus.COMPLETED] };
    } else if (dto.all) {
      filter.status = JobStatus.FAILED;
    } else {
      filter.status = { $in: [JobStatus.FAILED, JobStatus.COMPLETED] };
      filter.productIds = { $in: await this.flaggedProductIds(dto.maxConfidence) };
    }

    const targets = await this.jobModel.find(filter).exec();
    if (!targets.length) return { requested: 0, retried: 0, failed: [] };

    const failed: { id: string; reason: string }[] = [];
    let retried = 0;
    for (const job of targets) {
      try {
        await this.retryOne(job, user.id);
        retried++;
      } catch (err: any) {
        failed.push({ id: job.id, reason: err.message ?? 'Unknown error' });
      }
    }

    this.logger.warn(
      `bulk-retry — actor=${user.id}(${user.role}) requested=${targets.length} retried=${retried} failed=${failed.length}`,
    );

    return { requested: targets.length, retried, failed };
  }

  @Post('bulk-delete')
  @ApiOperation({
    summary: 'Delete multiple job records at once (single delete: pass one id in jobIds)',
    description:
      'Provide exactly one of jobIds, status (completed/failed/flagged), or all=true. ' +
      'confirm must be true. Child jobs (parentJobId) of a deleted job are deleted too. ' +
      'Linked Products are never deleted by this endpoint.',
  })
  async bulkDelete(
    @Body() dto: BulkDeleteJobsDto,
    @CurrentUser() user: { id: string; role: string },
  ): Promise<BulkResult> {
    if (dto.confirm !== true) {
      throw new BadRequestException('confirm must be true to delete jobs');
    }
    const isAdmin = user.role === UserRole.ADMIN;
    const selectorCount = [dto.jobIds?.length, dto.status, dto.all].filter(Boolean).length;
    if (selectorCount !== 1) {
      throw new BadRequestException('Provide exactly one of jobIds, status, or all');
    }

    const filter: Record<string, unknown> = {};
    if (!isAdmin) filter.submittedBy = new Types.ObjectId(user.id);

    if (dto.jobIds?.length) {
      const ids = dto.jobIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      filter._id = { $in: ids };
    } else if (dto.status === 'completed') {
      filter.status = JobStatus.COMPLETED;
    } else if (dto.status === 'failed') {
      filter.status = JobStatus.FAILED;
    } else if (dto.status === 'flagged') {
      filter.productIds = { $in: await this.flaggedProductIds() };
    }
    // dto.all: no extra predicate beyond ownership scoping

    const targets = await this.jobModel.find(filter).select('_id submittedBy').lean().exec();
    if (!targets.length) return { requested: 0, deleted: 0, failed: [] };

    const targetIds = targets.map((t) => t._id as Types.ObjectId);
    const children = await this.jobModel
      .find({ parentJobId: { $in: targetIds } })
      .select('_id submittedBy')
      .lean()
      .exec();
    const seen = new Set(targetIds.map((id) => id.toString()));
    const allTargets = [...targets, ...children.filter((c) => !seen.has(c._id.toString()))];

    const failed: { id: string; reason: string }[] = [];
    let deleted = 0;
    for (const job of allTargets) {
      const jobId = (job._id as Types.ObjectId).toString();
      try {
        await this.dynamicQueueService.removeJob(job.submittedBy.toString(), jobId);
        await this.jobModel.deleteOne({ _id: job._id }).exec();
        deleted++;
      } catch (err: any) {
        failed.push({ id: jobId, reason: err.message ?? 'Unknown error' });
      }
    }

    this.logger.warn(
      `bulk-delete jobs — actor=${user.id}(${user.role}) selector=${dto.jobIds?.length ? 'ids' : dto.status ?? 'all'} requested=${allTargets.length} deleted=${deleted} failed=${failed.length}`,
    );

    return { requested: allTargets.length, deleted, failed };
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a queued job' })
  async pause(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Job not found');
    if (user.role !== UserRole.ADMIN && job.submittedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (job.status !== JobStatus.QUEUED) {
      throw new BadRequestException(
        `Only queued jobs can be paused (current status: ${job.status})`,
      );
    }

    await this.dynamicQueueService.removeJob(job.submittedBy.toString(), id);

    await this.jobModel.findByIdAndUpdate(id, {
      status: JobStatus.PAUSED,
      pausedAt: new Date(),
    });

    return { message: 'Job paused', jobId: id };
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused job' })
  async resume(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Job not found');
    if (user.role !== UserRole.ADMIN && job.submittedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (job.status !== JobStatus.PAUSED) {
      throw new BadRequestException(
        `Only paused jobs can be resumed (current status: ${job.status})`,
      );
    }

    const userId = job.submittedBy.toString();

    // Defensive: pause() already removes the BullMQ entry, but if it somehow
    // still exists, re-adding with the same jobId would silently no-op (BullMQ
    // dedupes on jobId) — see retryOne() for the full explanation.
    await this.dynamicQueueService.removeJob(userId, id);

    await this.jobModel.findByIdAndUpdate(id, {
      status: JobStatus.QUEUED,
      pausedAt: null,
    });

    await this.dynamicQueueService.addJob(userId, {
      jobId: id,
      sourceUrl: job.sourceUrl,
      userId,
      isDiscovery: !AAJJO_PRODUCT_RE.test(job.sourceUrl),
    } satisfies ScrapeUrlPayload);

    return { message: 'Job resumed', jobId: id };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a queued, paused, or processing job' })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Job not found');
    if (user.role !== UserRole.ADMIN && job.submittedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (
      job.status !== JobStatus.QUEUED &&
      job.status !== JobStatus.PAUSED &&
      job.status !== JobStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Only queued, paused, or processing jobs can be cancelled (current status: ${job.status})`,
      );
    }

    await this.dynamicQueueService.removeJob(job.submittedBy.toString(), id);

    await this.jobModel.findByIdAndUpdate(id, {
      status: JobStatus.FAILED,
      errorMessage: 'Cancelled by user',
      completedAt: new Date(),
    });
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or re-scrape a completed extraction job' })
  async retry(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Job not found');
    if (user.role !== UserRole.ADMIN && job.submittedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (job.status !== JobStatus.FAILED && job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException(
        `Only failed or completed jobs can be retried (current status: ${job.status})`,
      );
    }

    await this.retryOne(job, user.id);

    return { message: 'Job re-queued', jobId: id };
  }

  // Shared by the single-job retry endpoint and bulk-retry. Snapshots the job's
  // current state into retryHistory (capped at 20 entries) before resetting it,
  // and — critically — removes any existing BullMQ entry before re-adding: BullMQ
  // dedupes `add()` on jobId, and completed/failed jobs stay in Redis for a while
  // (removeOnComplete/removeOnFail keep the last 100/200), so re-adding the same
  // jobId without removing it first is a silent no-op that leaves the job stuck
  // at QUEUED forever.
  private async retryOne(
    job: ExtractionJobDocument,
    actorUserId: string,
  ): Promise<void> {
    const id = job.id as string;
    const userId = job.submittedBy.toString();
    const initiatedBy = Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : null;

    const historyEntry = {
      attemptedAt: new Date(),
      initiatedBy,
      previousStatus: job.status,
      previousProcessedCount: job.processedCount,
      previousFailedCount: job.failedCount,
      previousTotalProducts: job.totalProducts,
      previousErrorMessage: job.errorMessage,
    };

    await this.dynamicQueueService.removeJob(userId, id);

    await this.jobModel.findByIdAndUpdate(id, {
      $set: {
        status: JobStatus.QUEUED,
        errorMessage: null,
        processedCount: 0,
        failedCount: 0,
        totalProducts: 0,
        lastRetriedAt: new Date(),
        lastRetriedBy: initiatedBy,
      },
      $inc: { retryCount: 1 },
      $push: { retryHistory: { $each: [historyEntry], $slice: -20 } },
    });

    await this.dynamicQueueService.addJob(userId, {
      jobId: id,
      sourceUrl: job.sourceUrl,
      userId,
      isDiscovery: !AAJJO_PRODUCT_RE.test(job.sourceUrl),
    } satisfies ScrapeUrlPayload);
  }
}
