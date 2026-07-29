import { Browser, chromium, Page } from 'playwright';
import { ExtractorService, SellerData } from './extractor.service';

// Regression coverage for the seller-card DOM fallback: some Aajjo product pages
// (e.g. store-branded listings) ship with no application/ld+json at all, so
// extractSeller() must recover sellerName/address/aajjoProfileUrl from the
// visible ".logoWrapper" seller card instead of leaving them blank.
describe('ExtractorService.extractSeller', () => {
  let browser: Browser;
  let page: Page;
  let service: ExtractorService;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30000);

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    service = new ExtractorService();
  });

  afterEach(async () => {
    await page.close();
  });

  // Loads fixture HTML at a real https://www.aajjo.com/* URL (via route interception,
  // no actual network call) so relative hrefs like "/store/..." resolve to absolute
  // URLs exactly as they do in production, where the page is reached via page.goto().
  async function loadFixture(html: string): Promise<void> {
    await page.route('https://www.aajjo.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await page.goto('https://www.aajjo.com/product/test-fixture');
  }

  function extractSeller(): Promise<SellerData> {
    return (service as any).extractSeller(page);
  }

  it('falls back to the store-link seller card when the page has no JSON-LD', async () => {
    await loadFixture(`
      <!doctype html><html><body>
        <div class="border p-3 rounded-2 mb-2 bg-grey-light mb-3">
          <div class="mb-2 d-flex">
            <div class="logoWrapper">
              <a href="/store/sakshi-enterprises-gurugram-3" title="Sakshi Enterprises" class="text-decoration-none fs-7 d-flex fw-bold">
                <img alt="Sakshi Enterprises" class="ahataLgo detailLogo" src="https://d91ztqmtx7u1k.cloudfront.net/ClientContent/Images/small/Vendor.webp" />
              </a>
            </div>
            <div class="ps-2">
              <a href="/store/sakshi-enterprises-gurugram-3" title="Sakshi Enterprises" class="fw-bold">Sakshi Enterprises</a>
            </div>
          </div>
          <p class="mb-0"><span> GST No - 06AAKPJ3235A1Z9 </span></p>
          <p class="mb-0">
            <svg class="svgLocation"></svg>
            <span>Shop No 3, near Shanti Gas Agency, Chakkarpur, Gurugram, Haryana 122002</span>
          </p>
        </div>
      </body></html>
    `);

    const seller = await extractSeller();

    expect(seller.sellerName).toBe('Sakshi Enterprises');
    expect(seller.gstNumber).toBe('06AAKPJ3235A1Z9');
    expect(seller.address).toBe('Shop No 3, near Shanti Gas Agency, Chakkarpur, Gurugram, Haryana 122002');
    expect(seller.aajjoProfileUrl).toBe('https://www.aajjo.com/store/sakshi-enterprises-gurugram-3');
    expect(seller.sellerLogoUrl).toBe('https://d91ztqmtx7u1k.cloudfront.net/ClientContent/Images/small/Vendor.webp');
  });

  it('prefers JSON-LD seller data over the DOM fallback when both are present', async () => {
    await loadFixture(`
      <!doctype html><html><head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "JSON-LD Seller Co",
            "url": "https://www.aajjo.com/store/json-ld-seller-co",
            "address": {
              "streetAddress": "1 JSON Street",
              "addressLocality": "Testville",
              "addressRegion": "TS"
            }
          }
        </script>
      </head><body>
        <div class="logoWrapper">
          <a href="/store/dom-seller-co" title="DOM Seller Co" class="fw-bold">
            <img alt="DOM Seller Co" class="ahataLgo detailLogo" src="https://example.com/logo.webp" />
          </a>
        </div>
        <p class="mb-0"><svg class="svgLocation"></svg><span>999 DOM Address</span></p>
      </body></html>
    `);

    const seller = await extractSeller();

    expect(seller.sellerName).toBe('JSON-LD Seller Co');
    expect(seller.address).toBe('1 JSON Street, Testville');
    expect(seller.state).toBe('TS');
    expect(seller.aajjoProfileUrl).toBe('https://www.aajjo.com/store/json-ld-seller-co');
  });

  it('returns empty seller fields without throwing when neither JSON-LD nor the seller card exists', async () => {
    await loadFixture('<!doctype html><html><body><p>No seller info here.</p></body></html>');

    const seller = await extractSeller();

    expect(seller.sellerName).toBe('');
    expect(seller.address).toBe('');
    expect(seller.aajjoProfileUrl).toBe('');
    expect(seller.gstNumber).toBe('');
  });
});
