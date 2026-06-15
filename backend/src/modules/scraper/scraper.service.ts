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

  private async prepPage(page: Page, url: string, timeout: number): Promise<void> {
    await page.goto(url, {
      waitUntil: 'domcontentloaded', 
      timeout,
    });
    
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 })
      .catch(() => {}); 
    await this.unlockHighResImages(page);
    
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const MAX_TICKS = 60; 
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
    await sleep(800); 
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

        await this.prepPage(page, url, timeout); 

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

        await this.prepPage(page, url, timeout); 

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

  async discoverProductUrls(listingUrl: string, maxProducts = 0): Promise<string[]> {
    const timeout = this.config.get<number>('scraping.timeout') ?? 30000;
    const cap = maxProducts > 0 ? maxProducts : Infinity;
    const session = await this.browserPool.acquire();
    const page = await session.context.newPage();
    const urls = new Set<string>();

    const collect = async () => {
      const found: string[] = await page.evaluate((listing) => {
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        return anchors
          .map((a) => a.href)
          .filter((h) => {
            if (!/aajjo\.com/i.test(h)) return false;
            if (/aajjo\.com\/product\//i.test(h)) return true;
            try {
              const base = new URL(listing);
              const candidate = new URL(h);
              if (candidate.hostname !== base.hostname) return false;
              const basePath = base.pathname.replace(/\/$/, '');
              const candPath = candidate.pathname.replace(/\/$/, '');
              if (!candPath.startsWith(basePath + '/')) return false;
              const extra = candPath.slice(basePath.length + 1);
              return extra.length > 0 && !extra.startsWith('page/') && !extra.startsWith('filter/');
            } catch {
              return false;
            }
          });
      }, listingUrl);
      found.forEach((u) => urls.add(u.split('#')[0].split('?')[0]));
    };
    const anchorCount = () =>
      page.evaluate((listing) => {
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        return anchors.filter((a) => {
          const h = a.href;
          if (!/aajjo\.com/i.test(h)) return false;
          if (/aajjo\.com\/product\//i.test(h)) return true;
          try {
            const base = new URL(listing);
            const candidate = new URL(h);
            if (candidate.hostname !== base.hostname) return false;
            const basePath = base.pathname.replace(/\/$/, '');
            const candPath = candidate.pathname.replace(/\/$/, '');
            if (!candPath.startsWith(basePath + '/')) return false;
            const extra = candPath.slice(basePath.length + 1);
            return extra.length > 0 && !extra.startsWith('page/') && !extra.startsWith('filter/');
          } catch {
            return false;
          }
        }).length;
      }, listingUrl);

    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout });
      await sleep(2500);
      await collect();

      const MAX_CLICKS = 300; 
      const MAX_STALE = 5;    
      let staleRounds = 0;

      for (let i = 0; i < MAX_CLICKS && urls.size < cap && staleRounds < MAX_STALE; i++) {
        const before = urls.size;
        const beforeAnchors = await anchorCount();

        const btn = await page.$('#loadMoreBtn');
        const visible = btn ? await btn.isVisible().catch(() => false) : false;
        if (!btn || !visible) break; 

        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 5000 }).catch(() => {});

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
