/**
 * Standalone extraction test — run with:
 *   cd backend
 *   npx ts-node -r tsconfig-paths/register scripts/test-extract.ts
 *
 * Navigates to a real Aajjo product URL, dumps raw DOM structure, then
 * runs every extractor and prints exactly what gets saved to the database.
 */

import { chromium } from 'playwright';

const TARGET_URL =
  'https://www.aajjo.com/product/outdoor-multi-gym-in-meerut-ms-df-sports-industries';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  AAJJO EXTRACTION TEST');
  console.log('  URL:', TARGET_URL);
  console.log('═══════════════════════════════════════════════════════\n');

  // ── Load page ──────────────────────────────────────────────────────────────
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
  await new Promise<void>((r) => setTimeout(r, 2000));

  // ── 1. Raw DOM audit ───────────────────────────────────────────────────────
  console.log('━━━ RAW DOM STRUCTURE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const domAudit = await page.evaluate(() => {
    const out: Record<string, string> = {};

    // Breadcrumb container
    const breadcrumbSelectors = [
      'ol.breadcrumb', 'ul.breadcrumb',
      'nav[aria-label*="breadcrumb" i]',
      '[role="navigation"][class*="breadcrumb"]',
      '[class*="breadcrumb"]', '[id*="breadcrumb"]',
    ];
    for (const sel of breadcrumbSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        out['breadcrumb_selector'] = sel;
        out['breadcrumb_html'] = el.outerHTML.slice(0, 600);
        break;
      }
    }

    // Fallback: find any small div/nav/p with » that has category links
    if (!out['breadcrumb_html']) {
      const els = Array.from(document.querySelectorAll('nav, div, p')) as HTMLElement[];
      for (const el of els) {
        const text = el.textContent ?? '';
        if ((text.includes('»') || text.includes('›')) && el.children.length <= 10) {
          const links = el.querySelectorAll('a[href]');
          if (links.length >= 1) {
            out['breadcrumb_fallback_html'] = el.outerHTML.slice(0, 600);
            break;
          }
        }
      }
    }

    // All a[href] links that look like category paths — what does isCategoryHref see?
    const categoryLinks = (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
      .filter((a) => {
        try {
          const url = new URL(a.href);
          if (!url.hostname.endsWith('aajjo.com')) return false;
          const parts = url.pathname.split('/').filter(Boolean);
          const skip = ['product', 'ahata', 'login', 'register', 'contact', 'about', 'search', 'sitemap'];
          return parts.length >= 1 && parts.length <= 2 && !skip.some((s) => parts[0].startsWith(s));
        } catch { return false; }
      })
      .slice(0, 10)
      .map((a) => `[${a.textContent?.trim()}] → ${a.href}`);
    out['category_links_found'] = categoryLinks.join('\n') || '(none)';

    // JSON-LD scripts
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent?.slice(0, 300))
      .join('\n---\n');
    out['json_ld'] = jsonLd || '(none)';

    // Tab navigation
    const tabLinks = Array.from(document.querySelectorAll('a[href^="#"]'))
      .map((a) => `href="${a.getAttribute('href')}" text="${a.textContent?.trim()}" outer="${a.outerHTML.slice(0, 150)}"`)
      .join('\n');
    out['tab_links'] = tabLinks || '(none)';

    // #Specification element
    const specEl = document.getElementById('Specification');
    out['spec_element_tag'] = specEl ? specEl.tagName + ' class="' + specEl.className + '" id="' + specEl.id + '"' : '(NOT FOUND)';
    out['spec_element_html'] = specEl ? specEl.outerHTML.slice(0, 800) : '(NOT FOUND)';

    // #Description element
    const descEl = document.getElementById('Description');
    out['desc_element_tag'] = descEl ? descEl.tagName + ' class="' + descEl.className + '"' : '(NOT FOUND)';
    out['desc_element_html'] = descEl ? descEl.outerHTML.slice(0, 600) : '(NOT FOUND)';

    // #CompanyDetails element
    const companyEl = document.getElementById('CompanyDetails');
    out['company_element_tag'] = companyEl ? companyEl.tagName + ' class="' + companyEl.className + '"' : '(NOT FOUND)';
    out['company_element_html'] = companyEl ? companyEl.outerHTML.slice(0, 800) : '(NOT FOUND)';

    // Basic spec table
    const basicTable =
      document.querySelector('.product-details table.service-chart-datails') ??
      document.querySelector('.product-details table.service-chart-details') ??
      document.querySelector('table.service-chart-datails') ??
      document.querySelector('table.service-chart-details');
    out['basic_spec_table_html'] = basicTable ? basicTable.outerHTML.slice(0, 600) : '(NOT FOUND)';

    return out;
  });

  for (const [key, val] of Object.entries(domAudit)) {
    console.log(`\n▶ ${key.toUpperCase()}:`);
    console.log(val);
  }

  // ── 2. Click tabs then re-audit ────────────────────────────────────────────
  console.log('\n\n━━━ AFTER CLICKING TABS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (const href of ['#Specification', '#Description', '#CompanyDetails']) {
    const el = await page.$(`a[href="${href}"]`);
    if (el) {
      await el.click().catch(() => {});
      await sleep(800);
      console.log(`✓ Clicked tab: ${href}`);
    } else {
      console.log(`✗ Tab not found: ${href}`);
    }
  }

  // ── 3. Run the actual extractors ───────────────────────────────────────────
  console.log('\n\n━━━ EXTRACTION RESULTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // --- Breadcrumb ---
  const breadcrumb = await page.evaluate(() => {
    const clean = (el: Element | null | undefined): string =>
      el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    const isCategoryHref = (href: string): boolean => {
      try {
        const url = new URL(href);
        if (!url.hostname.endsWith('aajjo.com')) return false;
        const parts = url.pathname.split('/').filter(Boolean);
        const skip = ['product', 'ahata', 'login', 'register', 'contact', 'about', 'search', 'sitemap'];
        return parts.length >= 1 && parts.length <= 2 && !skip.some((s) => parts[0].startsWith(s));
      } catch { return false; }
    };

    // Strategy 0: JSON-LD
    const decodeHtml = (str: string): string => {
      if (!str.includes('&')) return str;
      const ta = document.createElement('textarea');
      ta.innerHTML = str;
      return ta.value;
    };
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(script.textContent ?? '{}');
        const graphs: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        for (const g of graphs) {
          if (g['@type'] === 'BreadcrumbList' && Array.isArray(g.itemListElement)) {
            const items: string[] = g.itemListElement
              .map((i: any) => decodeHtml((i.name ?? i.item?.name ?? '').trim()))
              .filter((n: string) => n && n.toLowerCase() !== 'home');
            if (items.length >= 1) return { strategy: 'json-ld', category: items[0] ?? '', subCategory: items[1] ?? '' };
          }
        }
      } catch { }
    }

    // Strategy 1: ol.breadcrumb / ul.breadcrumb
    const listBreadcrumb = document.querySelector(
      'ol.breadcrumb, ul.breadcrumb, nav[aria-label*="breadcrumb" i], [role="navigation"][class*="breadcrumb"]',
    );
    if (listBreadcrumb) {
      const links = Array.from(listBreadcrumb.querySelectorAll('a')).filter(
        (a) => a.textContent?.trim().toLowerCase() !== 'home' && a.textContent?.trim(),
      );
      if (links.length >= 1) return { strategy: 'ol/ul.breadcrumb', category: clean(links[0]), subCategory: links[1] ? clean(links[1]) : '' };
    }

    // Strategy 2: class/id containing breadcrumb
    for (const el of Array.from(document.querySelectorAll('[class*="breadcrumb"], [id*="breadcrumb"]'))) {
      const links = Array.from(el.querySelectorAll('a')).filter(
        (a) => a.textContent?.trim().toLowerCase() !== 'home' && a.textContent?.trim(),
      );
      if (links.length >= 1) return { strategy: 'class/id contains breadcrumb', category: clean(links[0]), subCategory: links[1] ? clean(links[1]) : '' };
    }

    // Strategy 3: container with » and category links
    for (const el of Array.from(document.querySelectorAll('nav, div, p, span')) as HTMLElement[]) {
      const text = el.textContent ?? '';
      if (!text.includes('»') && !text.includes('›')) continue;
      if (el.children.length > 15 || el.querySelectorAll('table, form, ul, ol').length > 0) continue;
      const catLinks = (Array.from(el.querySelectorAll('a[href]')) as HTMLAnchorElement[])
        .filter((a) => isCategoryHref(a.href) && a.textContent?.trim().toLowerCase() !== 'home' && a.textContent?.trim());
      if (catLinks.length >= 1) {
        const depth1 = catLinks.filter((a) => new URL(a.href).pathname.split('/').filter(Boolean).length === 1);
        const depth2 = catLinks.filter((a) => new URL(a.href).pathname.split('/').filter(Boolean).length === 2);
        const category = (depth1[0] ?? catLinks[0])?.textContent?.trim() ?? '';
        const subCategory = (depth2[0] ?? catLinks[1])?.textContent?.trim() ?? '';
        if (category) return { strategy: '»-separator container', category, subCategory, html: el.outerHTML.slice(0, 300) };
      }
    }

    // Strategy 4: any category link in top 60%
    const pageHeight = document.body.scrollHeight || 2000;
    const allLinks = (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
      .filter((a) => {
        if (a.textContent?.trim().toLowerCase() === 'home' || !a.textContent?.trim()) return false;
        if (!isCategoryHref(a.href)) return false;
        const rect = a.getBoundingClientRect();
        const absTop = rect.top + window.scrollY;
        return absTop < pageHeight * 0.6;
      });
    const cat1 = allLinks.find((a) => new URL(a.href).pathname.split('/').filter(Boolean).length === 1);
    const cat2 = allLinks.find((a) => new URL(a.href).pathname.split('/').filter(Boolean).length === 2);
    return { strategy: 'fallback-top60%', category: clean(cat1) || '', subCategory: clean(cat2) || '' };
  });

  console.log('BREADCRUMB →', JSON.stringify(breadcrumb, null, 2));

  // --- Specs ---
  const specs = await page.evaluate(() => {
    const out: { key: string; val: string; section: string }[] = [];
    const readTable = (table: Element | null | undefined, section: string) => {
      if (!table) return;
      table.querySelectorAll('tr').forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length >= 2) {
          const key = cells[0].textContent?.trim() ?? '';
          const val = cells[1].textContent?.trim() ?? '';
          if (key && val) out.push({ key, val, section });
        }
      });
    };
    const basicTable =
      document.querySelector('.product-details table.service-chart-datails') ??
      document.querySelector('.product-details table.service-chart-details') ??
      document.querySelector('table.service-chart-datails') ??
      document.querySelector('table.service-chart-details');
    readTable(basicTable, 'basic');

    for (const id of ['Specification', 'TechnicalSpecification']) {
      const section = document.getElementById(id);
      if (!section) continue;

      const companyBoundary = document.getElementById('CompanyDetails');
      const descBoundary    = document.getElementById('Description');
      const isAfterBoundary = (table: Element): boolean => {
        if (companyBoundary && (companyBoundary.compareDocumentPosition(table) & 4)) return true;
        if (descBoundary    && (descBoundary.compareDocumentPosition(table)    & 4)) return true;
        return false;
      };
      const inside = Array.from(section.querySelectorAll('table')).filter((t) => {
        const cls = (t as HTMLElement).className ?? '';
        if (cls.includes('service-chart-datails') || cls.includes('service-chart-details')) return false;
        if (isAfterBoundary(t)) return false;
        return true;
      });

      if (inside.length > 0) { inside.forEach((t) => readTable(t, 'extended-inside')); break; }
      let node: Element | null = section.nextElementSibling;
      let g = 0;
      while (node && g < 8) {
        if (node.tagName === 'TABLE') readTable(node, 'extended-sibling');
        else node.querySelectorAll('table').forEach((t) => readTable(t, 'extended-sibling'));
        node = node.nextElementSibling; g++;
      }
      if (out.some(r => r.section.startsWith('extended'))) break;
    }
    return out;
  });
  console.log(`\nSPECS (${specs.length} rows) →`);
  specs.forEach((s) => console.log(`  [${s.section}] ${s.key}: ${s.val}`));

  // --- Description ---
  const description = await page.evaluate(() => {
    for (const id of ['Description', 'ProductDescription', 'product-description']) {
      const el = document.getElementById(id);
      if (!el) continue;
      const direct = (el as HTMLElement).innerText?.trim() ?? '';
      if (direct.length > 20) return { source: `#${id} innerText`, text: direct.slice(0, 400) };
      let node: Element | null = el.nextElementSibling;
      const parts: string[] = [];
      let g = 0;
      while (node && g < 10 && !/^H[123]$/.test(node.tagName)) {
        const t = (node as HTMLElement).innerText?.trim();
        if (t && t.length > 10) parts.push(t);
        node = node.nextElementSibling; g++;
      }
      if (parts.length) return { source: `#${id} siblings`, text: parts.join('\n').slice(0, 400) };
    }
    return { source: 'not found', text: '' };
  });
  console.log('\nDESCRIPTION →', JSON.stringify(description, null, 2));

  // --- All store/subdomain links with DOM position relative to #CompanyDetails ---
  const allSellerLinks = await page.evaluate(() => {
    const companyH = document.getElementById('CompanyDetails');
    return (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
      .filter((a) =>
        (/^https?:\/\/[a-z0-9-]+\.aajjo\.com\/?$/i.test(a.href) &&
         !/^https?:\/\/(www\.)?aajjo\.com/i.test(a.href)) ||
        /^https?:\/\/(www\.)?aajjo\.com\/store\/[a-z0-9-]+\/?$/i.test(a.href)
      )
      .map((a) => {
        const pos = companyH ? companyH.compareDocumentPosition(a) : 0;
        const rel = (pos & 4) ? 'AFTER' : (pos & 2) ? 'BEFORE' : 'SAME/UNKNOWN';
        return `[${rel}] text="${a.textContent?.trim().slice(0, 50)}" href="${a.href}"`;
      });
  });
  console.log(`\nALL STORE/SUBDOMAIN LINKS (${allSellerLinks.length}) relative to #CompanyDetails →`);
  allSellerLinks.forEach((l) => console.log(' ', l));

  // --- Seller (JSON-LD + DOM) ---
  const seller = await page.evaluate(() => {
    let jldSellerName = '', jldProfileUrl = '', jldAddress = '', jldCity = '', jldState = '', jldPhone = '', jldLogo = '';
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(script.textContent ?? '{}');
        const graphs: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        for (const g of graphs) {
          if (g['@type'] === 'Product' && g.offers?.seller) {
            jldSellerName = jldSellerName || (g.offers.seller.name ?? '');
            jldProfileUrl = jldProfileUrl || (g.offers.seller.url ?? '');
          }
          if (g['@type'] === 'LocalBusiness') {
            jldLogo  = jldLogo  || (g.image ?? '');
            jldPhone = jldPhone || (g.telephone ?? '');
            const addr = g.address ?? {};
            jldAddress = jldAddress || (addr.streetAddress ?? '');
            jldCity    = jldCity    || (addr.addressLocality ?? '').replace(/,\s*$/, '');
            jldState   = jldState   || (addr.addressRegion ?? '');
          }
        }
      } catch { }
    }

    const heading = document.getElementById('CompanyDetails');
    let table: Element | null = heading?.querySelector('table') ?? null;
    if (!table && heading) {
      let node: Element | null = heading.nextElementSibling;
      let g = 0;
      while (node && g < 6 && !table) {
        if (node.tagName === 'TABLE') table = node;
        else table = node.querySelector?.('table') ?? null;
        node = node.nextElementSibling; g++;
      }
    }
    const rows: Record<string, string> = {};
    table?.querySelectorAll('tr').forEach((tr) => {
      const td = tr.querySelectorAll('td');
      if (td.length >= 2) {
        const k = td[0].textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
        const v = td[1].textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (k) rows[k] = v;
      }
    });
    return { jldSellerName, jldProfileUrl, jldAddress, jldCity, jldState, jldPhone, jldLogo, tableFound: !!table, rows };
  });
  console.log('\nSELLER →', JSON.stringify(seller, null, 2));

  // --- Images ---
  const images = await page.evaluate(() => {
    return (Array.from(document.querySelectorAll('img[src]')) as HTMLImageElement[])
      .map((img) => img.src)
      .filter((src) => src.includes('ExtraLarge') || src.includes('Medium') || src.includes('/Large/'))
      .slice(0, 5);
  });
  console.log(`\nIMAGES (${images.length}) →`);
  images.forEach((u) => console.log(' ', u));

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════\n');

  await browser.close();
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
