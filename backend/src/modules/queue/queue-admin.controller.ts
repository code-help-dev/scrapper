import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { QUEUE_EXTRACTION, QUEUE_IMAGE, QUEUE_EXPORT } from './queue.constants';

@ApiTags('Queue Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('queue')
export class QueueAdminController {
  constructor(
    @InjectQueue(QUEUE_EXTRACTION) private readonly extractionQueue: Queue,
    @InjectQueue(QUEUE_IMAGE) private readonly imageQueue: Queue,
    @InjectQueue(QUEUE_EXPORT) private readonly exportQueue: Queue,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Live job counts per queue (no auth required)' })
  async status() {
    const [extraction, image, exp] = await Promise.all([
      this.extractionQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      this.imageQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      this.exportQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
    ]);

    return {
      timestamp: new Date().toISOString(),
      queues: {
        [QUEUE_EXTRACTION]: extraction,
        [QUEUE_IMAGE]: image,
        [QUEUE_EXPORT]: exp,
      },
    };
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear all jobs from every queue (no auth required)',
    description:
      'Removes all waiting, delayed, and active jobs from extraction, image, and export queues. ' +
      'Use this to halt the scraper and clear all pending work immediately.',
  })
  async clearQueues() {
    await Promise.all([
      this.extractionQueue.obliterate({ force: true }),
      this.imageQueue.obliterate({ force: true }),
      this.exportQueue.obliterate({ force: true }),
    ]);

    return {
      message: 'All queues cleared — no jobs remain.',
      queues: [QUEUE_EXTRACTION, QUEUE_IMAGE, QUEUE_EXPORT],
      timestamp: new Date().toISOString(),
    };
  }
}
