import { chromium } from 'playwright';

const URL = 'https://www.aajjo.com/cleaning-liquids-wipes/washing-chemicals';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

console.log('Navigating to:', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

const results = await page.evaluate(() => {
  const productLinks = Array.from(document.querySelectorAll('a[href*="/product/"]'))
    .map(a => a.href)
    .filter(h => /aajjo\.com\/product\//i.test(h));

  const allLinks = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && h.includes('aajjo.com') || (h && h.startsWith('/')))
    .slice(0, 30);

  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const pageTitle = document.title;

  return {
    productLinkCount: productLinks.length,
    sampleProductLinks: productLinks.slice(0, 10),
    sampleAllLinks: allLinks.slice(0, 20),
    hasLoadMoreBtn: !!loadMoreBtn,
    loadMoreBtnVisible: loadMoreBtn ? loadMoreBtn.offsetParent !== null : false,
    pageTitle,
  };
});

console.log('\n=== Results ===');
console.log('Page title:', results.pageTitle);
console.log('Product links found:', results.productLinkCount);
console.log('Has #loadMoreBtn:', results.hasLoadMoreBtn, '| visible:', results.loadMoreBtnVisible);
console.log('\nSample product links:');
results.sampleProductLinks.forEach(u => console.log('  ', u));
console.log('\nSample all hrefs on page:');
results.sampleAllLinks.forEach(u => console.log('  ', u));

await browser.close();
