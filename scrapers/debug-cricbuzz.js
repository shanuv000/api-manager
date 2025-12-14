const puppeteer = require('puppeteer');

async function debug() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  console.log('Loading Cricbuzz news page...');
  await page.goto('https://www.cricbuzz.com/cricket-news/latest-news', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Take full page screenshot
  await page.screenshot({ path: 'cricbuzz-page.png', fullPage: true });
  console.log('Screenshot saved to cricbuzz-page.png');
  
  // Get page HTML
  const html = await page.content();
  const fs = require('fs').promises;
  await fs.writeFile('cricbuzz-page.html', html);
  console.log('HTML saved to cricbuzz-page.html');
  
  // Test selectors
  const selectors = [
    'a[href*="/cricket-news/"]',
    '.cb-nws-hdln',
    '.cb-nws-hdln-ancr',
    '.cb-col a',
    'a'
  ];
  
  for (const selector of selectors) {
    const count = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, selector);
    console.log(`Selector "${selector}": found ${count} elements`);
  }
  
  // Get all news links
  const links = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a'));
    return allLinks
      .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 50) }))
      .filter(l => l.href.includes('/cricket-news/'));
  });
  
  console.log('\nSample links found:');
  console.log(JSON.stringify(links.slice(0, 10), null, 2));
  
  await browser.close();
}

debug().catch(console.error);
