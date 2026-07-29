import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  UseGuards,
  Delete,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Response } from 'express';
import { stringify } from 'csv-stringify/sync';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { Category, CategoryDocument } from '../database/schemas/category.schema';
import {
  ExtractionJob,
  ExtractionJobDocument,
} from '../database/schemas/extraction-job.schema';
import { CacheService } from '../cache/cache.service';
import { ImageService } from '../image/image.service';

const CATEGORIES_TTL = 300;
const SUBCATEGORIES_TTL = 300;
const PRODUCTS_LIST_TTL = 30;

class BulkDeleteProductsFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() flagged?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() minConfidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxConfidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}

class BulkDeleteProductsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: BulkDeleteProductsFilterDto })
  @IsOptional() @ValidateNested() @Type(() => BulkDeleteProductsFilterDto)
  filter?: BulkDeleteProductsFilterDto;

  @ApiProperty() @IsBoolean() confirm: boolean;
}

class ExportSelectedProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray() @IsString({ each: true })
  productIds: string[];
}

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(ExtractionJob.name)
    private readonly extractionJobModel: Model<ExtractionJobDocument>,
    private readonly cacheService: CacheService,
    private readonly imageService: ImageService,
  ) {}

  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Shared by the single DELETE :id endpoint and bulk-delete. Order matters:
  // 1) pull the ids out of any job's productIds first — a crash here only
  //    leaves a still-existing product temporarily unlisted in a job, which is
  //    harmless, whereas doing it after the doc delete could leave a job
  //    referencing a phantom id forever;
  // 2) best-effort S3 image cleanup before removing the doc — the doc is the
  //    only record of each image's s3Key, so deleting it first would turn any
  //    later S3 failure into permanently unrecoverable orphaned storage.
  private async deleteProductsByIds(
    ids: Types.ObjectId[],
  ): Promise<{ deleted: number; failed: { id: string; reason: string }[] }> {
    if (!ids.length) return { deleted: 0, failed: [] };

    await this.extractionJobModel.updateMany(
      { productIds: { $in: ids } },
      { $pull: { productIds: { $in: ids } } },
    );

    const products = await this.productModel
      .find({ _id: { $in: ids } })
      .select('_id images')
      .lean()
      .exec();

    const failed: { id: string; reason: string }[] = [];
    let deleted = 0;
    for (const product of products) {
      const id = (product._id as Types.ObjectId).toString();
      try {
        await Promise.all(
          (product.images ?? [])
            .filter((img: any) => img.s3Key)
            .map((img: any) => this.imageService.deleteImage(img.s3Key)),
        );
        await this.productModel.deleteOne({ _id: product._id }).exec();
        deleted++;
      } catch (err: any) {
        failed.push({ id, reason: err.message ?? 'Unknown error' });
      }
    }

    await this.cacheService.delPattern('products:*');
    return { deleted, failed };
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get unique main categories with product counts' })
  async getCategories(@CurrentUser() user: { id: string; role: string }) {
    const cacheKey = user.role === UserRole.ADMIN
      ? 'products:categories'
      : `products:categories:${user.id}`;
    const cached = await this.cacheService.get<{ name: string; productCount: number }[]>(cacheKey);
    if (cached) return cached;

    const matchStage: Record<string, unknown> = { subCategory: { $exists: true, $ne: '' } };
    if (user.role !== UserRole.ADMIN) matchStage.ownedBy = new Types.ObjectId(user.id);

    const result = await this.productModel
      .aggregate([
        { $match: matchStage },
        { $group: { _id: '$subCategory', productCount: { $sum: 1 } } },
        { $sort: { productCount: -1 } },
        { $project: { _id: 0, name: '$_id', productCount: 1 } },
      ])
      .exec();

    await this.cacheService.set(cacheKey, result, CATEGORIES_TTL);
    return result;
  }

  @Get('subcategories')
  @ApiOperation({ summary: 'Get subcategories, optionally filtered by main category' })
  @ApiQuery({ name: 'category', required: false })
  async getSubcategories(
    @CurrentUser() user: { id: string; role: string },
    @Query('category') category?: string,
  ) {
    const userKey = user.role === UserRole.ADMIN ? '__admin__' : user.id;
    const cacheKey = category
      ? `products:subcategories:${userKey}:${category.toLowerCase().replace(/\s+/g, '_')}`
      : `products:subcategories:${userKey}:__all__`;
    const cached = await this.cacheService.get<{ name: string; productCount: number }[]>(cacheKey);
    if (cached) return cached;

    const matchStage: Record<string, unknown> = { productType: { $exists: true, $ne: '' } };
    if (category) matchStage.subCategory = { $regex: `^${category}$`, $options: 'i' };
    if (user.role !== UserRole.ADMIN) matchStage.ownedBy = new Types.ObjectId(user.id);

    const result = await this.productModel
      .aggregate([
        { $match: matchStage },
        { $group: { _id: '$productType', productCount: { $sum: 1 } } },
        { $sort: { productCount: -1 } },
        { $project: { _id: 0, name: '$_id', productCount: 1 } },
      ])
      .exec();

    await this.cacheService.set(cacheKey, result, SUBCATEGORIES_TTL);
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'List products — paginated with filters and sort' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'subCategory', required: false })
  @ApiQuery({ name: 'seller', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Search by product name' })
  @ApiQuery({ name: 'flagged', required: false, type: Boolean })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  @ApiQuery({ name: 'maxConfidence', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'price', 'name', 'confidence'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('seller') seller?: string,
    @Query('search') search?: string,
    @Query('flagged') flagged?: string,
    @Query('minConfidence') minConfidence?: number,
    @Query('maxConfidence') maxConfidence?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {};
    if (user.role !== UserRole.ADMIN) filter.ownedBy = new Types.ObjectId(user.id);
    if (status) filter.extractionStatus = status;
    if (category) filter.subCategory = { $regex: `^${category}$`, $options: 'i' };
    if (subCategory) filter.productType = { $regex: `^${subCategory}$`, $options: 'i' };
    if (seller) filter['seller.sellerName'] = { $regex: seller, $options: 'i' };
    if (search) filter.productName = { $regex: ProductsController.escapeRegExp(search), $options: 'i' };
    if (flagged !== undefined) filter.isFlagged = flagged === 'true';
    // Nest's global ValidationPipe (enableImplicitConversion) coerces an absent
    // optional `@Query() x?: number` into Number(undefined) = NaN, not undefined
    // — so `!== undefined` alone doesn't detect "not provided" here; NaN must be
    // filtered out explicitly or {$gte: NaN} silently matches zero documents.
    const min = typeof minConfidence === 'number' && !Number.isNaN(minConfidence) ? minConfidence : undefined;
    const max = typeof maxConfidence === 'number' && !Number.isNaN(maxConfidence) ? maxConfidence : undefined;
    if (min !== undefined || max !== undefined) {
      const range: Record<string, number> = {};
      if (min !== undefined) range.$gte = min;
      if (max !== undefined) range.$lte = max;
      filter.confidenceScore = range;
    }

    const sort: Record<string, 1 | -1> = {};
    if (sortBy === 'price') sort.price = sortOrder === 'asc' ? 1 : -1;
    else if (sortBy === 'name') sort.productName = sortOrder === 'asc' ? 1 : -1;
    else if (sortBy === 'confidence') sort.confidenceScore = sortOrder === 'asc' ? 1 : -1;
    else sort.createdAt = -1;

    const cacheKey = `products:list:${JSON.stringify({ filter, sort, skip, limitNum })}`;
    const cached = await this.cacheService.get<{ data: unknown[]; meta: unknown }>(cacheKey);
    if (cached) return cached;

    const [items, total] = await Promise.all([
      this.productModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select('-description -specifications -__v')
        .lean()
        .exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    const result = {
      data: items,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    };

    await this.cacheService.set(cacheKey, result, PRODUCTS_LIST_TTL);
    return result;
  }

  @Post('bulk-delete')
  @ApiOperation({
    summary: 'Delete multiple products at once (single delete: pass one id in productIds)',
    description:
      'Provide exactly one of productIds or filter. filter mode (e.g. {flagged:true}) ' +
      'deletes every matching product without needing to ship an id list — used for ' +
      '"delete all flagged". confirm must be true either way. Deletes S3 images and ' +
      'cleans up job cross-references for each product.',
  })
  async bulkDelete(
    @Body() dto: BulkDeleteProductsDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    if (dto.confirm !== true) {
      throw new BadRequestException('confirm must be true to delete products');
    }
    const hasIds = !!dto.productIds?.length;
    const hasFilter = !!dto.filter && Object.keys(dto.filter).length > 0;
    if (hasIds === hasFilter) {
      throw new BadRequestException('Provide exactly one of productIds or a non-empty filter');
    }

    const isAdmin = user.role === UserRole.ADMIN;
    const matchFilter: Record<string, unknown> = {};
    if (!isAdmin) matchFilter.ownedBy = new Types.ObjectId(user.id);

    if (hasIds) {
      const ids = dto.productIds!.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      matchFilter._id = { $in: ids };
    } else {
      const f = dto.filter!;
      if (f.flagged !== undefined) matchFilter.isFlagged = f.flagged;
      if (f.minConfidence !== undefined || f.maxConfidence !== undefined) {
        const range: Record<string, number> = {};
        if (f.minConfidence !== undefined) range.$gte = f.minConfidence;
        if (f.maxConfidence !== undefined) range.$lte = f.maxConfidence;
        matchFilter.confidenceScore = range;
      }
      if (f.category) matchFilter.subCategory = { $regex: `^${ProductsController.escapeRegExp(f.category)}$`, $options: 'i' };
      if (f.subCategory) matchFilter.productType = { $regex: `^${ProductsController.escapeRegExp(f.subCategory)}$`, $options: 'i' };
      if (f.status) matchFilter.extractionStatus = f.status;
    }

    const targetIds = (
      await this.productModel.find(matchFilter, { _id: 1 }).lean().exec()
    ).map((p) => p._id as Types.ObjectId);

    if (!targetIds.length) return { requested: 0, deleted: 0, failed: [] };

    const { deleted, failed } = await this.deleteProductsByIds(targetIds);

    this.logger.warn(
      `bulk-delete products — actor=${user.id}(${user.role}) mode=${hasIds ? 'ids' : 'filter'} requested=${targetIds.length} deleted=${deleted} failed=${failed.length}`,
    );

    return { requested: targetIds.length, deleted, failed };
  }

  @Post('export-selected')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export product name, source URL, and confidence score for selected products as CSV',
  })
  async exportSelected(
    @Body() dto: ExportSelectedProductsDto,
    @CurrentUser() user: { id: string; role: string },
    @Res() res: Response,
  ) {
    if (!dto.productIds?.length) {
      throw new BadRequestException('productIds must not be empty');
    }

    const ids = dto.productIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const filter: Record<string, unknown> = { _id: { $in: ids } };
    if (user.role !== UserRole.ADMIN) filter.ownedBy = new Types.ObjectId(user.id);

    const products = await this.productModel
      .find(filter)
      .select('productName sourceUrl confidenceScore')
      .lean()
      .exec();

    const columns = ['Product Name', 'Product URL', 'Confidence Score'];
    const rows = products.map((p) => ({
      'Product Name': p.productName ?? '',
      'Product URL': p.sourceUrl ?? '',
      'Confidence Score': p.confidenceScore ?? '',
    }));
    const csv = stringify(rows, { header: true, columns });
    const fileName = `products_urls_${Date.now()}.csv`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full product detail — specs, images, seller' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');
    if (user.role !== UserRole.ADMIN && product.ownedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    return product;
  }

  @Get(':id/images')
  @ApiOperation({ summary: 'Get images array for a product' })
  async getImages(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const product = await this.productModel
      .findById(id)
      .select('images productName ownedBy')
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    if (user.role !== UserRole.ADMIN && product.ownedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    return { productId: id, images: product.images };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product document' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    const product = await this.productModel.findById(id).select('_id ownedBy').exec();
    if (!product) throw new NotFoundException('Product not found');
    if (user.role !== UserRole.ADMIN && product.ownedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    await this.deleteProductsByIds([product._id as Types.ObjectId]);
  }
}
