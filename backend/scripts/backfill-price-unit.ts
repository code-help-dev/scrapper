/**
 * Backfill priceUnit for products where it is empty.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/backfill-price-unit.ts [options]
 *
 * Options:
 *   --limit=N          Max products to process (default 50)
 *   --concurrency=N    Parallel browser pages (default 3)
 *   --url=<sourceUrl>  Target a single specific product URL
 *   --dry-run          Preview without writing to DB
 */
import { chromium, Browser } from 'playwright';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aajjo-scraper';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const LIMIT = parseInt(arg('limit') ?? '50', 10);
const CONCURRENCY = Math.min(parseInt(arg('concurrency') ?? '3', 10), 8);
const TARGET_URL = arg('url') ?? '';
const DRY_RUN = process.argv.includes('--dry-run');

async function extractUnit(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 }).catch(() => {});
    await new Promise<void>((r) => setTimeout(r, 1200));

    return await page.evaluate(() => {
      const candidates = ['.new-price', '.product-price', '.price', '[class*="price"]'];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const slashIdx = text.indexOf('/');
        if (slashIdx === -1) continue;
        const afterSlash = text.slice(slashIdx + 1).trim();
        const cleaned = afterSlash.replace(/\b(Get|Buy|Contact|Request|View|Call|Ask)\b.*/i, '').trim();
        const words = cleaned.split(/\s+/).filter((w: string) => /^[A-Za-z]/.test(w)).slice(0, 4);
        if (words.length > 0) return words.join(' ');
      }
      return '';
    });
  } finally {
    await page.close();
  }
}

async function processChunk(
  browser: Browser,
  products: { _id: unknown; sourceUrl: string }[],
  ProductModel: mongoose.Model<any>,
): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;

  await Promise.all(
    products.map(async (p) => {
      process.stdout.write(`  ${p.sourceUrl} → `);
      try {
        const unit = await extractUnit(browser, p.sourceUrl);
        if (unit) {
          process.stdout.write(`"${unit}"\n`);
          if (!DRY_RUN) await ProductModel.updateOne({ _id: p._id }, { $set: { priceUnit: unit } });
          updated++;
        } else {
          process.stdout.write('(no unit on page)\n');
          skipped++;
        }
      } catch (e: any) {
        process.stdout.write(`ERROR: ${e.message}\n`);
        skipped++;
      }
    }),
  );

  return { updated, skipped };
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const Product = mongoose.model('Product', new mongoose.Schema(
    { sourceUrl: String, priceUnit: { type: String, default: '' }, productName: String },
    { strict: false },
  ));

  const query = TARGET_URL
    ? { sourceUrl: TARGET_URL }
    : { priceUnit: { $in: [null, ''] } };

  const products = await Product.find(query, { _id: 1, sourceUrl: 1 }).limit(LIMIT).lean() as { _id: unknown; sourceUrl: string }[];

  if (products.length === 0) {
    console.log('No matching products found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Processing ${products.length} products  concurrency=${CONCURRENCY}${DRY_RUN ? '  DRY RUN' : ''}`);

  const browser = await chromium.launch({ headless: true });
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const chunk = products.slice(i, i + CONCURRENCY);
    const { updated, skipped } = await processChunk(browser, chunk, Product);
    totalUpdated += updated;
    totalSkipped += skipped;
    console.log(`  Progress: ${Math.min(i + CONCURRENCY, products.length)}/${products.length}  updated so far: ${totalUpdated}`);
  }

  await browser.close();
  console.log(`\nDone — updated: ${totalUpdated}, no-unit/error: ${totalSkipped}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
