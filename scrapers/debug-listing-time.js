const puppeteer = require('puppeteer');

async function debugListingTime() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  console.log('Loading news listing page...');
  await page.goto('https://www.cricbuzz.com/cricket-news/latest-news', {
    waitUntil: 'networkidle0'
  });
  
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check first few news items for time info
  const newsWithTime = await page.evaluate(() => {
    const results = [];
    const newsLinks = document.querySelectorAll('a[href*="/cricket-news/"]');
    
    newsLinks.forEach((link, idx) => {
      if (idx < 5) { // Check first 5
        const title = link.textContent.trim().substring(0, 60);
        let parent = link.parentElement;
        
        // Search in parent containers
        for (let i = 0; i < 3 && parent; i++) {
          const timeElements = parent.querySelectorAll('[class*="time"], [class*="Time"], [class*="date"], [class*="Date"], span, div');
          
          timeElements.forEach(el => {
            const text = el.textContent.trim();
            // Look for patterns like "2 hours ago", "1 day ago", dates, etc
            if (text.match(/\d+\s*(hour|min|day|week|month|year|ago)|today|yesterday|\d{1,2}:\d{2}/i)) {
              results.push({
                title,
                timeText: text.substring(0, 50),
                className: el.className
              });
            }
          });
          
          parent = parent.parentElement;
        }
      }
    });
    
    return results;
  });
  
  console.log('\n📰 News items with time indicators:\n');
  if (newsWithTime.length > 0) {
    newsWithTime.forEach((item, idx) => {
      console.log(`${idx + 1}. "${item.title}..."`);
      console.log(`   Time: "${item.timeText}"`);
      console.log(`   Class: ${item.className}\n`);
    });
  } else {
    console.log('❌ No time indicators found on listing page');
  }
  
  await browser.close();
}

debugListingTime().catch(console.error);
