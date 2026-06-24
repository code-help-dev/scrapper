import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ExtractedProduct, SpecItem } from '../extractor/extractor.service';

interface UnitRule {
  from: string;
  to: string;
  factor: number;
}

interface UnitNormalization {
  weight: UnitRule[];
  dimensions: UnitRule[];
  currency: { from: string; to: string }[];
}

interface FieldMappingConfig {
  unit_normalization?: UnitNormalization;
  [rawName: string]: string | UnitNormalization | undefined;
}

@Injectable()
export class NormalizationService implements OnModuleInit {
  private readonly logger = new Logger(NormalizationService.name);
  private fieldMap: Record<string, string> = {};
  private unitRules: UnitNormalization | null = null;

  onModuleInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPath = path.resolve(process.cwd(), 'config', 'field-mapping.yaml');
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = yaml.load(raw) as FieldMappingConfig;

      const { unit_normalization, ...mappings } = parsed;
      this.fieldMap = mappings as Record<string, string>;
      this.unitRules = (unit_normalization as UnitNormalization) ?? null;

      this.logger.log(`Loaded ${Object.keys(this.fieldMap).length} field mappings from field-mapping.yaml`);
    } catch (err: any) {
      this.logger.warn(`Could not load field-mapping.yaml: ${err.message}`);
    }
  }

  private mapFieldName(rawName: string): string {
    return this.fieldMap[rawName] ?? this.fieldMap[rawName.toLowerCase()] ?? null;
  }

  private normalizeUnit(
    value: string,
    rules: UnitRule[],
  ): { value: string; normalized: boolean } {
    for (const rule of rules) {
      const regex = new RegExp(`(\\d+\\.?\\d*)\\s*${rule.from}\\b`, 'i');
      const match = value.match(regex);
      if (match) {
        const converted = (parseFloat(match[1]) * rule.factor).toFixed(4).replace(/\.?0+$/, '');
        return {
          value: `${converted} ${rule.to}`,
          normalized: true,
        };
      }
    }
    return { value, normalized: false };
  }

  private normalizeCurrency(value: string): string {
    if (!this.unitRules?.currency) return value;
    for (const rule of this.unitRules.currency) {
      if (value.includes(rule.from)) return value.replace(rule.from, rule.to).trim();
    }
    return value;
  }

  normalizeSpecs(specs: SpecItem[]): SpecItem[] {
    return specs.map((spec) => {
      const mappedName = this.mapFieldName(spec.rawName);
      let normalizedValue = spec.value;

      if (this.unitRules) {
        const lower = (mappedName ?? spec.name).toLowerCase();
        if (lower.includes('weight')) {
          normalizedValue = this.normalizeUnit(normalizedValue, this.unitRules.weight).value;
        } else if (['length', 'width', 'height', 'thickness', 'dimension'].some((d) => lower.includes(d))) {
          normalizedValue = this.normalizeUnit(normalizedValue, this.unitRules.dimensions).value;
        } else if (lower.includes('price') || lower.includes('cost')) {
          normalizedValue = this.normalizeCurrency(normalizedValue);
        }
      }

      return {
        ...spec,
        name: mappedName ?? spec.name,
        value: normalizedValue,
      };
    });
  }

  normalizePrice(raw: number | null, currency: string): { price: number | null; currency: string } {
    return {
      price: raw,
      currency: this.normalizeCurrency(currency || 'INR') || 'INR',
    };
  }

  normalize(product: ExtractedProduct): ExtractedProduct {
    const { price, currency } = this.normalizePrice(product.price, product.currency);

    return {
      ...product,
      productName: product.productName.trim(),
      category: product.category?.trim() ?? '',
      subCategory: product.subCategory?.trim() ?? '',
      price,
      currency,
      priceUnit: product.priceUnit?.trim() ?? '',
      specifications: this.normalizeSpecs(product.specifications),
    };
  }
}
