import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import sharp from 'sharp';
import axios from 'axios';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
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
  s3Key: string;
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

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly imagePrefix: string;
  private readonly logoPrefix: string;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {
    this.bucket = config.get<string>('s3.bucket')!;
    this.imagePrefix = config.get<string>('s3.imagePrefix') ?? 'images';
    this.logoPrefix = config.get<string>('s3.logoPrefix') ?? 'logos';

    this.s3 = new S3Client({
      region: config.get<string>('s3.region') ?? 'ap-south-1',
      credentials: {
        accessKeyId: config.get<string>('s3.accessKeyId')!,
        secretAccessKey: config.get<string>('s3.secretAccessKey')!,
      },
    });
  }

  private buildUrl(key: string): string {
    const region = this.config.get<string>('s3.region') ?? 'ap-south-1';
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  private async uploadToS3(buffer: Buffer, key: string): Promise<void> {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'max-age=31536000',
      },
    });
    await upload.done();
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await axios.get<Buffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.aajjo.com/',
      },
    });
    return Buffer.from(response.data);
  }

  private async computePHash(buffer: Buffer): Promise<string> {
    try {
      const hash = await imageHashAsync({ data: buffer, ext: 'webp' }, 16, true);
      return hash as string;
    } catch {
      return '';
    }
  }

  private async isDuplicate(pHash: string): Promise<boolean> {
    if (!pHash) return false;
    const exists = await this.productModel.exists({ 'images.pHash': pHash }).exec();
    return !!exists;
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
        this.logger.warn(`Image too small (${origWidth}×${origHeight}) — skipping: ${originalUrl}`);
        return null;
      }

      const webpBuffer = await sharpInstance.webp({ quality: 92, effort: 4 }).toBuffer();

      const pHash = await this.computePHash(webpBuffer);
      if (await this.isDuplicate(pHash)) {
        this.logger.debug(`Duplicate pHash detected — skipping: ${originalUrl}`);
        return null;
      }

      const slug = `${productId}_${Date.now()}`;
      const imageKey = `${this.imagePrefix}/${productId}/${slug}.webp`;

      await this.uploadToS3(webpBuffer, imageKey);

      const finalMeta = await sharp(webpBuffer).metadata();

      return {
        originalUrl,
        storageUrl: this.buildUrl(imageKey),
        s3Key: imageKey,
        thumbnailUrl: this.buildUrl(imageKey),
        isFeatured,
        width: finalMeta.width ?? origWidth,
        height: finalMeta.height ?? origHeight,
        sizeBytes: webpBuffer.length,
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

  isOwnStorageUrl(url: string): boolean {
    return !!url && url.includes(`${this.bucket}.s3.`);
  }

  // Seller logos are re-used across every product from the same seller, so they're
  // keyed by seller slug (not a timestamp) and re-uploading overwrites the same S3
  // object instead of accumulating duplicates. Unlike product photos they skip the
  // min-dimension check (logos are legitimately small) and pHash dedup (identical
  // logos across a seller's products are expected, not duplicates to reject).
  async processSellerLogo(
    originalUrl: string,
    sellerSlug: string,
  ): Promise<{ storageUrl: string; s3Key: string } | null> {
    try {
      const rawBuffer = await this.downloadImage(originalUrl);
      const webpBuffer = await sharp(rawBuffer).webp({ quality: 92, effort: 4 }).toBuffer();

      const logoKey = `${this.logoPrefix}/${sellerSlug}.webp`;
      await this.uploadToS3(webpBuffer, logoKey);

      return { storageUrl: this.buildUrl(logoKey), s3Key: logoKey };
    } catch (err: any) {
      this.logger.error(`Failed to process seller logo ${originalUrl}: ${err.message}`);
      return null;
    }
  }

  async deleteImage(s3Key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    } catch (err: any) {
      this.logger.error(`Failed to delete S3 object ${s3Key}: ${err.message}`);
    }
  }
}
