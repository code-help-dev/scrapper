
export const SELECTORS = {
  
  productName: [
    'h1.sub-headings',
    'h1.title',
    'h1[class*="title"]',
    'h1[class*="product"]',
    'h1',
  ],

  price: [
    '.new-price span.fw-bold',
    '.new-price',
    '.product-price span.fw-bold',
    '.price span.fw-bold',
    '[class*="price"] span.fw-bold',
    '[class*="price"]',
  ],

  currency: [
    '[itemprop="priceCurrency"]',
    '.currency-symbol',
  ],

  moq: [
    '[class*="moq"]',
    '[data-label="MOQ"]',
  ],

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

  description: [
    '#Description',
    '#ProductDescription',
    '#product-description',
    '.product-description',
    '[class*="description"]:not([class*="meta"])',
    '.detail-description',
    '.about-product',
  ],

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

  gallerySelector:
    '.prdDet-sticky .img-showcase img[src], .prdDet-sticky .img-select .img-item img[src]',
  gallerySelectorFallback: 'img[src*="ExtraLarge"], img[src*="/Large/"], img[src*="Medium"]',

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
