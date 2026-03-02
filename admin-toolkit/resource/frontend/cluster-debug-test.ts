import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import * as fs from 'fs';

const SCREENSHOTS_DIR = './screenshots';
const DEV_SERVER_URL = 'http://localhost:5173';

// Test file path (can be overridden via command line arg)
const TEST_FILE = process.argv[2] || '/data/projects/dku_diagnosis_2025-02-12-15-11-44.zip';

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
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log(`Testing with file: ${TEST_FILE}`);
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

  // Capture console messages
  const consoleLogs: string[] = [];
  page.on('console', async (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    if (msg.text().includes('[ClustersParser]') || msg.text().includes('[ClustersTable]')) {
      console.log('BROWSER CONSOLE:', text);
      // Try to get the actual cluster objects
      if (msg.text().includes('[ClustersTable]')) {
        const args = msg.args();
        if (args.length > 1) {
          try {
            const clusters = await args[1].jsonValue();
            console.log('CLUSTER DATA:', JSON.stringify(clusters, null, 2));
          } catch (e) {
            // ignore
          }
        }
      }
    }
  });

  try {
    // Go to landing page
    console.log('Navigating to single file view...');
    await page.goto(DEV_SERVER_URL);
    await page.waitForTimeout(1000);

    // Click Single Analysis
    console.log('Clicking Single Analysis...');
    await page.getByText('Single Analysis').click();
    await page.waitForTimeout(500);

    // Upload test file
    console.log('Uploading test file...');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_FILE);

    // Wait for processing
    console.log('Waiting for file to process...');
    await page.waitForSelector('.bg-\\[var\\(--bg-surface\\)\\]', { timeout: 60000 });
    await page.waitForTimeout(2000);

    // Take screenshot of full page
    console.log('Taking full page screenshot...');
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/cluster-debug-full.png`,
      fullPage: true,
    });

    // Scroll to clusters section if it exists
    const clustersSection = await page.$('#clusters-table');
    if (clustersSection) {
      console.log('Found clusters section, scrolling to it...');
      await clustersSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Screenshot of clusters section
      await page.screenshot({
        path: `${SCREENSHOTS_DIR}/cluster-debug-clusters.png`,
        fullPage: false,
      });
    } else {
      console.log('No clusters section found (might be expected if no cluster data)');
    }

    // Print all cluster-related console logs
    console.log('\n--- Cluster-related console logs ---');
    consoleLogs
      .filter((log) => log.includes('Cluster'))
      .forEach((log) => console.log(log));
    console.log('-----------------------------------\n');

    // Save all console logs to a file
    fs.writeFileSync(
      `${SCREENSHOTS_DIR}/cluster-debug-console.log`,
      consoleLogs.join('\n')
    );

    console.log('Debug test complete!');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}/`);

  } catch (error) {
    console.error('Error during debug test:', error);
    // Take error screenshot
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/cluster-debug-error.png`,
      fullPage: true,
    });
  } finally {
    await browser.close();
    viteProcess.kill();
  }
}

main().catch(console.error);
