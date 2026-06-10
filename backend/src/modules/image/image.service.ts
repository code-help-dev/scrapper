import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import sharp from 'sharp';
import axios from 'axios';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Product, ProductDocument } from '../database/schemas/product.schema';

const imageHashLib = require('image-hash');
const imageHashAsync = (input: unknown, bits: number, precise: boolean): Promise<string> =>
  new Promise((resolve, reject) =>
    imageHashLib.imageHash(input, bits, precise, (err: Error | null, data: string) => {
      if (err) reject(err);
      else resolve(data);
    }),
  );

export interface ProcessedImage {
  originalUrl: string;
  storageUrl: string;         
  cloudinaryPublicId: string;
  thumbnailUrl: string;
  isFeatured: boolean;
  width: number;
  height: number;
  sizeBytes: number;
  pHash: string;
  format: string;
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;
const THUMBNAIL_WIDTH = 300;

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private readonly folder: string;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {
    const { cloudName, apiKey, apiSecret, folder } = {
      cloudName: config.get<string>('cloudinary.cloudName'),
      apiKey: config.get<string>('cloudinary.apiKey'),
      apiSecret: config.get<string>('cloudinary.apiSecret'),
      folder: config.get<string>('cloudinary.folder') ?? 'aajjo-scraper',
    };

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    this.folder = folder;
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await axios.get<Buffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.aajjo.com/',
      },
    });
    return Buffer.from(response.data);
  }

  private async computePHash(buffer: Buffer): Promise<string> {
    try {
      
      const hash = await imageHashAsync(
        { data: buffer, ext: 'webp' },
        16,
        true,
      );
      return hash as string;
    } catch {
      return '';
    }
  }

  private async isDuplicate(pHash: string): Promise<boolean> {
    if (!pHash) return false;
    const exists = await this.productModel
      .exists({ 'images.pHash': pHash })
      .exec();
    return !!exists;
  }

  private uploadToCloudinary(
    buffer: Buffer,
    publicId: string,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: this.folder,
          public_id: publicId,
          resource_type: 'image',
          overwrite: false,
          
          format: 'webp',
          quality: 'auto:best',
          
          transformation: [{ flags: 'preserve_transparency' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!);
        },
      );
      stream.end(buffer);
    });
  }

  private buildThumbnailUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      width: THUMBNAIL_WIDTH,
      crop: 'fit',
      format: 'webp',
      quality: 'auto',
    });
  }

  async processImage(
    originalUrl: string,
    isFeatured: boolean,
    productId: string,
  ): Promise<ProcessedImage | null> {
    try {
      const rawBuffer = await this.downloadImage(originalUrl);

      const sharpInstance = sharp(rawBuffer);
      const metadata = await sharpInstance.metadata();

      const origWidth = metadata.width ?? 0;
      const origHeight = metadata.height ?? 0;

      if (origWidth < MIN_WIDTH || origHeight < MIN_HEIGHT) {
        this.logger.warn(
          `Image too small (${origWidth}×${origHeight}) — skipping: ${originalUrl}`,
        );
        return null;
      }

      const webpBuffer = await sharpInstance
        .webp({ quality: 95, effort: 4 })
        .toBuffer();

      const pHash = await this.computePHash(webpBuffer);
      if (await this.isDuplicate(pHash)) {
        this.logger.debug(`Duplicate pHash detected — skipping: ${originalUrl}`);
        return null;
      }

      const publicId = `${productId}_${Date.now()}`;
      const uploaded = await this.uploadToCloudinary(webpBuffer, publicId);

      const thumbnailUrl = this.buildThumbnailUrl(uploaded.public_id);

      return {
        originalUrl,
        storageUrl: uploaded.secure_url,
        cloudinaryPublicId: uploaded.public_id,
        thumbnailUrl,
        isFeatured,
        width: uploaded.width,
        height: uploaded.height,
        sizeBytes: uploaded.bytes,
        pHash,
        format: 'webp',
      };
    } catch (err: any) {
      this.logger.error(`Failed to process image ${originalUrl}: ${err.message}`);
      return null;
    }
  }

  async processProductImages(
    rawImages: { originalUrl: string; isFeatured: boolean }[],
    productId: string,
  ): Promise<ProcessedImage[]> {
    const results: ProcessedImage[] = [];

    for (const img of rawImages) {
      const processed = await this.processImage(img.originalUrl, img.isFeatured, productId);
      if (processed) results.push(processed);
    }

    if (results.length > 0 && !results.some((i) => i.isFeatured)) {
      results[0].isFeatured = true;
    }

    this.logger.log(`Processed ${results.length}/${rawImages.length} images for product ${productId}`);
    return results;
  }

  async deleteImage(cloudinaryPublicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(cloudinaryPublicId);
    } catch (err: any) {
      this.logger.error(`Failed to delete Cloudinary asset ${cloudinaryPublicId}: ${err.message}`);
    }
  }
}
