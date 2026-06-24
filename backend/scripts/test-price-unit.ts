import { chromium } from 'playwright';

const TARGET_URL = process.argv[2] || 'https://www.aajjo.com/product/iron-ore-in-perundurai-sree-rengaraj-ispat-industries-p-ltd';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PRICE-UNIT + SPEC EXTRACTION TEST');
  console.log('  URL:', TARGET_URL);
  console.log('═══════════════════════════════════════════════════════════\n');

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
  await new Promise<void>((r) => setTimeout(r, 2500));

  // ── Price + Unit ────────────────────────────────────────────────
  const priceSelectors = [
    '.new-price span.fw-bold', '.new-price', '.product-price span.fw-bold',
    '.price span.fw-bold', '[class*="price"] span.fw-bold', '[class*="price"]',
  ];
  let priceRaw = '';
  for (const sel of priceSelectors) {
    const el = await page.$(sel);
    if (!el) continue;
    const txt = ((await el.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    if (txt) { priceRaw = txt; break; }
  }
  const numStr = priceRaw.replace(/[₹$€,]/g, '').match(/[\d.]+/)?.[0];
  const price = numStr ? parseFloat(numStr) : null;

  const unitResult = await page.evaluate(() => {
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
      if (words.length > 0)
        return { unit: words.join(' '), selector: sel, rawText: text.slice(0, 150), afterSlash: afterSlash.slice(0, 80) };
    }
    return { unit: '', selector: 'none', rawText: '', afterSlash: '' };
  });

  console.log('━━━ PRICE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  priceRaw :', JSON.stringify(priceRaw));
  console.log('  price    :', price);
  console.log('  selector :', unitResult.selector);
  console.log('  rawText  :', JSON.stringify(unitResult.rawText));
  console.log('  afterSlash:', JSON.stringify(unitResult.afterSlash));
  console.log('  priceUnit:', JSON.stringify(unitResult.unit));
  console.log('  result   :', price && unitResult.unit ? `✅  ${price} / ${unitResult.unit}` : (price ? `⚠  ${price} (no unit)` : '❌  no price'));

  // ── Spec tables ────────────────────────────────────────────────
  const specInfo = await page.evaluate(() => {
    const specSection = document.getElementById('Specification') ?? document.getElementById('TechnicalSpecification');
    if (!specSection) return { sectionFound: false, tables: 0, firstTableRows: [] as string[], allTableRowCounts: [] as number[] };

    const tables = Array.from(specSection.querySelectorAll('table')).filter((t) => {
      const cls = (t as HTMLElement).className ?? '';
      return !cls.includes('service-chart-datails') && !cls.includes('service-chart-details');
    });

    const firstTableRows = tables[0]
      ? Array.from(tables[0].querySelectorAll('tr')).map((tr) => {
          const cells = tr.querySelectorAll('td');
          return cells.length >= 2
            ? `${cells[0].textContent?.trim()}: ${cells[1].textContent?.trim()}`
            : '';
        }).filter(Boolean).slice(0, 10)
      : [];

    return {
      sectionFound: true,
      tables: tables.length,
      firstTableRows,
      allTableRowCounts: tables.map((t) => t.querySelectorAll('tr').length),
    };
  });

  console.log('\n━━━ SPEC TABLES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  #Specification section found:', specInfo.sectionFound);
  console.log('  Extended tables found:', specInfo.tables);
  console.log('  Row counts per table :', specInfo.allTableRowCounts);
  console.log('  First table rows (will be used with new code):');
  specInfo.firstTableRows.forEach((r) => console.log('    -', r));

  if (specInfo.tables > 1) {
    console.log('\n  ⚠  Multiple extended tables — old code reads ALL, new code reads only FIRST');
    console.log('  ✅  With new code, only the', specInfo.firstTableRows.length, 'rows above will appear in More Specifications');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
