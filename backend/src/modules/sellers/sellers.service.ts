import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Seller, SellerDocument } from '../database/schemas/seller.schema';
import { SellerData } from '../extractor/extractor.service';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
  ) {}

  async upsertFromProduct(seller: SellerData): Promise<void> {
    if (!seller?.sellerName?.trim()) return;

    try {
      await this.sellerModel.findOneAndUpdate(
        { sellerName: seller.sellerName.trim() },
        {
          $set: {
            sellerLogoUrl:    seller.sellerLogoUrl   ?? '',
            gstNumber:        seller.gstNumber       ?? '',
            address:          seller.address         ?? '',
            state:            seller.state           ?? '',
            country:          seller.country         ?? '',
            businessType:     seller.businessType    ?? '',
            yearsEstablished: seller.yearsEstablished ?? null,
            numberOfEmployees:seller.numberOfEmployees ?? '',
            turnover:         seller.turnover        ?? '',
            legalStatus:      seller.legalStatus     ?? '',
            contactDetails:   seller.contactDetails  ?? '',
            aajjoProfileUrl:  seller.aajjoProfileUrl ?? '',
          },
        },
        { upsert: true, new: true },
      );
    } catch (err: any) {
      this.logger.warn(`Seller upsert failed for "${seller.sellerName}": ${err.message}`);
    }
  }

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
  }): Promise<{ data: Seller[]; meta: object }> {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    const filter = search
      ? { sellerName: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};

    const [data, total] = await Promise.all([
      this.sellerModel.find(filter).sort({ sellerName: 1 }).skip(skip).limit(limit).lean().exec(),
      this.sellerModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data as unknown as Seller[],
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(sellerName: string): Promise<SellerDocument | null> {
    return this.sellerModel
      .findOne({ sellerName: { $regex: `^${sellerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
      .exec();
  }
}
