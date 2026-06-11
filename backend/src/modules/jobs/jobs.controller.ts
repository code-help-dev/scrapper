import {
  Controller,
  Get,
  Param,
  Delete,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Sse,
  MessageEvent,
} from '@nestjs/common';

const AAJJO_PRODUCT_RE = /^https?:\/\/(www\.)?aajjo\.com\/product\//i;
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable, interval, from } from 'rxjs';
import { map, switchMap, takeWhile } from 'rxjs/operators';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { JobStatus } from '../../common/enums/job-status.enum';
import { JOB_SCRAPE_URL } from '../queue/queue.constants';
import { ScrapeUrlPayload } from '../queue/processors/extraction.processor';
import { DynamicQueueService } from '../queue/dynamic-queue.service';

const TERMINAL_STATUSES = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.PAUSED,
];

@ApiTags('Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List extraction jobs — paginated, filterable, searchable' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: JobStatus })
  @ApiQuery({ name: 'search', required: false, description: 'Search by source URL' })
  async findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const skip = (Number(page) - 1) * Number(limit);
    const filter: Record<string, unknown> = {};
    if (user.role !== UserRole.ADMIN) filter.submittedBy = user.id;
    if (status) filter.status = status;
    if (search) filter.sourceUrl = { $regex: search, $options: 'i' };

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

    return {
      data: items,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    };
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

    await this.jobModel.findByIdAndUpdate(id, {
      status: JobStatus.QUEUED,
      pausedAt: null,
    });

    const userId = job.submittedBy.toString();
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

    await this.jobModel.findByIdAndUpdate(id, {
      status: JobStatus.QUEUED,
      errorMessage: null,
      processedCount: 0,
      failedCount: 0,
      totalProducts: 0,
    });

    const userId = job.submittedBy.toString();
    await this.dynamicQueueService.addJob(userId, {
      jobId: id,
      sourceUrl: job.sourceUrl,
      userId,
      isDiscovery: !AAJJO_PRODUCT_RE.test(job.sourceUrl),
    } satisfies ScrapeUrlPayload);

    return { message: 'Job re-queued', jobId: id };
  }
}
