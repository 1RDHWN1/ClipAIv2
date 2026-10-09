import { chromium } from 'playwright';

(async () => {
  console.log('--- STARTING FRONTEND PLAYWRIGHT AUDIT ---');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  // 1. Load http://localhost:3010
  console.log('Navigating to http://localhost:3010 ...');
  await page.goto('http://localhost:3010', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Take Studio screenshot
  await page.screenshot({ path: '/home/cutycat15/ClipAIv2/public-studio-after.png', fullPage: true });
  console.log('Studio full page screenshot saved to /home/cutycat15/ClipAIv2/public-studio-after.png');

  // Test interactive controls in Studio
  console.log('Testing Studio controls...');
  // Aspect Ratio buttons
  await page.click('.ar-btn[data-ar="1:1"]');
  const ar11Active = await page.$eval('.ar-btn[data-ar="1:1"]', el => el.classList.contains('active'));
  console.log('AR 1:1 active:', ar11Active);

  // Stepper
  await page.click('#btnPlus');
  const countPlus = await page.$eval('#clipCountDisplay', el => el.textContent);
  console.log('Clip count after plus:', countPlus);
  await page.click('#btnMinus');
  const countMinus = await page.$eval('#clipCountDisplay', el => el.textContent);
  console.log('Clip count after minus:', countMinus);

  // URL input preview
  await page.fill('#youtubeUrl', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await page.waitForTimeout(300);
  const previewVisible = await page.$eval('#urlPreviewBox', el => window.getComputedStyle(el).display !== 'none');
  console.log('URL preview box visible:', previewVisible);
  await page.screenshot({ path: '/home/cutycat15/ClipAIv2/public-url-preview.png' });

  // Toggle Transcript
  await page.click('#transcriptHeader');
  await page.waitForTimeout(200);
  const transcriptVisible = await page.$eval('#transcriptInputContainer', el => window.getComputedStyle(el).display !== 'none');
  console.log('Transcript drawer visible:', transcriptVisible);

  // 2. Switch to History view
  console.log('Switching to History tab...');
  await page.click('#tabHistoryBtn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/home/cutycat15/ClipAIv2/public-history-after.png', fullPage: true });
  console.log('History screenshot saved to /home/cutycat15/ClipAIv2/public-history-after.png');

  // 3. Test Opus Modal
  console.log('Opening Opus Clip modal...');
  const cardExists = await page.$('.opus-card');
  if (cardExists) {
    await page.click('.opus-card');
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/home/cutycat15/ClipAIv2/public-modal-after.png' });
    console.log('Opus modal screenshot saved to /home/cutycat15/ClipAIv2/public-modal-after.png');
    // Close modal
    await page.click('.opus-icon-btn[title="Close Modal"], .opus-icon-btn[title="Tutup Modal"]');
    await page.waitForTimeout(300);
  } else {
    console.log('No opus-card found in history');
  }

  // 4. Responsive sweep
  console.log('Testing responsive viewports (320px, 375px, 768px, 1280px)...');
  const viewports = [
    { name: 'mobile-320', width: 320, height: 600 },
    { name: 'mobile-375', width: 375, height: 667 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`Viewport ${vp.name} (${vp.width}px): Horizontal overflow = ${hasHorizontalOverflow}`);
    await page.screenshot({ path: `/home/cutycat15/ClipAIv2/public-responsive-${vp.name}.png` });
  }

  await browser.close();

  console.log('Console errors recorded:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.log('Errors:', consoleErrors);
  }
  console.log('--- PLAYWRIGHT AUDIT COMPLETE ---');
})();
