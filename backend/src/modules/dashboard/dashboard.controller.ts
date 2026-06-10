import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { ExportJob, ExportJobDocument } from '../database/schemas/export-job.schema';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(ExtractionJob.name)
    private readonly jobModel: Model<ExtractionJobDocument>,
    @InjectModel(ExportJob.name)
    private readonly exportJobModel: Model<ExportJobDocument>,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Extraction & system stats for the dashboard' })
  async getStats() {
    const [
      totalProducts,
      completedProducts,
      failedProducts,
      flaggedProducts,
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
      avgConfidenceResult,
      categoryBreakdown,
    ] = await Promise.all([
      this.productModel.countDocuments().exec(),
      this.productModel.countDocuments({ extractionStatus: 'completed' }).exec(),
      this.productModel.countDocuments({ extractionStatus: 'failed' }).exec(),
      this.productModel.countDocuments({ isFlagged: true }).exec(),
      this.jobModel.countDocuments({ status: 'queued' }).exec(),
      this.jobModel.countDocuments({ status: 'processing' }).exec(),
      this.jobModel.countDocuments({ status: 'completed' }).exec(),
      this.jobModel.countDocuments({ status: 'failed' }).exec(),
      this.productModel
        .aggregate([
          { $group: { _id: null, avg: { $avg: '$confidenceScore' } } },
        ])
        .exec(),
      this.productModel
        .aggregate([
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .exec(),
    ]);

    const successRate =
      completedJobs + failedJobs > 0
        ? Math.round((completedJobs / (completedJobs + failedJobs)) * 100)
        : 0;

    return {
      products: {
        total: totalProducts,
        completed: completedProducts,
        failed: failedProducts,
        flagged: flaggedProducts,
        avgConfidenceScore: Math.round(avgConfidenceResult[0]?.avg ?? 0),
      },
      jobs: {
        queued: pendingJobs,
        processing: processingJobs,
        completed: completedJobs,
        failed: failedJobs,
        successRate: `${successRate}%`,
      },
      categoryBreakdown: categoryBreakdown.map((c: any) => ({
        category: c._id || 'Uncategorized',
        count: c.count,
      })),
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Recent extraction jobs for job-monitor panel' })
  async getJobs() {
    const jobs = await this.jobModel
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return { data: jobs };
  }

  @Get('jobs/failed')
  @ApiOperation({ summary: 'Failed jobs — with error reasons for retry panel' })
  async getFailedJobs() {
    const jobs = await this.jobModel
      .find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return { data: jobs, count: jobs.length };
  }

  @Get('exports')
  @ApiOperation({ summary: 'Export history — completed export files' })
  async getExportHistory() {
    const exports = await this.exportJobModel
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return { data: exports };
  }
}
