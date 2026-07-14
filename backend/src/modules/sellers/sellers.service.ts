import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Seller, SellerDocument } from '../database/schemas/seller.schema';
import { SellerData } from '../extractor/extractor.service';
import { ImageService } from '../image/image.service';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    private readonly imageService: ImageService,
  ) {}

  // Returns the seller's logo URL as it should be stored on the product being
  // saved — either the already-hosted S3 URL, or a freshly uploaded one.
  private async resolveLogoUrl(sellerName: string, rawLogoUrl: string): Promise<string> {
    if (!rawLogoUrl) return '';
    if (this.imageService.isOwnStorageUrl(rawLogoUrl)) return rawLogoUrl;

    const existing = await this.sellerModel.findOne({ sellerName }).lean().exec();
    if (existing?.sellerLogoUrl && this.imageService.isOwnStorageUrl(existing.sellerLogoUrl)) {
      return existing.sellerLogoUrl;
    }

    const slug = sellerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seller';
    const uploaded = await this.imageService.processSellerLogo(rawLogoUrl, slug);
    return uploaded?.storageUrl ?? rawLogoUrl;
  }

  async upsertFromProduct(seller: SellerData): Promise<string> {
    if (!seller?.sellerName?.trim()) return '';

    const sellerName = seller.sellerName.trim();
    const logoUrl = await this.resolveLogoUrl(sellerName, seller.sellerLogoUrl ?? '');

    try {
      await this.sellerModel.findOneAndUpdate(
        { sellerName },
        {
          $set: {
            sellerLogoUrl:    logoUrl,
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
      this.logger.warn(`Seller upsert failed for "${sellerName}": ${err.message}`);
    }

    return logoUrl;
  }

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
    letter?: string;
  }): Promise<{ data: Seller[]; meta: object }> {
    const { page, limit, search, letter } = params;
    const skip = (page - 1) * limit;

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = search
      ? { sellerName: { $regex: esc(search), $options: 'i' } }
      : letter === '#'
        ? { sellerName: { $regex: '^[^a-zA-Z]', $options: 'i' } }
        : letter
          ? { sellerName: { $regex: `^${esc(letter)}`, $options: 'i' } }
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
