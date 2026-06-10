import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { CacheService } from '../cache/cache.service';
import { SellersService } from './sellers.service';

const SELLER_CACHE_TTL = 60;

@ApiTags('Sellers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sellers')
export class SellersController {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly cacheService: CacheService,
    private readonly sellersService: SellersService,
  ) {}

  private esc(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── GET /api/sellers ──────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List sellers from the dedicated sellers collection' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  async listSellers(
    @Query('page') page = 1,
    @Query('limit') limit = 24,
    @Query('search') search?: string,
  ) {
    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100);

    const { data: sellers, meta } = await this.sellersService.findAll({
      page: pageNum,
      limit: limitNum,
      search,
    });

    // Attach live product count from the Product collection
    const sellerNames = sellers.map((s) => (s as any).sellerName as string);
    const counts = sellerNames.length
      ? await this.productModel.aggregate([
          { $match: { 'seller.sellerName': { $in: sellerNames } } },
          { $group: { _id: '$seller.sellerName', productCount: { $sum: 1 } } },
        ])
      : [];

    const countMap = new Map<string, number>(
      counts.map((c: { _id: string; productCount: number }) => [c._id, c.productCount]),
    );

    const data = sellers.map((s: any) => ({
      ...s,
      productCount: countMap.get(s.sellerName) ?? 0,
    }));

    return { data, meta };
  }

  // ── GET /api/sellers/:sellerName/categories ───────────────────────────────
  @Get(':sellerName/categories')
  @ApiOperation({ summary: 'Get categories for a specific seller' })
  async getSellerCategories(@Param('sellerName') sellerName: string) {
    const cacheKey = `sellers:${sellerName}:categories`;
    const cached = await this.cacheService.get<unknown>(cacheKey);
    if (cached) return cached;

    const result = await this.productModel.aggregate([
      {
        $match: {
          'seller.sellerName': { $regex: `^${this.esc(sellerName)}$`, $options: 'i' },
          category: { $exists: true, $ne: '' },
        },
      },
      { $group: { _id: '$category', productCount: { $sum: 1 } } },
      { $sort: { productCount: -1 } },
      { $project: { _id: 0, name: '$_id', productCount: 1 } },
    ]);

    await this.cacheService.set(cacheKey, result, SELLER_CACHE_TTL);
    return result;
  }

  // ── GET /api/sellers/:sellerName/subcategories?category=X ─────────────────
  @Get(':sellerName/subcategories')
  @ApiOperation({ summary: 'Get subcategories for a seller within a category' })
  @ApiQuery({ name: 'category', required: true })
  async getSellerSubcategories(
    @Param('sellerName') sellerName: string,
    @Query('category') category: string,
  ) {
    if (!category) return [];

    return this.productModel.aggregate([
      {
        $match: {
          'seller.sellerName': { $regex: `^${this.esc(sellerName)}$`, $options: 'i' },
          category: { $regex: `^${this.esc(category)}$`, $options: 'i' },
          subCategory: { $exists: true, $ne: '' },
        },
      },
      { $group: { _id: '$subCategory', productCount: { $sum: 1 } } },
      { $sort: { productCount: -1 } },
      { $project: { _id: 0, name: '$_id', productCount: 1 } },
    ]);
  }

  // ── GET /api/sellers/:sellerName/products ─────────────────────────────────
  @Get(':sellerName/products')
  @ApiOperation({ summary: "Get a seller's products with optional filters" })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'subCategory', required: false, isArray: true })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'price', 'name'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async getSellerProducts(
    @Param('sellerName') sellerName: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {
      'seller.sellerName': { $regex: `^${this.esc(sellerName)}$`, $options: 'i' },
    };
    if (category) filter.category = { $regex: `^${this.esc(category)}$`, $options: 'i' };
    if (subCategory) {
      const subs = subCategory.split(',').map((s) => s.trim()).filter(Boolean);
      filter.subCategory = subs.length === 1
        ? { $regex: `^${this.esc(subs[0])}$`, $options: 'i' }
        : { $in: subs.map((s) => new RegExp(`^${this.esc(s)}$`, 'i')) };
    }

    const sort: Record<string, 1 | -1> = {};
    if (sortBy === 'price') sort.price = sortOrder === 'asc' ? 1 : -1;
    else if (sortBy === 'name') sort.productName = sortOrder === 'asc' ? 1 : -1;
    else sort.createdAt = -1;

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

    return {
      data: items,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    };
  }

  // ── GET /api/sellers/:sellerName ──────────────────────────────────────────
  @Get(':sellerName')
  @ApiOperation({ summary: 'Get seller detail from the sellers collection' })
  async getSeller(@Param('sellerName') sellerName: string) {
    const seller = await this.sellersService.findOne(sellerName);
    if (!seller) throw new NotFoundException(`Seller "${sellerName}" not found`);

    const [countResult] = await this.productModel.aggregate([
      { $match: { 'seller.sellerName': { $regex: `^${this.esc(sellerName)}$`, $options: 'i' } } },
      { $count: 'total' },
    ]);

    return { ...seller.toObject(), productCount: countResult?.total ?? 0 };
  }
}
