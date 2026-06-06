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

  const allHrefs = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && (h.startsWith('http') || h.startsWith('/')))
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 20);

  const loadMoreBtn = document.getElementById('loadMoreBtn');

  return {
    productLinkCount: productLinks.length,
    sampleProductLinks: [...new Set(productLinks)].slice(0, 10),
    sampleAllHrefs: allHrefs,
    hasLoadMoreBtn: !!loadMoreBtn,
    pageTitle: document.title,
    bodyText: document.body.innerText.slice(0, 300),
  };
});

console.log('\n=== Results ===');
console.log('Page title:', results.pageTitle);
console.log('Product links found:', results.productLinkCount);
console.log('Has #loadMoreBtn:', results.hasLoadMoreBtn);
if (results.sampleProductLinks.length > 0) {
  console.log('\nSample product links:');
  results.sampleProductLinks.forEach(u => console.log('  ', u));
} else {
  console.log('\nNO product links found! Sample all hrefs:');
  results.sampleAllHrefs.forEach(u => console.log('  ', u));
  console.log('\nPage body snippet:', results.bodyText);
}

await browser.close();
