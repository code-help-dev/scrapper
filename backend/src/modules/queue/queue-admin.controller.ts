import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { QUEUE_EXTRACTION, QUEUE_IMAGE, QUEUE_EXPORT } from './queue.constants';

@ApiTags('Queue Admin')
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

  @Post('obliterate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Nuclear stop — wipe all jobs from every queue (no auth required)',
    description:
      'Obliterates all waiting, delayed, and active jobs from extraction, image, and export queues. ' +
      'Use this when MongoDB is dropped and you need to halt the scraper immediately.',
  })
  async obliterate() {
    await Promise.all([
      this.extractionQueue.obliterate({ force: true }),
      this.imageQueue.obliterate({ force: true }),
      this.exportQueue.obliterate({ force: true }),
    ]);

    return {
      message: 'All queues obliterated — no jobs remain.',
      queues: [QUEUE_EXTRACTION, QUEUE_IMAGE, QUEUE_EXPORT],
      timestamp: new Date().toISOString(),
    };
  }
}
