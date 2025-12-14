const puppeteer = require('puppeteer');

async function debugTime() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  console.log('Loading article page...');
  await page.goto('https://www.cricbuzz.com/cricket-news/136885/green-confirms-availability-to-bowl-in-ipl-2026', {
    waitUntil: 'networkidle0'
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Get all elements that might contain time
  const timeInfo = await page.evaluate(() => {
    const results = [];
    
    // Check all common time-related selectors
    const selectors = [
      'time',
      '[datetime]',
      '[class*="time"]',
      '[class*="Time"]',
      '[class*="date"]',
      '[class*="Date"]',
      '[class*="publish"]',
      '[class*="Publish"]',
      'span[class*="cb"]',
      'div[class*="cb"]'
    ];
    
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el, idx) => {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          results.push({
            selector,
            index: idx,
            text: text.substring(0, 80),
            html: el.outerHTML.substring(0, 200),
            classes: el.className
          });
        }
      });
    });
    
    return results;
  });
  
  console.log('\n📅 Found potential time elements:\n');
  timeInfo.forEach((info, idx) => {
    if (info.text.match(/\d/) || info.text.toLowerCase().includes('ago') || 
        info.text.toLowerCase().includes('today') || info.text.toLowerCase().includes('yesterday')) {
      console.log(`${idx + 1}. Selector: ${info.selector}[${info.index}]`);
      console.log(`   Text: "${info.text}"`);
      console.log(`   Classes: ${info.classes}`);
      console.log(`   HTML: ${info.html}...\n`);
    }
  });
  
  await browser.close();
}

debugTime().catch(console.error);
