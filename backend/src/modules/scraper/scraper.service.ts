import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page } from 'playwright';
import { BrowserPoolService, BrowserSession } from './browser-pool.service';

export interface ScrapedPage {
  url: string;
  html: string;
  finalUrl: string;
  hasCaptcha: boolean;
  loadedAt: Date;
}

const CAPTCHA_SIGNALS = [
  'cf-challenge',
  'g-recaptcha',
  'h-captcha',
  'captcha-container',
  'Just a moment',
  'Checking your browser',
  'DDoS protection',
  'Access denied',
];

// B1 fix: replaced waitUntil: 'networkidle' (never reached on Aajjo) with this helper
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    private readonly browserPool: BrowserPoolService,
    private readonly config: ConfigService,
  ) {}

  private delay(min: number, max: number): Promise<void> {
    return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  private detectCaptcha(html: string, title: string): boolean {
    const combined = html + title;
    return CAPTCHA_SIGNALS.some((s) =>
      combined.toLowerCase().includes(s.toLowerCase()),
    );
  }

  // Force highest-resolution image URLs — swap thumbnails for full-res
  async unlockHighResImages(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.querySelectorAll('img[data-src]').forEach((img) => {
        const el = img as HTMLImageElement;
        if (el.dataset.src) el.src = el.dataset.src;
      });
      document.querySelectorAll('img[data-lazy-src]').forEach((img) => {
        const el = img as HTMLImageElement;
        if (el.dataset.lazySrc) el.src = el.dataset.lazySrc;
      });
      document.querySelectorAll('img[srcset]').forEach((img) => {
        const el = img as HTMLImageElement;
        const parts = el.srcset.split(',').map((s) => s.trim().split(/\s+/));
        const best = parts.reduce(
          (prev, curr) =>
            parseFloat(curr[1] ?? '0') > parseFloat(prev[1] ?? '0') ? curr : prev,
          ['', '0'],
        );
        if (best[0]) el.src = best[0];
      });
    });
  }

  // Shared page setup — B1 fix: domcontentloaded + short settle instead of networkidle
  private async prepPage(page: Page, url: string, timeout: number): Promise<void> {
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // B1: was 'networkidle', timed out on Aajjo
      timeout,
    });
    // Wait for main content to render (Aajjo uses React-like rendering)
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 })
      .catch(() => {}); // non-fatal — continue even if not complete
    await this.unlockHighResImages(page);
    // Scroll to trigger lazy-load.
    // Cap at MAX_TICKS to prevent an infinite loop when lazy-loaded sections
    // (e.g. Aajjo similar-products sidebar) keep expanding scrollHeight.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const MAX_TICKS = 60; // 60 × 80 ms = 4.8 s ceiling
        let ticks = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 300);
          ticks++;
          if (ticks >= MAX_TICKS || window.scrollY + window.innerHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 80);
      });
    });
    await sleep(800); // reduced from 1500 ms — content is already in DOM after domcontentloaded
  }

  async loadPage(url: string, retries = 3): Promise<ScrapedPage> {
    const timeout = this.config.get<number>('scraping.timeout') ?? 30000;
    const delayMin = this.config.get<number>('scraping.requestDelayMin') ?? 2000;
    const delayMax = this.config.get<number>('scraping.requestDelayMax') ?? 5000;

    let lastError: Error | undefined;
    let session: BrowserSession | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        session = await this.browserPool.acquire();
        const page = await session.context.newPage();

        await this.prepPage(page, url, timeout); // B1+B6 fix applied here

        const html = await page.content();
        const title = await page.title();
        const finalUrl = page.url();

        await page.close();
        await this.browserPool.release(session.id);

        const hasCaptcha = this.detectCaptcha(html, title);
        if (hasCaptcha) {
          this.logger.warn(`CAPTCHA detected on ${url} (attempt ${attempt})`);
          await this.delay(delayMin * 3, delayMax * 3);
          lastError = new Error('CAPTCHA detected');
          continue;
        }

        await this.delay(delayMin, delayMax);
        return { url, html, finalUrl, hasCaptcha: false, loadedAt: new Date() };
      } catch (err: any) {
        if (session) await this.browserPool.release(session.id).catch(() => {});
        lastError = err;
        this.logger.warn(`loadPage attempt ${attempt}/${retries} failed: ${err.message}`);
        await this.delay(5000 * attempt, 10000 * attempt);
      }
    }

    throw lastError ?? new Error(`Failed to load ${url} after ${retries} attempts`);
  }

  /**
   * withPage — acquires a browser, preps the page, passes it to fn, cleans up.
   * Processors use this so they never touch the browser pool directly.
   */
  async withPage<T>(url: string, fn: (page: Page) => Promise<T>, retries = 3): Promise<T> {
    const timeout = this.config.get<number>('scraping.timeout') ?? 30000;
    const delayMin = this.config.get<number>('scraping.requestDelayMin') ?? 2000;
    const delayMax = this.config.get<number>('scraping.requestDelayMax') ?? 5000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      let session: BrowserSession | undefined;
      let page: Page | undefined;

      try {
        session = await this.browserPool.acquire();
        page = await session.context.newPage();

        await this.prepPage(page, url, timeout); // B1+B6 fix applied here

        const html = await page.content();
        const title = await page.title();
        if (this.detectCaptcha(html, title)) {
          this.logger.warn(`CAPTCHA on ${url} (attempt ${attempt})`);
          await this.delay(delayMin * 3, delayMax * 3);
          lastError = new Error('CAPTCHA detected');
          continue;
        }

        const result = await fn(page);
        await this.delay(delayMin, delayMax);
        return result;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`withPage attempt ${attempt}/${retries} failed: ${err.message}`);
        await this.delay(5000 * attempt, 10000 * attempt);
      } finally {
        if (page) await page.close().catch(() => {});
        if (session) await this.browserPool.release(session.id).catch(() => {});
      }
    }

    throw lastError ?? new Error(`Failed to load ${url} after ${retries} attempts`);
  }

  /**
   * Discover individual product URLs from a category / listing page.
   *
   * Aajjo listing pages render ~125 products up front and load the rest via a
   * "Load More" button (<a id="loadMoreBtn" href="javascript:void(0)">) that
   * fires an AJAX append. Scrolling does NOT load more. So we click the button
   * repeatedly until it disappears or stops producing new products.
   *
   * @param maxProducts hard cap on URLs to return (0 / undefined = no cap).
   */
  async discoverProductUrls(listingUrl: string, maxProducts = 0): Promise<string[]> {
    const timeout = this.config.get<number>('scraping.timeout') ?? 30000;
    const cap = maxProducts > 0 ? maxProducts : Infinity;
    const session = await this.browserPool.acquire();
    const page = await session.context.newPage();
    const urls = new Set<string>();

    // Collect product URLs currently in the DOM (strip #fragment / ?query so
    // the same product linked twice — image + title — dedupes cleanly).
    const collect = async () => {
      const found: string[] = await page.evaluate(() =>
        (Array.from(document.querySelectorAll('a[href*="/product/"]')) as HTMLAnchorElement[])
          .map((a) => a.href)
          .filter((h) => /aajjo\.com\/product\//i.test(h)),
      );
      found.forEach((u) => urls.add(u.split('#')[0].split('?')[0]));
    };
    const anchorCount = () =>
      page.evaluate(() => document.querySelectorAll('a[href*="/product/"]').length);

    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout });
      await sleep(2500);
      await collect();

      const MAX_CLICKS = 300; // safety ceiling (~125 products/click ⇒ huge catalogs)
      const MAX_STALE = 5;    // tolerate slow AJAX appends before declaring "done"
      let staleRounds = 0;

      for (let i = 0; i < MAX_CLICKS && urls.size < cap && staleRounds < MAX_STALE; i++) {
        const before = urls.size;
        const beforeAnchors = await anchorCount();

        const btn = await page.$('#loadMoreBtn');
        const visible = btn ? await btn.isVisible().catch(() => false) : false;
        if (!btn || !visible) break; // button gone ⇒ genuinely the end

        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 5000 }).catch(() => {});

        // Wait for the AJAX append to add more product anchors
        await page
          .waitForFunction(
            (prev) => document.querySelectorAll('a[href*="/product/"]').length > prev,
            beforeAnchors,
            { timeout: 12000 },
          )
          .catch(() => {});
        await sleep(1500);
        await collect();

        if (urls.size <= before) {
          // No growth this round — the append may just be slow. Give it extra
          // settle time before counting it against the stale budget.
          staleRounds++;
          await sleep(2000);
        } else {
          staleRounds = 0;
        }
        this.logger.debug(`[discover] Load More #${i + 1} → ${urls.size} unique product URLs`);
      }
    } finally {
      await page.close();
      await this.browserPool.release(session.id);
    }

    const result = cap === Infinity ? [...urls] : [...urls].slice(0, cap);
    this.logger.log(`Discovered ${result.length} product URLs from ${listingUrl}`);
    return result;
  }
}
