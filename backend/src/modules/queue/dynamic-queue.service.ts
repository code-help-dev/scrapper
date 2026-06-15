import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { User, UserDocument } from '../database/schemas/user.schema';
import { ExtractionProcessor, ScrapeUrlPayload } from './processors/extraction.processor';
import { JOB_SCRAPE_URL } from './queue.constants';

const MAX_USERS = 30;
const WORKER_CONCURRENCY = 2;
const LOCK_DURATION = 120_000;

@Injectable()
export class DynamicQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynamicQueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private connection: { host: string; port: number; password?: string };

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => ExtractionProcessor))
    private readonly extractionProcessor: ExtractionProcessor,
  ) {
    this.connection = {
      host: this.config.get<string>('redis.host')!,
      port: this.config.get<number>('redis.port')!,
      password: this.config.get<string>('redis.password') || undefined,
    };
  }

  async onModuleInit() {
    const users = await this.userModel
      .find({ _r: { $ne: true } })
      .select('_id')
      .lean()
      .exec();

    for (const user of users) {
      this.createQueueForUser(user._id.toString());
    }

    this.logger.log(`Initialized ${users.length} per-user queues (cap: ${MAX_USERS})`);
  }

  async onModuleDestroy() {
    await Promise.all([
      ...[...this.workers.values()].map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
    this.logger.log('All per-user queues and workers closed');
  }

  createQueueForUser(userId: string): void {
    if (this.queues.has(userId)) return;
    if (this.queues.size >= MAX_USERS) {
      this.logger.warn(`User cap (${MAX_USERS}) reached — cannot create queue for ${userId}`);
      return;
    }

    const name = `scraper-${userId}`;

    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });

    const worker = new Worker<ScrapeUrlPayload>(
      name,
      (job: Job<ScrapeUrlPayload>) => this.extractionProcessor.process(job),
      {
        connection: this.connection,
        lockDuration: LOCK_DURATION,
        concurrency: WORKER_CONCURRENCY,
      },
    );

    worker.on('failed', (job, err) => {
      this.logger.error(`[${name}] job ${job?.id} failed: ${err.message}`);
    });

    this.queues.set(userId, queue);
    this.workers.set(userId, worker);
    this.logger.log(`Created queue + worker → ${name}`);
  }

  async addJob(userId: string, payload: ScrapeUrlPayload): Promise<void> {
    if (!this.queues.has(userId)) this.createQueueForUser(userId);
    const queue = this.queues.get(userId);
    if (!queue) throw new Error(`No queue available for user ${userId}`);
    await queue.add(JOB_SCRAPE_URL, payload, { jobId: payload.jobId });
  }

  getQueue(userId: string): Queue | undefined {
    return this.queues.get(userId);
  }

  async getBullJob(userId: string, jobId: string): Promise<Job | undefined> {
    const queue = this.queues.get(userId);
    if (!queue) return undefined;
    return (await queue.getJob(jobId)) ?? undefined;
  }

  async removeJob(userId: string, jobId: string): Promise<void> {
    const bullJob = await this.getBullJob(userId, jobId);
    if (bullJob) await bullJob.remove().catch(() => {});
  }

  async getJobCounts(userId: string) {
    const queue = this.queues.get(userId);
    if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    return queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  async getAllQueueStats() {
    const results: Array<Record<string, unknown>> = [];

    for (const [userId, queue] of this.queues.entries()) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
      results.push({ userId, queueName: `scraper-${userId}`, ...counts });
    }

    return results;
  }
}
