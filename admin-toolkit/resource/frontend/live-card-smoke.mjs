import { chromium } from 'playwright';

function parseArg(name, fallback = '') {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const url = parseArg('url', 'https://akaos.fe-aws.dkucloud-dev.com/webapps/liveparser/');
const timeoutSec = Number(parseArg('timeout', '25'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const started = Date.now();
  let codeEnvsVisible = false;
  let footprintVisible = false;
  let failedLog = '';

  while ((Date.now() - started) / 1000 < timeoutSec) {
    codeEnvsVisible = await page.locator('#code-envs-table').first().isVisible().catch(() => false);
    footprintVisible = await page.locator('#project-footprint-table').first().isVisible().catch(() => false);

    const logs = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => line.includes('[api-loader]'));
    });
    failedLog = logs.find((line) => line.includes('Failed /api/project-footprint') || line.includes('Failed /api/code-envs')) || '';

    if (codeEnvsVisible && footprintVisible) break;
    if (failedLog) break;
    await page.waitForTimeout(1000);
  }

  const logs = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes('[api-loader]'))
      .slice(-60);
  });

  const elapsed = Math.round((Date.now() - started) / 1000);
  const summary = {
    url,
    timeoutSec,
    elapsedSec: elapsed,
    codeEnvsVisible,
    projectFootprintVisible: footprintVisible,
    hasLoaderFailure: Boolean(failedLog),
    failedLog,
    tailLogs: logs,
  };

  const screenshotPath = '/tmp/live-card-smoke.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ...summary, screenshotPath }, null, 2));

  if (!(codeEnvsVisible && footprintVisible)) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
