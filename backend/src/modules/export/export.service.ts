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
  seller?: string;
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

  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async queryProducts(filters: ExportFilters): Promise<ProductDocument[]> {

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
    if (filters.category) query.subCategory = { $regex: `^${ExportService.escapeRegExp(filters.category)}$`, $options: 'i' };
    if (filters.subCategory) query.productType = { $regex: `^${ExportService.escapeRegExp(filters.subCategory)}$`, $options: 'i' };
    if (filters.seller) query['seller.sellerName'] = { $regex: `^${ExportService.escapeRegExp(filters.seller)}$`, $options: 'i' };
    if (filters.status) query.extractionStatus = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) (query.createdAt as Record<string, Date>)['$gte'] = filters.dateFrom;
      if (filters.dateTo) (query.createdAt as Record<string, Date>)['$lte'] = filters.dateTo;
    }
    return this.productModel.find(query).lean().exec() as unknown as Promise<ProductDocument[]>;
  }

  private static readonly NAMED_ENTITIES: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
    mdash: '—', ndash: '–', hellip: '…',
  };

  // Aajjo listing pages occasionally double-encode entities (e.g. "40&quot;"
  // literally in the DOM text), so decode on export regardless of source.
  private static decodeEntities(str: string): string {
    if (!str || !str.includes('&')) return str ?? '';
    return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ExportService.NAMED_ENTITIES[ent] ?? match;
    });
  }

  // field-mapping.yaml mixes camelCase ("countryOfOrigin") with the
  // extractor's own snake_case fallback — normalize both to snake_case here
  // so exported spec keys are consistent regardless of source.
  private static toSnakeCase(name: string): string {
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private static parseDescription(raw: string): {
    summary: string;
    key_features: Record<string, string>;
    applications: string;
    benefits: string;
    call_to_action: string;
  } {
    const text = ExportService.decodeEntities(raw ?? '').trim();
    if (!text) {
      return { summary: '', key_features: {}, applications: '', benefits: '', call_to_action: '' };
    }

    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const findIdx = (label: string) =>
      paragraphs.findIndex((p) => p.toLowerCase().startsWith(label.toLowerCase()));

    const kfIdx = findIdx('Key Features:');
    const appIdx = findIdx('Applications:');
    const whyIdx = findIdx('Why Choose This Product:');

    if (kfIdx === -1 && appIdx === -1 && whyIdx === -1) {
      return { summary: text, key_features: {}, applications: '', benefits: '', call_to_action: '' };
    }

    const stripLabel = (p: string, label: string) => p.slice(label.length).trim();
    const markerIdxs = [kfIdx, appIdx, whyIdx].filter((i) => i >= 0).sort((a, b) => a - b);
    const summary = paragraphs.slice(0, markerIdxs[0]).join('\n\n');

    const key_features: Record<string, string> = {};
    if (kfIdx >= 0) {
      stripLabel(paragraphs[kfIdx], 'Key Features:')
        .split(',')
        .forEach((pair) => {
          const idx = pair.indexOf(':');
          if (idx === -1) return;
          const label = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (label) key_features[ExportService.toSnakeCase(label)] = value;
        });
    }

    const applications = appIdx >= 0 ? stripLabel(paragraphs[appIdx], 'Applications:') : '';
    const benefits = whyIdx >= 0 ? stripLabel(paragraphs[whyIdx], 'Why Choose This Product:') : '';
    const call_to_action = paragraphs.slice(markerIdxs[markerIdxs.length - 1] + 1).join('\n\n');

    return { summary, key_features, applications, benefits, call_to_action };
  }

  private buildRecord(p: ProductDocument) {
    const s = (p.seller as any) ?? {};
    const specifications: Record<string, string> = {};
    (p.specifications ?? []).forEach((spec: any) => {
      const key = ExportService.toSnakeCase(spec.name ?? spec.rawName ?? '');
      if (!key) return;
      specifications[key] = ExportService.decodeEntities(spec.value ?? '');
    });

    return {
      product_name: ExportService.decodeEntities(p.productName ?? ''),
      price: { amount: p.price ?? null, currency: p.currency ?? 'INR' },
      priceUnit: (p as any).priceUnit ?? '',
      sub_category: p.subCategory ?? '',
      product_type: p.productType ?? '',
      seller: {
        name: ExportService.decodeEntities(s.sellerName ?? ''),
        address: ExportService.decodeEntities(s.address ?? ''),
        gst_number: s.gstNumber ?? '',
        logo_url: s.sellerLogoUrl ?? '',
      },
      images: (p.images ?? []).map((i: any) => i.storageUrl).filter(Boolean),
      specifications,
      description: ExportService.parseDescription(p.description ?? ''),
    };
  }

  private static flatten(value: unknown, prefix: string, out: Record<string, string>): void {
    if (value === null || value === undefined) {
      out[prefix] = '';
    } else if (Array.isArray(value)) {
      out[prefix] = value.join('|');
    } else if (typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        ExportService.flatten(v, prefix ? `${prefix}.${k}` : k, out),
      );
    } else {
      out[prefix] = String(value);
    }
  }

  // specifications and key_features vary per category (a machine and a membrane
  // share almost no attribute names) — exploding them into columns produces
  // thousands of mostly-empty columns across a multi-category export, so they're
  // kept as single JSON cells instead. Everything else flattens to real columns.
  private static readonly FLAT_COLUMNS = [
    'product_name',
    'price.amount', 'price.currency', 'priceUnit',
    'sub_category', 'product_type',
    'seller.name', 'seller.address', 'seller.gst_number', 'seller.logo_url',
    'images',
    'description.summary', 'description.applications', 'description.benefits',
    'description.call_to_action', 'description.key_features',
    'specifications',
  ];

  private buildFlatRows(products: ProductDocument[]): { columns: string[]; rows: Record<string, string>[] } {
    const columns = [...ExportService.FLAT_COLUMNS];
    const rows = products.map((p) => {
      const record = this.buildRecord(p) as any;
      const flatSource = {
        ...record,
        specifications: JSON.stringify(record.specifications ?? {}),
        description: {
          ...record.description,
          key_features: JSON.stringify(record.description?.key_features ?? {}),
        },
      };
      const out: Record<string, string> = {};
      ExportService.flatten(flatSource, '', out);
      const row: Record<string, string> = {};
      columns.forEach((c) => { row[c] = out[c] ?? ''; });
      return row;
    });

    return { columns, rows };
  }

  private generateCsv(products: ProductDocument[]): Buffer {
    const { columns, rows } = this.buildFlatRows(products);
    if (!rows.length) {
      return Buffer.from(columns.join(',') + '\n', 'utf-8');
    }
    const output = stringify(rows, { header: true, columns });
    return Buffer.from(output, 'utf-8');
  }

  private async generateExcel(products: ProductDocument[]): Promise<Buffer> {
    const { columns, rows } = this.buildFlatRows(products);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aajjo Scraper';
    wb.created = new Date();

    const ws = wb.addWorksheet('Products');
    ws.columns = columns.map((c) => ({
      header: c,
      key: c,
      width: Math.min(Math.max(c.length + 4, 14), 60),
    }));
    ws.getRow(1).font = { bold: true };
    rows.forEach((row) => ws.addRow(row));

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  private generateJson(products: ProductDocument[]): Buffer {
    const records = products.map((p) => this.buildRecord(p));
    return Buffer.from(JSON.stringify(records, null, 2), 'utf-8');
  }

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

      rows.push({
        Handle: (p.productName ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        Title: p.productName,
        'Body (HTML)': p.description ?? '',
        Vendor: seller.sellerName ?? '',
        'Product Category': p.subCategory ?? '',
        Type: p.productType ?? '',
        Tags: tags,
        Published: 'false',
        'Variant Price': p.price ?? '',
        'Variant SKU': '',
        'Image Src': images[0]?.storageUrl ?? '',
        'Image Alt Text': p.productName,
        'Metafield: custom.moq [number_integer]': p.moq ?? '',
        'Metafield: custom.source_url [single_line_text_field]': p.sourceUrl,
      });

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
