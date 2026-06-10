import { chromium } from 'playwright';

const URL = 'https://www.aajjo.com/product/videojet-wash-solution-in-pune-sh-hitech-solutions';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

console.log('Navigating to product:', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

const data = await page.evaluate(() => {
  const getText = (sel) => { const el = document.querySelector(sel); return el ? el.innerText.trim() : ''; };

  const allClasses = [];
  document.querySelectorAll('[class]').forEach(el => {
    const c = el.className;
    if (typeof c === 'string' && c.toLowerCase().includes('product')) allClasses.push(c);
  });

  return {
    title: document.title,
    h1: getText('h1'),
    bodySnippet: document.body.innerText.slice(0, 600),
    allProductClasses: allClasses.slice(0, 10),
  };
});

console.log('\nPage title:', data.title);
console.log('H1:', data.h1);
console.log('Product-related classes:', data.allProductClasses);
console.log('\nBody snippet:\n', data.bodySnippet);

await browser.close();
