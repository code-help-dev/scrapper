import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { create as xmlCreate } from 'xmlbuilder2';
import { stringify } from 'csv-stringify/sync';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { addHours } from 'date-fns';
import { Product, ProductDocument } from '../database/schemas/product.schema';
import { ExportJob, ExportJobDocument } from '../database/schemas/export-job.schema';
import { ExportFormat, ExportStatus } from '../../common/enums/export-format.enum';

export interface ExportFilters {
  category?: string;
  subCategory?: string;
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  productIds?: string[];
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly storagePath: string;
  private readonly expiryHours: number;

  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(ExportJob.name) private readonly exportJobModel: Model<ExportJobDocument>,
    config: ConfigService,
  ) {
    this.storagePath = config.get<string>('export.storagePath') ?? './exports';
    this.expiryHours = config.get<number>('export.downloadExpiryHours') ?? 48;
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  // ── Query products with filters ───────────────────────────────────────────

  private async queryProducts(filters: ExportFilters): Promise<ProductDocument[]> {
    // Explicit product selection takes precedence over filters.
    if (filters.productIds?.length) {
      const ids = filters.productIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      return this.productModel
        .find({ _id: { $in: ids } })
        .lean()
        .exec() as unknown as Promise<ProductDocument[]>;
    }

    const query: Record<string, unknown> = { extractionStatus: 'completed' };
    if (filters.category) query.category = { $regex: `^${filters.category}$`, $options: 'i' };
    if (filters.subCategory) query.subCategory = { $regex: `^${filters.subCategory}$`, $options: 'i' };
    if (filters.status) query.extractionStatus = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) (query.createdAt as Record<string, Date>)['$gte'] = filters.dateFrom;
      if (filters.dateTo) (query.createdAt as Record<string, Date>)['$lte'] = filters.dateTo;
    }
    return this.productModel.find(query).lean().exec() as unknown as Promise<ProductDocument[]>;
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  private readonly CSV_BASE_COLUMNS = [
    'id', 'productName', 'category', 'subCategory', 'price', 'currency',
    'moq', 'description', 'deliveryInformation', 'warrantyInformation',
    'extractionStatus', 'isFlagged', 'sourcePlatform', 'sourceUrl', 'confidenceScore',
    'sellerName', 'sellerLogoUrl', 'sellerGstNumber', 'sellerAddress', 'sellerState',
    'sellerCountry', 'sellerBusinessType', 'sellerYearsEstablished', 'sellerEmployees',
    'sellerTurnover', 'sellerLegalStatus', 'sellerContact', 'sellerProfileUrl',
    'imageUrls', 'thumbnailUrls',
  ];

  private generateCsv(products: ProductDocument[]): Buffer {
    if (!products.length) {
      return Buffer.from(this.CSV_BASE_COLUMNS.join(',') + '\n', 'utf-8');
    }

    const rows = products.map((p) => {
      const s = (p.seller as any) ?? {};
      const specFlat: Record<string, string> = {};
      (p.specifications ?? []).forEach((spec: any) => {
        specFlat[`spec_${spec.name}`] = spec.value;
      });
      return {
        id: (p as any)._id.toString(),
        productName: p.productName,
        category: p.category,
        subCategory: p.subCategory,
        price: p.price,
        currency: p.currency,
        moq: p.moq,
        description: p.description,
        deliveryInformation: p.deliveryInformation ?? '',
        warrantyInformation: p.warrantyInformation ?? '',
        extractionStatus: p.extractionStatus,
        isFlagged: p.isFlagged,
        sourcePlatform: p.sourcePlatform ?? '',
        sourceUrl: p.sourceUrl,
        confidenceScore: p.confidenceScore,
        sellerName: s.sellerName ?? '',
        sellerLogoUrl: s.sellerLogoUrl ?? '',
        sellerGstNumber: s.gstNumber ?? '',
        sellerAddress: s.address ?? '',
        sellerState: s.state ?? '',
        sellerCountry: s.country ?? '',
        sellerBusinessType: s.businessType ?? '',
        sellerYearsEstablished: s.yearsEstablished ?? '',
        sellerEmployees: s.numberOfEmployees ?? '',
        sellerTurnover: s.turnover ?? '',
        sellerLegalStatus: s.legalStatus ?? '',
        sellerContact: s.contactDetails ?? '',
        sellerProfileUrl: s.aajjoProfileUrl ?? '',
        imageUrls: (p.images ?? []).map((i: any) => i.storageUrl).join('|'),
        thumbnailUrls: (p.images ?? []).map((i: any) => i.thumbnailUrl).join('|'),
        ...specFlat,
      };
    });

    const output = stringify(rows, { header: true });
    return Buffer.from(output, 'utf-8');
  }

  // ── Excel export ──────────────────────────────────────────────────────────

  private async generateExcel(products: ProductDocument[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aajjo Scraper';
    wb.created = new Date();

    // Sheet 1: Products
    const ws1 = wb.addWorksheet('Products');
    ws1.columns = [
      { header: 'ID', key: 'id', width: 26 },
      { header: 'Product Name', key: 'productName', width: 40 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Sub-Category', key: 'subCategory', width: 20 },
      { header: 'Price', key: 'price', width: 12 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'MOQ', key: 'moq', width: 10 },
      { header: 'Description', key: 'description', width: 60 },
      { header: 'Delivery Info', key: 'deliveryInformation', width: 40 },
      { header: 'Warranty Info', key: 'warrantyInformation', width: 40 },
      { header: 'Extraction Status', key: 'extractionStatus', width: 18 },
      { header: 'Flagged', key: 'isFlagged', width: 10 },
      { header: 'Source Platform', key: 'sourcePlatform', width: 16 },
      { header: 'Source URL', key: 'sourceUrl', width: 60 },
      { header: 'Confidence', key: 'confidenceScore', width: 12 },
    ];
    ws1.getRow(1).font = { bold: true };
    products.forEach((p) =>
      ws1.addRow({
        id: (p as any)._id.toString(),
        productName: p.productName,
        category: p.category,
        subCategory: p.subCategory,
        price: p.price,
        currency: p.currency,
        moq: p.moq,
        description: p.description,
        deliveryInformation: p.deliveryInformation ?? '',
        warrantyInformation: p.warrantyInformation ?? '',
        extractionStatus: p.extractionStatus,
        isFlagged: p.isFlagged,
        sourcePlatform: p.sourcePlatform ?? '',
        sourceUrl: p.sourceUrl,
        confidenceScore: p.confidenceScore,
      }),
    );

    // Sheet 2: Specifications
    const ws2 = wb.addWorksheet('Specifications');
    ws2.columns = [
      { header: 'Product ID', key: 'productId', width: 26 },
      { header: 'Section', key: 'section', width: 12 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Raw Name', key: 'rawName', width: 30 },
      { header: 'Value', key: 'value', width: 40 },
      { header: 'Confidence', key: 'confidence', width: 12 },
    ];
    ws2.getRow(1).font = { bold: true };
    products.forEach((p) =>
      (p.specifications ?? []).forEach((s: any) =>
        ws2.addRow({
          productId: (p as any)._id.toString(),
          section: s.section,
          name: s.name,
          rawName: s.rawName,
          value: s.value,
          confidence: s.confidence,
        }),
      ),
    );

    // Sheet 3: Images
    const ws3 = wb.addWorksheet('Images');
    ws3.columns = [
      { header: 'Product ID', key: 'productId', width: 26 },
      { header: 'Storage URL', key: 'storageUrl', width: 80 },
      { header: 'Thumbnail URL', key: 'thumbnailUrl', width: 80 },
      { header: 'Featured', key: 'isFeatured', width: 10 },
      { header: 'Width', key: 'width', width: 8 },
      { header: 'Height', key: 'height', width: 8 },
      { header: 'Format', key: 'format', width: 10 },
    ];
    ws3.getRow(1).font = { bold: true };
    products.forEach((p) =>
      (p.images ?? []).forEach((i: any) =>
        ws3.addRow({
          productId: (p as any)._id.toString(),
          storageUrl: i.storageUrl,
          thumbnailUrl: i.thumbnailUrl,
          isFeatured: i.isFeatured,
          width: i.width,
          height: i.height,
          format: i.format,
        }),
      ),
    );

    // Sheet 4: Sellers
    const ws4 = wb.addWorksheet('Sellers');
    ws4.columns = [
      { header: 'Product ID', key: 'productId', width: 26 },
      { header: 'Seller Name', key: 'sellerName', width: 30 },
      { header: 'Logo URL', key: 'sellerLogoUrl', width: 60 },
      { header: 'GST', key: 'gstNumber', width: 20 },
      { header: 'Address', key: 'address', width: 50 },
      { header: 'State', key: 'state', width: 20 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Business Type', key: 'businessType', width: 20 },
      { header: 'Years Established', key: 'yearsEstablished', width: 18 },
      { header: 'Employees', key: 'numberOfEmployees', width: 15 },
      { header: 'Turnover', key: 'turnover', width: 20 },
      { header: 'Legal Status', key: 'legalStatus', width: 20 },
      { header: 'Contact', key: 'contactDetails', width: 30 },
      { header: 'Aajjo Profile URL', key: 'aajjoProfileUrl', width: 60 },
    ];
    ws4.getRow(1).font = { bold: true };
    products.forEach((p) => {
      const s = p.seller as any;
      ws4.addRow({
        productId: (p as any)._id.toString(),
        sellerName: s?.sellerName ?? '',
        sellerLogoUrl: s?.sellerLogoUrl ?? '',
        gstNumber: s?.gstNumber ?? '',
        address: s?.address ?? '',
        state: s?.state ?? '',
        country: s?.country ?? '',
        businessType: s?.businessType ?? '',
        yearsEstablished: s?.yearsEstablished ?? '',
        numberOfEmployees: s?.numberOfEmployees ?? '',
        turnover: s?.turnover ?? '',
        legalStatus: s?.legalStatus ?? '',
        contactDetails: s?.contactDetails ?? '',
        aajjoProfileUrl: s?.aajjoProfileUrl ?? '',
      });
    });

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  // ── JSON export ────────────────────────────────────────────────────────────

  private generateJson(products: ProductDocument[]): Buffer {
    return Buffer.from(JSON.stringify(products, null, 2), 'utf-8');
  }

  // ── Shopify CSV export ─────────────────────────────────────────────────────

  private readonly SHOPIFY_COLUMNS = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type',
    'Tags', 'Published', 'Variant Price', 'Variant SKU', 'Image Src',
    'Image Alt Text', 'Metafield: custom.moq [number_integer]',
    'Metafield: custom.source_url [single_line_text_field]',
  ];

  private generateShopifyCsv(products: ProductDocument[]): Buffer {
    if (!products.length) {
      return Buffer.from(this.SHOPIFY_COLUMNS.join(',') + '\n', 'utf-8');
    }

    const rows: Record<string, unknown>[] = [];

    products.forEach((p) => {
      const images = p.images ?? [];
      const seller = (p.seller as any) ?? {};
      const tags = (p.specifications ?? [])
        .slice(0, 5)
        .map((s: any) => `${s.name}:${s.value}`)
        .join(',');

      // One row per product (Shopify format)
      rows.push({
        Handle: (p.productName ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        Title: p.productName,
        'Body (HTML)': p.description ?? '',
        Vendor: seller.sellerName ?? '',
        'Product Category': p.category ?? '',
        Type: p.subCategory ?? '',
        Tags: tags,
        Published: 'false',
        'Variant Price': p.price ?? '',
        'Variant SKU': '',
        'Image Src': images[0]?.storageUrl ?? '',
        'Image Alt Text': p.productName,
        'Metafield: custom.moq [number_integer]': p.moq ?? '',
        'Metafield: custom.source_url [single_line_text_field]': p.sourceUrl,
      });

      // Additional image rows
      images.slice(1).forEach((img: any) => {
        rows.push({
          Handle: (p.productName ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
          'Image Src': img.storageUrl ?? '',
          'Image Alt Text': p.productName,
        });
      });
    });

    return Buffer.from(stringify(rows, { header: true }), 'utf-8');
  }

  // ── WooCommerce XML export ─────────────────────────────────────────────────

  private generateWooCommerceXml(products: ProductDocument[]): Buffer {
    const root = xmlCreate({ version: '1.0', encoding: 'UTF-8' })
      .ele('rss', {
        version: '2.0',
        'xmlns:wp': 'http://wordpress.org/export/1.2/',
        'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
        'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      })
      .ele('channel');

    root.ele('title').txt('Aajjo Scraper Export');
    root.ele('link').txt('https://www.aajjo.com');
    root.ele('wp:wxr_version').txt('1.2');

    products.forEach((p) => {
      const item = root.ele('item');
      item.ele('title').txt(p.productName ?? '');
      item.ele('wp:post_type').txt('product');
      item.ele('wp:status').txt('draft');
      item.ele('content:encoded').dat(p.description ?? '');

      const seller = (p.seller as any) ?? {};
      item.ele('wp:postmeta').ele('wp:meta_key').txt('_regular_price').up()
        .ele('wp:meta_value').txt(String(p.price ?? ''));
      item.ele('wp:postmeta').ele('wp:meta_key').txt('_moq').up()
        .ele('wp:meta_value').txt(String(p.moq ?? ''));
      item.ele('wp:postmeta').ele('wp:meta_key').txt('_supplier').up()
        .ele('wp:meta_value').txt(seller.sellerName ?? '');
      item.ele('wp:postmeta').ele('wp:meta_key').txt('_source_url').up()
        .ele('wp:meta_value').txt(p.sourceUrl ?? '');

      (p.specifications ?? []).forEach((s: any) => {
        item.ele('wp:postmeta')
          .ele('wp:meta_key').txt(`_attr_${s.name}`).up()
          .ele('wp:meta_value').txt(s.value);
      });

      (p.images ?? []).forEach((img: any, idx: number) => {
        item.ele('wp:postmeta')
          .ele('wp:meta_key').txt(`_image_${idx}`).up()
          .ele('wp:meta_value').txt(img.storageUrl ?? '');
      });
    });

    return Buffer.from(root.end({ prettyPrint: true }), 'utf-8');
  }

  // ── Generate buffer for direct streaming (no DB record, no disk write) ──────

  async generateBuffer(
    format: ExportFormat,
    filters: ExportFilters,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const products = await this.queryProducts(filters);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    let buffer: Buffer;
    let fileName: string;
    let contentType: string;

    switch (format) {
      case ExportFormat.CSV:
        buffer = this.generateCsv(products);
        fileName = `products_${ts}.csv`;
        contentType = 'text/csv; charset=utf-8';
        break;
      case ExportFormat.XLSX:
        buffer = await this.generateExcel(products);
        fileName = `products_${ts}.xlsx`;
        contentType =
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        break;
      case ExportFormat.JSON:
        buffer = this.generateJson(products);
        fileName = `products_${ts}.json`;
        contentType = 'application/json';
        break;
      case ExportFormat.SHOPIFY_CSV:
        buffer = this.generateShopifyCsv(products);
        fileName = `shopify_${ts}.csv`;
        contentType = 'text/csv; charset=utf-8';
        break;
      case ExportFormat.WOOCOMMERCE_XML:
        buffer = this.generateWooCommerceXml(products);
        fileName = `woocommerce_${ts}.xml`;
        contentType = 'application/xml';
        break;
      default:
        throw new Error(`Unknown export format: ${format}`);
    }

    this.logger.log(
      `Direct export: ${products.length} products as ${format} (${buffer.length} bytes)`,
    );
    return { buffer, fileName, contentType };
  }

  // ── Orchestrate export job ────────────────────────────────────────────────

  async generateExport(
    exportJobId: string,
    format: ExportFormat,
    filters: ExportFilters,
  ): Promise<void> {
    await this.exportJobModel.findByIdAndUpdate(exportJobId, { status: ExportStatus.PROCESSING });

    try {
      const products = await this.queryProducts(filters);
      this.logger.log(`Exporting ${products.length} products as ${format}`);

      let buffer: Buffer;
      let fileName: string;

      switch (format) {
        case ExportFormat.CSV:
          buffer = this.generateCsv(products);
          fileName = `products_export_${exportJobId}.csv`;
          break;
        case ExportFormat.XLSX:
          buffer = await this.generateExcel(products);
          fileName = `products_export_${exportJobId}.xlsx`;
          break;
        case ExportFormat.JSON:
          buffer = this.generateJson(products);
          fileName = `products_export_${exportJobId}.json`;
          break;
        case ExportFormat.SHOPIFY_CSV:
          buffer = this.generateShopifyCsv(products);
          fileName = `shopify_export_${exportJobId}.csv`;
          break;
        case ExportFormat.WOOCOMMERCE_XML:
          buffer = this.generateWooCommerceXml(products);
          fileName = `woocommerce_export_${exportJobId}.xml`;
          break;
        default:
          throw new Error(`Unknown export format: ${format}`);
      }

      const filePath = path.join(this.storagePath, fileName);
      fs.writeFileSync(filePath, buffer);

      await this.exportJobModel.findByIdAndUpdate(exportJobId, {
        status: ExportStatus.COMPLETED,
        rowCount: products.length,
        fileUrl: `/api/export/${exportJobId}/download`,
        expiresAt: addHours(new Date(), this.expiryHours),
      });

      this.logger.log(`Export completed: ${fileName} (${products.length} rows)`);
    } catch (error: any) {
      this.logger.error(`Export failed [${exportJobId}]: ${error.message}`);
      await this.exportJobModel.findByIdAndUpdate(exportJobId, { status: ExportStatus.FAILED });
      throw error;
    }
  }

  async getExportFilePath(exportJobId: string): Promise<string> {
    const job = await this.exportJobModel.findById(exportJobId).lean().exec();
    if (!job) throw new NotFoundException('Export job not found');
    if (job.status !== ExportStatus.COMPLETED) throw new NotFoundException('Export not ready');
    if (job.expiresAt && new Date() > job.expiresAt) throw new NotFoundException('Export link expired');

    const files = fs
      .readdirSync(this.storagePath)
      .filter((f) => f.includes(exportJobId));
    if (!files.length) throw new NotFoundException('Export file not found');

    return path.join(this.storagePath, files[0]);
  }
}
