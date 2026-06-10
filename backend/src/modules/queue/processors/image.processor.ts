import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QUEUE_IMAGE, JOB_PROCESS_IMAGE } from '../queue.constants';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { ImageService } from '../../image/image.service';
import { ProcessImagePayload } from './extraction.processor';

@Processor(QUEUE_IMAGE)
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly imageService: ImageService,
  ) {
    super();
  }

  async process(job: Job<ProcessImagePayload>): Promise<void> {
    const { productId, images } = job.data;
    this.logger.log(`[Image] Processing ${images.length} images for product ${productId}`);

    const processed = await this.imageService.processProductImages(
      images,
      productId,
    );

    if (processed.length > 0) {
      await this.productModel.findByIdAndUpdate(productId, {
        $set: { images: processed },
      });
      this.logger.log(
        `[Image] Updated product ${productId} with ${processed.length} processed images`,
      );
    } else {
      this.logger.warn(`[Image] No valid images processed for product ${productId}`);
    }
  }
}
