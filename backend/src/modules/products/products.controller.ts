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
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { Category, CategoryDocument } from '../database/schemas/category.schema';
import { CacheService } from '../cache/cache.service';

const CATEGORIES_TTL = 300; 
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
  @ApiQuery({ name: 'flagged', required: false, type: Boolean })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'price', 'name'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async findAll(
    @CurrentUser() user: { id: string; role: string },
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
    if (user.role !== UserRole.ADMIN) filter.ownedBy = new Types.ObjectId(user.id);
    if (status) filter.extractionStatus = status;
    if (category) filter.subCategory = { $regex: `^${category}$`, $options: 'i' };
    if (subCategory) filter.productType = { $regex: `^${subCategory}$`, $options: 'i' };
    if (seller) filter['seller.sellerName'] = { $regex: seller, $options: 'i' };
    if (flagged !== undefined) filter.isFlagged = flagged === 'true';
    if (minConfidence) filter.confidenceScore = { $gte: Number(minConfidence) };

    const sort: Record<string, 1 | -1> = {};
    if (sortBy === 'price') sort.price = sortOrder === 'asc' ? 1 : -1;
    else if (sortBy === 'name') sort.productName = sortOrder === 'asc' ? 1 : -1;
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
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException('Product not found');
    if (user.role !== UserRole.ADMIN && product.ownedBy?.toString() !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    await product.deleteOne();
    await this.cacheService.delPattern('products:*');
  }
}
