import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

import { chromium as chromiumExtra } from 'playwright-extra';

import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromiumExtra.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
];

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  id: string;
}

@Injectable()
export class BrowserPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private sessions: Map<string, BrowserSession> = new Map();
  private maxConcurrent: number;
  private proxyUrl: string;

  constructor(private readonly config: ConfigService) {
    this.maxConcurrent = config.get<number>('scraping.maxConcurrentBrowsers') ?? 5;
    this.proxyUrl = config.get<string>('scraping.proxyServiceUrl') ?? '';
  }

  private randomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async acquire(): Promise<BrowserSession> {
    if (this.sessions.size >= this.maxConcurrent) {
      
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (this.sessions.size < this.maxConcurrent) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });
    }

    const launchOptions: Parameters<typeof chromiumExtra.launch>[0] = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    };

    if (this.proxyUrl) {
      launchOptions.args!.push(`--proxy-server=${this.proxyUrl}`);
    }

    const browser: Browser = await chromiumExtra.launch(launchOptions);

    const contextOptions: Parameters<Browser['newContext']>[0] = {
      userAgent: this.randomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      extraHTTPHeaders: {
        'Accept-Language': 'en-IN,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
    };

    const context = await browser.newContext(contextOptions);

    await context.route('**/*.{gif,svg,woff,woff2,ttf,eot,ico}', (route) =>
      route.abort(),
    );

    const id = crypto.randomUUID();
    const session: BrowserSession = { browser, context, id };
    this.sessions.set(id, session);
    this.logger.debug(`Browser session acquired [${id}] — pool: ${this.sessions.size}/${this.maxConcurrent}`);
    return session;
  }

  async release(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      await session.context.close();
      await session.browser.close();
    } catch {
      
    }
    this.sessions.delete(sessionId);
    this.logger.debug(`Browser session released [${sessionId}] — pool: ${this.sessions.size}/${this.maxConcurrent}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing all browser sessions...');
    await Promise.all(
      [...this.sessions.keys()].map((id) => this.release(id)),
    );
  }
}
