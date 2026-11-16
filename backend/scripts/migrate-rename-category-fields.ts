/**
 * One-off migration: rename Product taxonomy fields to match the new
 * detail-page/export labeling — `category` → `subCategory`, `subCategory` → `productType`.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/migrate-rename-category-fields.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aajjo_scraper';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB${DRY_RUN ? '  DRY RUN' : ''}`);

  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const products = db.collection('products');

  const cursor = products.find(
    { $or: [{ category: { $exists: true } }, { subCategory: { $exists: true } }] },
    { projection: { category: 1, subCategory: 1 } },
  );

  const docs = await cursor.toArray();
  console.log(`Found ${docs.length} product(s) to migrate`);

  if (docs.length > 0) {
    const ops = docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            subCategory: doc.category ?? '',
            productType: doc.subCategory ?? '',
          },
          $unset: { category: '' },
        },
      },
    }));

    if (DRY_RUN) {
      console.log('Sample op:', JSON.stringify(ops[0], null, 2));
    } else {
      const result = await products.bulkWrite(ops);
      console.log(`Updated ${result.modifiedCount} document(s)`);
    }
  }

  console.log('Syncing indexes (drop old category_* indexes, create new ones)...');
  const existingIndexes = await products.indexes();
  for (const idx of existingIndexes) {
    if (idx.name && (idx.name === 'category_1' || idx.name === 'category_1_subCategory_1')) {
      console.log(`  Dropping stale index: ${idx.name}`);
      if (!DRY_RUN) await products.dropIndex(idx.name);
    }
  }
  if (!DRY_RUN) {
    await products.createIndex({ subCategory: 1 });
    await products.createIndex({ subCategory: 1, productType: 1 });
    console.log('  Created subCategory_1 and subCategory_1_productType_1 indexes');
  }

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
