/**
 * Selectors verified against live Aajjo product pages (June 2026).
 * Structure observed:
 *  - Title:   <h1 class="sub-headings fs-4 title fw-bold ...">
 *  - Price:   <div class="new-price ..."> contains <span class="fw-bold"> ₹ XX,XXX
 *  - Specs:   <table> with 2 <td> cells (key | value) OR 1 <td> "key : value"
 *  - Images:  <img src="...ExtraLarge..."> (main), <img src="...Medium..."> (gallery)
 *  - Category: breadcrumb — handled by extractBreadcrumb() with 3-strategy fallback
 *              because Aajjo does NOT always use <ol class="breadcrumb"> <li>
 *  - Description: heading id varies ("Description", "ProductDescription") — handled
 *                 by extractDescription() with id + text-search fallback
 */
export const SELECTORS = {
  // ── Product title ────────────────────────────────────────────────────────
  productName: [
    'h1.sub-headings',
    'h1.title',
    'h1[class*="title"]',
    'h1[class*="product"]',
    'h1',
  ],

  // ── Price ────────────────────────────────────────────────────────────────
  price: [
    '.new-price span.fw-bold',
    '.new-price',
    '.product-price span.fw-bold',
    '.price span.fw-bold',
    '[class*="price"] span.fw-bold',
    '[class*="price"]',
  ],

  // ── Currency — usually embedded in price text (₹) ───────────────────────
  currency: [
    '[itemprop="priceCurrency"]',
    '.currency-symbol',
  ],

  // ── MOQ — extracted via text regex in extractor, not direct selector ─────
  moq: [
    '[class*="moq"]',
    '[data-label="MOQ"]',
  ],

  // ── Category / breadcrumb — NOT used directly; handled by extractBreadcrumb()
  // Kept here as reference for manual debugging only.
  category: [
    'ol.breadcrumb li:nth-child(2)',
    'nav[aria-label="breadcrumb"] li:nth-child(2)',
    '.breadcrumb-item:nth-child(2)',
    '[class*="breadcrumb"] a:nth-child(2)',
    'meta[property="product:category"]',
  ],

  subCategory: [
    'ol.breadcrumb li:nth-child(3)',
    'nav[aria-label="breadcrumb"] li:nth-child(3)',
    '.breadcrumb-item:nth-child(3)',
    '[class*="breadcrumb"] a:nth-child(3)',
  ],

  // ── Description — NOT used directly; handled by extractDescription() ─────
  description: [
    '#Description',
    '#ProductDescription',
    '#product-description',
    '.product-description',
    '[class*="description"]:not([class*="meta"])',
    '.detail-description',
    '.about-product',
  ],

  // ── Delivery & warranty ───────────────────────────────────────────────────
  deliveryInfo: [
    '.delivery-information',
    '#delivery-info',
    '[class*="delivery"]',
    '[class*="shipping"]',
  ],
  warrantyInfo: [
    '.warranty-information',
    '#warranty-info',
    '[class*="warranty"]',
    '[class*="guarantee"]',
  ],

  // ── Spec tables — both spellings of Aajjo's class name typo ──────────────
  // The extractor handles both formats; this selector gets the TABLE element.
  specTableBasic: [
    '.product-details table.service-chart-datails',
    '.product-details table.service-chart-details',
    'table.service-chart-datails',
    'table.service-chart-details',
  ],
  specTableExtended: [
    '#Specification table.specification-chart-datails',
    '#Specification table.specification-chart-details',
    '#TechnicalSpecification table',
    'table.specification-chart-datails',
    'table.specification-chart-details',
  ],

  // ── Images — Aajjo CDN uses ExtraLarge / Medium / Large path segments ─────
  mainImagePattern: 'ExtraLarge',
  galleryImagePattern: 'Medium',

  // ── Seller / company info ─────────────────────────────────────────────────
  sellerLogoImg: [
    'img.ahataLgo',
    'img.detailLogo',
    '.logoWrapper img',
    'img[class*="logo"]',
  ],
  sellerAddress: [
    '.seller-address',
    '.supplier-address',
    '[class*="address"]',
    '[itemprop="address"]',
  ],
  sellerContact: [
    '.contact-number',
    '.phone-number',
    '[class*="contact"]',
    '[class*="phone"]',
  ],
  sellerGst: [
    '[class*="gst"]',
    '[data-label="GST"]',
  ],
  sellerProfileUrl: [
    'a[href*="/ahata/"]',
    'a[href*="/supplier/"]',
    '.company-profile-link a',
  ],
};
