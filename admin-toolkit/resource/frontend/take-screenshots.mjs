import { chromium } from 'playwright';

const LIVE_URL = 'http://localhost:10000/webapps/liveparser/';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('aside', { timeout: 60000 });
  await page.waitForTimeout(1000);

  // Outreach
  await page.locator('aside button').filter({ hasText: 'Outreach' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fixed-outreach.png' });
  console.log('Saved /tmp/fixed-outreach.png');

  // Cleaner
  await page.locator('aside button').filter({ hasText: 'Cleaner' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fixed-cleaner.png' });
  console.log('Saved /tmp/fixed-cleaner.png');

  // Plugins
  await page.locator('aside button').filter({ hasText: 'Plugins' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fixed-plugins.png' });
  console.log('Saved /tmp/fixed-plugins.png');

  // Tracking
  await page.locator('aside button').filter({ hasText: 'Tracking' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fixed-tracking.png' });
  console.log('Saved /tmp/fixed-tracking.png');

  // Settings (reference)
  await page.locator('aside button').filter({ hasText: 'Settings' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fixed-settings.png' });
  console.log('Saved /tmp/fixed-settings.png');

  await browser.close();
  console.log('Done!');
}

run().catch(e => { console.error(e); process.exit(1); });
