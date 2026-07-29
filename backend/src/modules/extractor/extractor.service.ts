import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { SELECTORS } from './aajjo-selectors';

export interface SpecItem {
  name: string;
  value: string;
  rawName: string;
  section: 'basic' | 'extended';
  confidence: number;
}

export interface ImageRef {
  originalUrl: string;
  isFeatured: boolean;
}

export interface SellerData {
  sellerName: string;
  sellerLogoUrl: string;
  gstNumber: string;
  address: string;
  state: string;
  country: string;
  businessType: string;
  yearsEstablished: number | null;
  numberOfEmployees: string;
  turnover: string;
  legalStatus: string;
  contactDetails: string;
  aajjoProfileUrl: string;
}

export interface ExtractedProduct {
  productName: string;
  subCategory: string;
  productType: string;
  price: number | null;
  currency: string;
  priceUnit: string;
  moq: number | null;
  description: string;
  deliveryInformation: string;
  warrantyInformation: string;
  specifications: SpecItem[];
  images: ImageRef[];
  seller: SellerData;
  sourceUrl: string;
  confidenceScore: number;
}

@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);

  // Row keys that identify a seller/company profile table (GST, turnover, etc.)
  // so it isn't mistaken for a product specification table when Aajjo renders it
  // without the usual #CompanyDetails wrapper.
  private static readonly SELLER_PROFILE_KEYS = [
    'gst number',
    'gst no',
    'year of establishment',
    'nature of business',
    'number of employees',
    'turnover',
    'annual turnover',
    'legal status',
  ];

  private async trySelectors(
    page: Page,
    selectors: string[],
    attribute?: string,
  ): Promise<{ value: string; confidence: number }> {
    for (let i = 0; i < selectors.length; i++) {
      try {
        const el = await page.$(selectors[i]);
        if (!el) continue;
        const raw = attribute
          ? ((await el.getAttribute(attribute)) ?? '')
          : ((await el.textContent()) ?? '');
        const value = raw.trim();
        if (value) return { value, confidence: Math.max(100 - i * 10, 40) };
      } catch {
        continue;
      }
    }
    return { value: '', confidence: 0 };
  }

  private parsePrice(raw: string): { price: number | null; currency: string } {
    const currencyMap: Record<string, string> = { '₹': 'INR', '$': 'USD', '€': 'EUR' };
    let currency = 'INR';
    for (const [sym, iso] of Object.entries(currencyMap)) {
      if (raw.includes(sym)) { currency = iso; break; }
    }
    const numStr = raw.replace(/[₹$€,]/g, '').match(/[\d.]+/)?.[0];
    const price = numStr ? parseFloat(numStr) : null;
    return { price, currency };
  }

  private async extractPriceUnit(page: Page): Promise<string> {
    try {
      return await page.evaluate(() => {
        const candidates = ['.new-price', '.product-price', '.price', '[class*="price"]'];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (!el) continue;
          // Normalise all whitespace to single spaces so multiline HTML doesn't fool us
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          const slashIdx = text.indexOf('/');
          if (slashIdx === -1) continue;
          const afterSlash = text.slice(slashIdx + 1).trim();
          // Stop at known stop-phrase that Aajjo appends ("Get Latest Price", "Buy Now", …)
          const cleaned = afterSlash
            .replace(/\b(Get|Buy|Contact|Request|View|Call|Ask)\b.*/i, '')
            .trim();
          const words = cleaned
            .split(/\s+/)
            .filter((w: string) => /^[A-Za-z]/.test(w))
            .slice(0, 4);
          if (words.length > 0) return words.join(' ');
        }
        return '';
      });
    } catch {
      return '';
    }
  }

  private async extractMoq(page: Page): Promise<number | null> {
    try {
      const text = await page.evaluate(() => document.body.innerText);
      const match = text.match(/Min(?:imum)?\s+Order\s+Quantity\s*[:\-]\s*([\d,]+)/i);
      if (match) {
        const n = parseFloat(match[1].replace(/,/g, ''));
        return isNaN(n) ? null : n;
      }
    } catch {  }
    return null;
  }

  private async navigateProductTabs(page: Page): Promise<void> {
    
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const clickTab = async (selector: string): Promise<boolean> => {
      try {
        const el = await page.$(selector);
        if (!el) return false;
        await el.click();
        await sleep(150); 
        return true;
      } catch {
        return false;
      }
    };

    if (!await clickTab('a[href="#Specification"]')) {
      await clickTab('a[href="#TechnicalSpecification"]') ||
        await clickTab('[data-toggle="tab"][href*="Spec"]') ||
        await clickTab('[data-bs-toggle="tab"][href*="Spec"]');
    }

    if (!await clickTab('a[href="#Description"]')) {
      await clickTab('a[href="#ProductDescription"]') ||
        await clickTab('[data-toggle="tab"][href*="Description"]') ||
        await clickTab('[data-bs-toggle="tab"][href*="Description"]');
    }

    if (!await clickTab('a[href="#CompanyDetails"]')) {
      await clickTab('a[href="#SellerDetails"]') ||
        await clickTab('[data-toggle="tab"][href*="Company"]') ||
        await clickTab('[data-bs-toggle="tab"][href*="Company"]');
    }
  }

  private async expandSpecifications(page: Page): Promise<void> {
    try {
      const clicked = await page.evaluate(() => {
        const keywords = [
          'more specification',
          'show more specification',
          'view all specification',
          'all specification',
          'more spec',
          'show all',
          'view more',
          'more details',
        ];
        const els = Array.from(
          document.querySelectorAll('a, button, [role="button"], .show-more, .more-spec, [class*="more-spec"], [id*="more-spec"], [class*="showMore"], [id*="showMore"]'),
        ) as HTMLElement[];
        for (const el of els) {
          const txt = (el.textContent ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (keywords.some((k) => txt.includes(k))) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {});
        await new Promise<void>((r) => setTimeout(r, 1200));
        this.logger.debug('expandSpecifications: clicked More Specifications');
      }
    } catch (e: any) {
      this.logger.debug(`expandSpecifications: ${e.message}`);
    }
  }

  private async extractBreadcrumb(page: Page): Promise<{ category: string; subCategory: string }> {
    try {
      return await page.evaluate(() => {
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

        const decodeHtml = (str: string): string => {
          if (!str.includes('&')) return str;
          const ta = document.createElement('textarea');
          ta.innerHTML = str;
          return ta.value;
        };
        const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of jsonLdScripts) {
          try {
            const data = JSON.parse(script.textContent ?? '{}');
            const graphs: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];
            for (const g of graphs) {
              if (g['@type'] === 'BreadcrumbList' && Array.isArray(g.itemListElement)) {
                const items: string[] = g.itemListElement
                  .map((i: any) => decodeHtml((i.name ?? i.item?.name ?? '').trim()))
                  .filter((n: string) => n && n.toLowerCase() !== 'home');
                if (items.length >= 1) {
                  return { category: items[0] ?? '', subCategory: items[1] ?? '' };
                }
              }
            }
          } catch {  }
        }

        const listBreadcrumb = document.querySelector(
          'ol.breadcrumb, ul.breadcrumb, nav[aria-label*="breadcrumb" i], [role="navigation"][class*="breadcrumb"]',
        );
        if (listBreadcrumb) {
          
          const links = Array.from(listBreadcrumb.querySelectorAll('a')).filter(
            (a) => a.textContent?.trim().toLowerCase() !== 'home' && a.textContent?.trim(),
          );
          if (links.length >= 1) {
            return { category: clean(links[0]), subCategory: links[1] ? clean(links[1]) : '' };
          }
          
          const items = Array.from(listBreadcrumb.querySelectorAll('li'))
            .map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '')
            .filter((t) => t && t.toLowerCase() !== 'home');
          if (items.length >= 1) {
            return { category: items[0] ?? '', subCategory: items[1] ?? '' };
          }
        }

        const candidates = Array.from(
          document.querySelectorAll('[class*="breadcrumb"], [id*="breadcrumb"]'),
        );
        for (const el of candidates) {
          const links = Array.from(el.querySelectorAll('a')).filter(
            (a) => a.textContent?.trim().toLowerCase() !== 'home' && a.textContent?.trim(),
          );
          if (links.length >= 1) {
            return { category: clean(links[0]), subCategory: links[1] ? clean(links[1]) : '' };
          }
          const text = el.textContent ?? '';
          const parts = text.split(/[»›>]/).map((s) => s.trim()).filter(Boolean);
          if (parts.length >= 3) {
            const nonHome = parts.filter((p) => p.toLowerCase() !== 'home');
            if (nonHome.length >= 1) {
              return { category: nonHome[0], subCategory: nonHome[1] ?? '' };
            }
          }
        }

        const containers = Array.from(document.querySelectorAll('nav, div, p, span')) as HTMLElement[];
        for (const el of containers) {
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
            if (category) return { category, subCategory };
          }
        }

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

        return { category: clean(cat1) || '', subCategory: clean(cat2) || '' };
      });
    } catch (e: any) {
      this.logger.warn(`extractBreadcrumb failed: ${e.message}`);
      return { category: '', subCategory: '' };
    }
  }

  private async extractSpecs(page: Page): Promise<SpecItem[]> {
    const specs: SpecItem[] = [];
    const seen = new Set<string>();

    try {
      const rows = await page.evaluate((sellerKeys: string[]) => {
        const out: { key: string; val: string; section: 'basic' | 'extended' }[] = [];

        const isSellerInfoTable = (table: Element): boolean => {
          const keys = Array.from(table.querySelectorAll('tr'))
            .map((tr) => {
              const td = tr.querySelectorAll('td');
              return td.length >= 2 ? (td[0].textContent ?? '').trim().toLowerCase() : '';
            })
            .filter(Boolean);
          if (keys.length === 0) return false;
          const matches = keys.filter((k) => sellerKeys.some((sk) => k.includes(sk))).length;
          return matches / keys.length >= 0.5;
        };

        const readTable = (table: Element | null | undefined, section: 'basic' | 'extended') => {
          if (!table) return;
          table.querySelectorAll('tr').forEach((tr) => {
            const cells = Array.from(tr.querySelectorAll('td'));
            if (cells.length >= 2) {
              const key = cells[0].textContent?.trim() ?? '';
              const val = cells[1].textContent?.trim() ?? '';
              if (key && val) out.push({ key, val, section });
            } else if (cells.length === 1) {
              const text = cells[0].textContent?.trim() ?? '';
              const idx = text.indexOf(':');
              if (idx > 0) {
                out.push({
                  key: text.slice(0, idx).trim(),
                  val: text.slice(idx + 1).trim(),
                  section,
                });
              }
            }
          });
        };

        const basicTable =
          document.querySelector('.product-details table.service-chart-datails') ??
          document.querySelector('.product-details table.service-chart-details') ??
          document.querySelector('table.service-chart-datails') ??
          document.querySelector('table.service-chart-details');
        readTable(basicTable, 'basic');

        const isStopNode = (el: Element): boolean => {
          if (/^H[1-4]$/.test(el.tagName)) return true;
          const id = (el.id ?? '').toLowerCase();
          const cls = (el.className ?? '').toLowerCase();
          if (id.includes('company') || cls.includes('company') || id === 'description' || id === 'productdescription') return true;
          // Any container with 3+ tables is a product-listing section, not a spec section
          if (el.querySelectorAll('table').length > 2) return true;
          return false;
        };

        const specSectionIds = ['Specification', 'TechnicalSpecification', 'technical-specification'];
        for (const id of specSectionIds) {
          const section = document.getElementById(id);
          if (!section) continue;

          const companyBoundary = document.getElementById('CompanyDetails');
          const descBoundary    = document.getElementById('Description');

          const isAfterBoundary = (table: Element): boolean => {
            
            if (companyBoundary && (companyBoundary.compareDocumentPosition(table) & 4)) return true;
            if (descBoundary    && (descBoundary.compareDocumentPosition(table)    & 4)) return true;
            return false;
          };

          const tablesInside = Array.from(section.querySelectorAll('table')).filter((t) => {
            
            const cls = (t as HTMLElement).className ?? '';
            if (cls.includes('service-chart-datails') || cls.includes('service-chart-details')) return false;

            if (isAfterBoundary(t)) return false;
            if (isSellerInfoTable(t)) return false;
            return true;
          });
          if (tablesInside.length > 0) {
            // Only read the FIRST extended table — subsequent tables are usually
            // specs from other sellers/products aggregated on the same Aajjo page
            readTable(tablesInside[0], 'extended');
            break;
          }

          let node: Element | null = section.nextElementSibling;
          let guard = 0;
          while (node && guard < 8 && !isStopNode(node)) {
            if (node.tagName === 'TABLE') {
              if (!isSellerInfoTable(node)) readTable(node, 'extended');
              break; // stop after first table found while walking siblings
            }
            const firstTable = node.querySelector('table');
            if (firstTable) {
              if (!isSellerInfoTable(firstTable)) readTable(firstTable, 'extended');
              break;
            }
            node = node.nextElementSibling;
            guard++;
          }
          if (out.some((r) => r.section === 'extended')) break;
        }

        if (!out.some((r) => r.section === 'extended')) {
          document
            .querySelectorAll('table.specification-chart-datails, table.specification-chart-details')
            .forEach((t) => {
              let parent = t.parentElement;
              let inCompany = false;
              while (parent) {
                if (parent.id === 'CompanyDetails') { inCompany = true; break; }
                parent = parent.parentElement;
              }
              if (!inCompany && !isSellerInfoTable(t)) readTable(t, 'extended');
            });
        }

        return out;
      }, ExtractorService.SELLER_PROFILE_KEYS);

      for (const { key, val, section } of rows) {
        if (!key || !val || key.length > 80) continue;
        const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '_');
        // Key-only dedup: first occurrence wins.
        // Prevents duplicate keys from other sellers' spec tables on the same page.
        if (seen.has(normKey)) continue;
        seen.add(normKey);
        specs.push({ name: normKey, value: val, rawName: key, section, confidence: 90 });
      }
    } catch (e: any) {
      this.logger.warn(`extractSpecs failed: ${e.message}`);
    }

    return specs;
  }

  private async extractDescription(page: Page): Promise<string> {
    try {
      return await page.evaluate(() => {
        
        const readElement = (el: Element | null): string => {
          if (!el) return '';

          const normalize = (e: Element): string =>
            (e.textContent ?? '').replace(/\s+/g, ' ').trim();

          const direct = normalize(el);
          if (direct.length > 20) return direct;

          const parts: string[] = [];
          let node: Element | null = el.nextElementSibling;
          let guard = 0;
          while (node && guard < 10 && !/^H[123]$/.test(node.tagName)) {
            const text = normalize(node);
            if (text && text.length > 10) parts.push(text);
            node = node.nextElementSibling;
            guard++;
          }
          return parts.join('\n\n').trim();
        };

        for (const id of [
          'Description',
          'ProductDescription',
          'product-description',
          'productDescription',
          'ProductDesc',
        ]) {
          const el = document.getElementById(id);
          if (el) {
            const text = readElement(el);
            if (text) return text;
          }
        }

        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
        for (const h of headings) {
          const txt = h.textContent?.toLowerCase() ?? '';
          if (txt.includes('description') || txt.includes('about product')) {
            const text = readElement(h);
            if (text) return text;
          }
        }

        for (const sel of [
          '#product-description',
          '.product-description',
          '.about-product',
          '.detail-description',
          '[class*="description"]:not([class*="meta"])',
        ]) {
          const el = document.querySelector(sel);
          const text = el?.textContent?.replace(/\s+/g, ' ').trim();
          if (text && text.length > 20) return text;
        }

        return '';
      });
    } catch (e: any) {
      this.logger.warn(`extractDescription failed: ${e.message}`);
      return '';
    }
  }

  private async extractImages(page: Page): Promise<ImageRef[]> {
    const images: ImageRef[] = [];
    const seen = new Set<string>();

    try {
      const srcs = await page.evaluate((selector) => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(selector));
        return imgs.map((img) => img.src.replace('/small/', '/ExtraLarge/'));
      }, SELECTORS.gallerySelector);

      for (const src of srcs) {
        if (seen.has(src)) continue;
        seen.add(src);
        images.push({ originalUrl: src, isFeatured: images.length === 0 });
        if (images.length >= 5) break;
      }

      if (!images.length) {
        const fallback = await page.evaluate((selector) =>
          (Array.from(document.querySelectorAll<HTMLImageElement>(selector)))
            .map((img) => img.src)
            .slice(0, 5),
        SELECTORS.gallerySelectorFallback);
        fallback.forEach((src, i) => images.push({ originalUrl: src, isFeatured: i === 0 }));
      }
    } catch (e: any) {
      this.logger.warn(`extractImages failed: ${e.message}`);
    }

    return images;
  }

  private async extractSeller(page: Page): Promise<SellerData> {
    try {
      const r = await page.evaluate((sellerKeys: string[]) => {

        let jldSellerName = '';
        let jldProfileUrl = '';
        let jldAddress = '';
        let jldCity = '';
        let jldState = '';
        let jldPhone = '';
        let jldLogo = '';

        const jldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of jldScripts) {
          try {
            const data = JSON.parse(script.textContent ?? '{}');
            const graphs: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];
            for (const g of graphs) {
              
              if (g['@type'] === 'Product' && g.offers?.seller) {
                jldSellerName = jldSellerName || (g.offers.seller.name ?? '');
                jldProfileUrl = jldProfileUrl || (g.offers.seller.url ?? '');
              }
              
              if (g['@type'] === 'LocalBusiness') {
                // Some listings only emit a LocalBusiness block (no Product/offers.seller
                // block above) — it carries the seller's own name/url directly, so fall
                // back to those instead of leaving sellerName/profileUrl empty.
                jldSellerName = jldSellerName || (g.name ?? '');
                jldProfileUrl = jldProfileUrl || (g.url ?? '');
                jldLogo    = jldLogo    || (g.image ?? '');
                jldPhone   = jldPhone   || (g.telephone ?? '');
                const addr = g.address ?? {};
                jldAddress = jldAddress || (addr.streetAddress ?? '');
                jldCity    = jldCity    || (addr.addressLocality ?? '').replace(/,\s*$/, '');
                jldState   = jldState   || (addr.addressRegion ?? '');
              }
            }
          } catch {  }
        }

        const heading = document.getElementById('CompanyDetails');
        let table: Element | null = null;
        if (heading) {
          
          table = heading.querySelector('table');
          
          if (!table) {
            let node: Element | null = heading.nextElementSibling;
            let guard = 0;
            while (node && guard < 6 && !table) {
              if (node.tagName === 'TABLE') table = node;
              else if (node.querySelector) table = node.querySelector('table');
              if (/^H1$/.test(node.tagName)) break;
              node = node.nextElementSibling;
              guard++;
            }
          }
        }

        if (!table) {
          // Some listings inline the seller/company profile table without a
          // #CompanyDetails wrapper — recover it by matching its row keys instead.
          const candidates = Array.from(
            document.querySelectorAll('table.specification-chart-datails, table.specification-chart-details'),
          );
          table = candidates.find((t) => {
            const keys = Array.from(t.querySelectorAll('tr'))
              .map((tr) => {
                const td = tr.querySelectorAll('td');
                return td.length >= 2 ? (td[0].textContent ?? '').trim().toLowerCase() : '';
              })
              .filter(Boolean);
            if (keys.length === 0) return false;
            const matches = keys.filter((k) => sellerKeys.some((sk) => k.includes(sk))).length;
            return matches / keys.length >= 0.5;
          }) ?? null;
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

        const gstSpan = Array.from(document.querySelectorAll('span, p, div')).find((e) =>
          /GST\s*(No|Number)/i.test(e.textContent ?? ''),
        );
        const gst =
          rows['gst number'] ||
          gstSpan?.textContent?.match(/\b([0-9A-Z]{15})\b/)?.[1] ||
          '';

        // Tried in priority order — a single comma-separated selector would instead
        // return whichever match appears first in the DOM, which can pick up an
        // unrelated "logo"-classed image (e.g. a site badge) ahead of the real one.
        const logoDom =
          (document.querySelector('img.detailLogo') as HTMLImageElement | null) ??
          (document.querySelector('img.ahataLgo') as HTMLImageElement | null) ??
          (document.querySelector('.logoWrapper img') as HTMLImageElement | null) ??
          (document.querySelector('img[class*="logo" i]') as HTMLImageElement | null);
        const logo = jldLogo || logoDom?.src || '';

        // Some listings (e.g. store-branded product pages) carry no JSON-LD at all,
        // so the seller name has to come from the same store-link card as the logo.
        const nameDom =
          (document.querySelector('.logoWrapper a[title]') as HTMLElement | null)?.getAttribute('title') ||
          (document.querySelector('img.detailLogo[alt], img.ahataLgo[alt]') as HTMLImageElement | null)?.alt ||
          (document.querySelector('.logoWrapper a, .ps-2 a.fw-bold') as HTMLElement | null)?.textContent?.trim() ||
          '';
        const sellerName = jldSellerName || nameDom;

        // Same store-link card carries the profile URL; the address sits in its own
        // row lower down, tagged with a location-pin icon rather than a class name.
        const profileUrlDom =
          (document.querySelector('.logoWrapper a[href*="/store/"], .logoWrapper a[href*="/ahata/"]') as HTMLAnchorElement | null)?.href || '';
        const addressDom =
          (document.querySelector('svg.svgLocation') as Element | null)?.nextElementSibling?.textContent?.trim() || '';

        const contactFromRows =
          rows['contact person'] || rows['phone'] || rows['mobile'] ||
          rows['contact no'] || rows['contact number'] || rows['telephone'] || '';
        const phoneFromPage = (() => {
          const m = (document.body.innerText ?? '').match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
          return m ? m[0] : '';
        })();
        const contactDetails = jldPhone || contactFromRows || phoneFromPage;

        return {
          rows,
          gst,
          sellerName,
          address:    jldAddress || addressDom,
          city:       jldCity,
          state:      jldState,
          profileUrl: jldProfileUrl || profileUrlDom,
          logo,
          contactDetails,
        };
      }, ExtractorService.SELLER_PROFILE_KEYS);

      const yearStr = r.rows['year of establishment'] ?? '';
      const year = parseInt(yearStr.match(/\d{4}/)?.[0] ?? '', 10);

      return {
        sellerName:       r.sellerName,
        sellerLogoUrl:    r.logo,
        gstNumber:        r.gst,
        address:          [r.address, r.city].filter(Boolean).join(', ').slice(0, 500),
        state:            r.state,
        country:          'India',
        businessType:     r.rows['nature of business'] ?? '',
        yearsEstablished: isNaN(year) ? null : year,
        numberOfEmployees: r.rows['number of employees'] ?? '',
        turnover:         r.rows['turnover'] ?? r.rows['annual turnover'] ?? '',
        legalStatus:      r.rows['legal status'] ?? '',
        contactDetails:   r.contactDetails,
        aajjoProfileUrl:  r.profileUrl,
      };
    } catch (e: any) {
      this.logger.warn(`extractSeller failed: ${e.message}`);
      return {
        sellerName: '',
        sellerLogoUrl: '',
        gstNumber: '',
        address: '',
        state: '',
        country: 'India',
        businessType: '',
        yearsEstablished: null,
        numberOfEmployees: '',
        turnover: '',
        legalStatus: '',
        contactDetails: '',
        aajjoProfileUrl: '',
      };
    }
  }

  private computeConfidence(p: Partial<ExtractedProduct>): number {
    const weights: { key: keyof ExtractedProduct; w: number }[] = [
      { key: 'productName', w: 20 },
      { key: 'price', w: 15 },
      { key: 'subCategory', w: 20 },
      { key: 'specifications', w: 20 },
      { key: 'images', w: 10 },
      { key: 'seller', w: 10 },
      { key: 'description', w: 5 },
    ];
    let score = 0;
    for (const { key, w } of weights) {
      const v = p[key];
      if (!v) continue;
      if (typeof v === 'string' && v.trim()) score += w;
      else if (typeof v === 'number' && v > 0) score += w;
      else if (Array.isArray(v) && v.length > 0) score += w;
      else if (typeof v === 'object' && v !== null && (v as SellerData).sellerName) score += w;
    }
    return score;
  }

  async extractProduct(page: Page, sourceUrl: string): Promise<ExtractedProduct> {
    this.logger.debug(`Extracting ${sourceUrl}`);

    await this.navigateProductTabs(page);
    
    await this.expandSpecifications(page);

    const [nameResult, priceResult, priceUnit, description, deliveryResult, warrantyResult] =
      await Promise.all([
        this.trySelectors(page, SELECTORS.productName),
        this.trySelectors(page, SELECTORS.price),
        this.extractPriceUnit(page),
        this.extractDescription(page),
        this.trySelectors(page, SELECTORS.deliveryInfo),
        this.trySelectors(page, SELECTORS.warrantyInfo),
      ]);

    const [breadcrumb, moq, specs, images, seller] = await Promise.all([
      this.extractBreadcrumb(page),
      this.extractMoq(page),
      this.extractSpecs(page),
      this.extractImages(page),
      this.extractSeller(page),
    ]);

    const { price, currency } = this.parsePrice(priceResult.value);

    const product: ExtractedProduct = {
      productName: nameResult.value || 'Unknown Product',
      subCategory: breadcrumb.category,
      productType: breadcrumb.subCategory,
      price,
      currency,
      priceUnit,
      moq,
      description,
      deliveryInformation: deliveryResult.value,
      warrantyInformation: warrantyResult.value,
      specifications: specs,
      images,
      seller,
      sourceUrl,
      confidenceScore: 0,
    };

    product.confidenceScore = this.computeConfidence(product);
    this.logger.log(
      `Extracted "${product.productName}" cat="${breadcrumb.category}" subCat="${breadcrumb.subCategory}" desc=${description.length}chars specs=${specs.length} images=${images.length} confidence=${product.confidenceScore}%`,
    );

    return product;
  }
}
