import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../database/schemas/user.schema';
import { ExtractionJob, ExtractionJobDocument } from '../database/schemas/extraction-job.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import { DynamicQueueService } from '../queue/dynamic-queue.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(ExtractionJob.name) private readonly jobModel: Model<ExtractionJobDocument>,
    private readonly dynamicQueueService: DynamicQueueService,
  ) {}

  async listUsers(): Promise<Array<Record<string, unknown>>> {
    const users = await this.userModel
      .find({ _r: { $ne: true } })
      .select('-passwordHash -refreshTokenHash')
      .lean()
      .exec();

    const jobCountsByUser = await this.jobModel
      .aggregate([
        { $group: { _id: '$submittedBy', total: { $sum: 1 } } },
      ])
      .exec();

    const countMap = new Map(
      jobCountsByUser.map((r: any) => [r._id?.toString(), r.total as number]),
    );

    return users.map((u) => ({
      ...(u as Record<string, unknown>),
      jobCount: countMap.get((u as any)._id?.toString()) ?? 0,
    }));
  }

  async createUser(email: string, password: string, role: UserRole) {
    const exists = await this.userModel.findOne({ email: email.toLowerCase() }).exec();
    if (exists) throw new BadRequestException('Email already registered');

    const userCount = await this.userModel.countDocuments().exec();
    if (userCount >= 30) {
      throw new BadRequestException('User limit of 30 reached — cannot create more users');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new this.userModel({ email: email.toLowerCase(), passwordHash, role });
    const saved = await user.save();

    try {
      this.dynamicQueueService.createQueueForUser(saved.id.toString());
    } catch (qErr: any) {
      this.logger.warn(`createQueueForUser failed for ${saved.id}: ${qErr.message}`);
    }

    const raw = saved.toObject() as unknown as Record<string, unknown>;
    const { passwordHash: _ph, refreshTokenHash: _rth, _r: _hidden, __v: _v, ...safeUser } = raw;
    return safeUser;
  }

  async updateUser(id: string, updates: { role?: UserRole; active?: boolean }) {
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');

    if (updates.role !== undefined) user.role = updates.role;
    if (updates.active === false) (user as any)._r = true;
    if (updates.active === true) (user as any)._r = false;

    await user.save();
    return { id, updated: true };
  }

  async getOverview() {
    const users = await this.userModel
      .find({ _r: { $ne: true } })
      .select('email role')
      .lean()
      .exec();

    const userIds = users.map((u) => (u as any)._id);

    const jobStats = await this.jobModel
      .aggregate([
        { $match: { submittedBy: { $in: userIds } } },
        {
          $group: {
            _id: { user: '$submittedBy', status: '$status' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const statsMap = new Map<string, Record<string, number>>();
    for (const row of jobStats) {
      const uid = row._id.user?.toString();
      if (!statsMap.has(uid)) statsMap.set(uid, {});
      statsMap.get(uid)![row._id.status] = row.count;
    }

    const queueStats = await this.dynamicQueueService.getAllQueueStats();
    const queueMap = new Map(queueStats.map((q) => [q.userId, q]));

    return users.map((u) => {
      const uid = (u as any)._id?.toString();
      const s = statsMap.get(uid) ?? {};
      const q = queueMap.get(uid);
      return {
        userId: uid,
        email: u.email,
        role: u.role,
        pending: s['queued'] ?? 0,
        running: s['processing'] ?? 0,
        completed: s['completed'] ?? 0,
        failed: s['failed'] ?? 0,
        queue: q
          ? { waiting: q.waiting, active: q.active, delayed: q.delayed }
          : { waiting: 0, active: 0, delayed: 0 },
      };
    });
  }

  async getUserJobCounts(userId: string) {
    const id = new Types.ObjectId(userId);
    const result = await this.jobModel
      .aggregate([
        { $match: { submittedBy: id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const counts: Record<string, number> = {};
    for (const r of result) counts[r._id] = r.count;
    return {
      queued: counts['queued'] ?? 0,
      processing: counts['processing'] ?? 0,
      completed: counts['completed'] ?? 0,
      failed: counts['failed'] ?? 0,
    };
  }
}
