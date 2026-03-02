import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const SCREENSHOTS_DIR = './screenshots';
const DEV_SERVER_URL = 'http://localhost:5173';

// Real diagnostic files for testing
const BEFORE_FILE = '/tmp/dku_diagnosis_2025-02-12-15-11-44.zip';  // 432MB, older
const AFTER_FILE = '/tmp/dku_diagnosis_2025-12-16-19-07-07.zip';   // 889MB, newer

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await setTimeout(1000);
  }
  return false;
}

async function main() {
  console.log('Starting dev server...');

  // Start Vite dev server
  const viteProcess = spawn('npm', ['run', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  viteProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[vite] ${msg}`);
  });

  viteProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[vite] ${msg}`);
  });

  // Wait for server to be ready
  console.log('Waiting for dev server...');
  const serverReady = await waitForServer(DEV_SERVER_URL);
  if (!serverReady) {
    console.error('Dev server failed to start');
    viteProcess.kill();
    process.exit(1);
  }
  console.log('Dev server ready!');

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    // Go to landing page and click Compare Two
    console.log('Navigating to comparison mode...');
    await page.goto(DEV_SERVER_URL);
    await page.waitForTimeout(1000);

    // Debug: take screenshot of landing page
    console.log('Taking landing page debug screenshot...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/00-debug-landing.png`,
      fullPage: true,
    });

    // Click the card that contains "Compare Two" text
    console.log('Looking for Compare Two button...');
    await page.getByText('Compare Two').click();
    await page.waitForTimeout(500);

    // Screenshot 1: Empty comparison upload
    console.log('Screenshot: empty comparison upload...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/01-comparison-empty.png`,
      fullPage: false,
    });

    // Upload Before file
    console.log('Uploading Before file (this may take a while for large files)...');
    const beforeInput = await page.locator('input[type="file"]').first();
    await beforeInput.setInputFiles(BEFORE_FILE);

    // Wait for processing (check for the file card to appear)
    console.log('Waiting for Before file to process...');
    await page.waitForSelector('text=dku_diagnosis_2025-02-12', { timeout: 30000 });
    await page.waitForTimeout(1000);

    // Screenshot 2: Before file uploaded
    console.log('Screenshot: Before file uploaded...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/02-comparison-before-uploaded.png`,
      fullPage: false,
    });

    // Upload After file - click on the After drop zone to trigger file dialog
    console.log('Uploading After file (this may take a while for large files)...');
    // The After zone still has its hidden input - find it by looking for the remaining input
    const afterInput = await page.locator('input[type="file"]').last();
    await afterInput.setInputFiles(AFTER_FILE);

    // Wait for processing
    console.log('Waiting for After file to process...');
    await page.waitForSelector('text=dku_diagnosis_2025-12-16', { timeout: 30000 });
    await page.waitForTimeout(1000);

    // Screenshot 3: Both files uploaded
    console.log('Screenshot: Both files uploaded...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/03-comparison-both-uploaded.png`,
      fullPage: false,
    });

    // Click Compare button
    console.log('Clicking Compare button...');
    await page.click('button:has-text("Compare Files")');
    await page.waitForTimeout(1000);

    // Screenshot 4: Comparison results
    console.log('Screenshot: Comparison results...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/04-comparison-results.png`,
      fullPage: false,
    });

    // Scroll down if there's more content
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(300);

    // Screenshot 5: Comparison results scrolled
    console.log('Screenshot: Comparison results scrolled...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/05-comparison-results-scrolled.png`,
      fullPage: false,
    });

    // Scroll to Configuration Comparison section
    await page.evaluate(() => window.scrollTo(0, 1800));
    await page.waitForTimeout(300);

    // Screenshot 6: Configuration Comparison
    console.log('Screenshot: Configuration comparison...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/06-configuration-comparison.png`,
      fullPage: false,
    });

    // Scroll to see more settings tables including Auth, Proxy, Max Running
    await page.evaluate(() => window.scrollTo(0, 2600));
    await page.waitForTimeout(300);

    // Screenshot 7: More settings (Auth, Proxy, Max Running Activities)
    console.log('Screenshot: More settings...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/07-more-settings.png`,
      fullPage: false,
    });

    // Scroll to see Proxy and Max Running Activities specifically
    await page.evaluate(() => window.scrollTo(0, 3100));
    await page.waitForTimeout(300);

    // Screenshot 7b: Proxy and Max Running
    console.log('Screenshot: Proxy and Max Running...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/07b-proxy-maxrunning.png`,
      fullPage: false,
    });

    // Click "Show X unchanged" on Authentication Settings if visible
    try {
      await page.click('text=Show 5 unchanged');
      await page.waitForTimeout(300);
      console.log('Screenshot: Auth Settings expanded...');
      await page.screenshot({
        path: `${SCREENSHOTS_DIR}/07c-auth-expanded.png`,
        fullPage: false,
      });
    } catch {
      console.log('Could not find "Show 5 unchanged" button');
    }

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    // Screenshot 8: Bottom of page
    console.log('Screenshot: Bottom of page...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/08-bottom-of-page.png`,
      fullPage: false,
    });

    // Screenshot 9: Full page
    console.log('Screenshot: Full page...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/09-full-page.png`,
      fullPage: true,
    });

    console.log('All screenshots taken successfully!');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}/`);

  } catch (error) {
    console.error('Error taking screenshots:', error);
    // Take error screenshot
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/error-state.png`,
      fullPage: true,
    });
  } finally {
    await browser.close();
    viteProcess.kill();
  }
}

main().catch(console.error);
