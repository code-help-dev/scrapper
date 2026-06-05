import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { Category, CategoryDocument } from '../database/schemas/category.schema';
import { CacheService } from '../cache/cache.service';

const CATEGORIES_TTL = 300; // 5 minutes
const SUBCATEGORIES_TTL = 300;
const PRODUCTS_LIST_TTL = 30;

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    private readonly cacheService: CacheService,
  ) {}

  // ── GET /api/products/categories ─────────────────────────────────────────
  // IMPORTANT: must be declared before :id routes

  @Get('categories')
  @ApiOperation({ summary: 'Get unique main categories with product counts' })
  async getCategories() {
    const cacheKey = 'products:categories';
    const cached = await this.cacheService.get<{ name: string; productCount: number }[]>(cacheKey);
    if (cached) return cached;

    // Primary: Category collection (populated by extraction pipeline)
    const fromCollection = await this.categoryModel
      .find()
      .select('name productCount')
      .sort({ productCount: -1 })
      .lean()
      .exec();

    if (fromCollection.length > 0) {
      const result = fromCollection.map((c) => ({ name: c.name, productCount: c.productCount }));
      await this.cacheService.set(cacheKey, result, CATEGORIES_TTL);
      return result;
    }

    // Fallback: aggregate from Product collection (pre-Category-schema data)
    const result = await this.productModel
      .aggregate([
        { $match: { category: { $exists: true, $ne: '' } } },
        { $group: { _id: '$category', productCount: { $sum: 1 } } },
        { $sort: { productCount: -1 } },
        { $project: { _id: 0, name: '$_id', productCount: 1 } },
      ])
      .exec();

    await this.cacheService.set(cacheKey, result, CATEGORIES_TTL);
    return result;
  }

  // ── GET /api/products/subcategories?category=X ───────────────────────────

  @Get('subcategories')
  @ApiOperation({ summary: 'Get subcategories for a given main category' })
  @ApiQuery({ name: 'category', required: true })
  async getSubcategories(@Query('category') category: string) {
    if (!category) return [];

    const cacheKey = `products:subcategories:${category.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = await this.cacheService.get<{ name: string; productCount: number }[]>(cacheKey);
    if (cached) return cached;

    // Always derive from Product collection — the Category.subCategories array can contain
    // stale or cross-contaminated entries due to the Mongoose subdoc _id bug (fixed in schema).
    const result = await this.productModel
      .aggregate([
        {
          $match: {
            category: { $regex: `^${category}$`, $options: 'i' },
            subCategory: { $exists: true, $ne: '' },
          },
        },
        { $group: { _id: '$subCategory', productCount: { $sum: 1 } } },
        { $sort: { productCount: -1 } },
        { $project: { _id: 0, name: '$_id', productCount: 1 } },
      ])
      .exec();

    await this.cacheService.set(cacheKey, result, SUBCATEGORIES_TTL);
    return result;
  }

  // ── GET /api/products ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List products — paginated with filters and sort' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'subCategory', required: false })
  @ApiQuery({ name: 'seller', required: false })
  @ApiQuery({ name: 'flagged', required: false, type: Boolean })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'price', 'name'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('seller') seller?: string,
    @Query('flagged') flagged?: string,
    @Query('minConfidence') minConfidence?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {};
    if (status) filter.extractionStatus = status;
    if (category) filter.category = { $regex: `^${category}$`, $options: 'i' };
    if (subCategory) filter.subCategory = { $regex: `^${subCategory}$`, $options: 'i' };
    if (seller) filter['seller.sellerName'] = { $regex: seller, $options: 'i' };
    if (flagged !== undefined) filter.isFlagged = flagged === 'true';
    if (minConfidence) filter.confidenceScore = { $gte: Number(minConfidence) };

    const sort: Record<string, 1 | -1> = {};
    if (sortBy === 'price') sort.price = sortOrder === 'asc' ? 1 : -1;
    else if (sortBy === 'name') sort.productName = sortOrder === 'asc' ? 1 : -1;
    else sort.createdAt = -1;

    // Cache key includes all filter + pagination params
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

  // ── GET /api/products/:id ─────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get full product detail — specs, images, seller' })
  async findOne(@Param('id') id: string) {
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  // ── GET /api/products/:id/images ──────────────────────────────────────────

  @Get(':id/images')
  @ApiOperation({ summary: 'Get images array for a product' })
  async getImages(@Param('id') id: string) {
    const product = await this.productModel
      .findById(id)
      .select('images productName')
      .exec();
    if (!product) throw new NotFoundException('Product not found');
    return { productId: id, images: product.images };
  }

  // ── DELETE /api/products/:id ──────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product document' })
  async remove(@Param('id') id: string) {
    const result = await this.productModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('Product not found');
    // Invalidate category caches since counts changed
    await this.cacheService.delPattern('products:*');
  }
}
