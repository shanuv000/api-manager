const puppeteer = require('puppeteer');

async function debugImages() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  console.log('Loading article page...');
  await page.goto('https://www.cricbuzz.com/cricket-news/136886/brendon-mccullum-clarifies-overprepared-stance', {
    waitUntil: 'networkidle0'
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Get all images
  const imageInfo = await page.evaluate(() => {
    const results = [];
    const images = document.querySelectorAll('img');
    
    images.forEach((img, idx) => {
      const src = img.src || img.dataset?.src;
      if (src && src.includes('cricbuzz')) {
        results.push({
          index: idx,
          src: src,
          alt: img.alt,
          className: img.className,
          width: img.width,
          height: img.height,
          parent: img.parentElement?.tagName + '.' + img.parentElement?.className
        });
      }
    });
    
    return results;
  });
  
  console.log('\n📸 Found Images on Article Page:\n');
  imageInfo.forEach((info, idx) => {
    console.log(`${idx + 1}. ${info.src}`);
    console.log(`   Alt: ${info.alt || 'N/A'}`);
    console.log(`   Class: ${info.className || 'none'}`);
    console.log(`   Size: ${info.width}x${info.height}`);
    console.log(`   Parent: ${info.parent}\n`);
  });
  
  // Find largest/main image
  const mainImage = imageInfo.reduce((largest, current) => {
    const currentSize = current.width * current.height;
    const largestSize = (largest.width || 0) * (largest.height || 0);
    return currentSize > largestSize ? current : largest;
  }, {});
  
  console.log('🎯 Largest/Main Image:');
  console.log(`   URL: ${mainImage.src}`);
  console.log(`   Size: ${mainImage.width}x${mainImage.height}`);
  
  await browser.close();
}

debugImages().catch(console.error);
