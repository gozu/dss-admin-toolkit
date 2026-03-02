/**
 * Standalone Playwright script to debug codenvclean webapp performance.
 * Tracks network requests, console messages, and page load timing.
 *
 * Usage:  cd /data/projects/codenvclean && node tests/perf-debug.mjs
 */

import { chromium } from '@playwright/test';

const BASE_URL = 'https://tam-global.fe-aws.dkucloud-dev.com';
const WEBAPP_PATH = '/webapps/codenv/';
const FULL_URL = `${BASE_URL}${WEBAPP_PATH}`;
const WAIT_TIMEOUT = 120_000;

const t0 = Date.now();
const ts = () => `[+${((Date.now() - t0) / 1000).toFixed(2)}s]`;

console.log(`${ts()} === codenvclean perf-debug ===`);
console.log(`${ts()} Target: ${FULL_URL}`);
console.log(`${ts()} Wait timeout: ${WAIT_TIMEOUT / 1000}s`);
console.log();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

// -- Track network requests ---------------------------------------------------

const allRequests = [];      // { url, method, startMs }
const allResponses = [];     // { url, status, durationMs, size }
const failedRequests = [];

// Promise that resolves when /api/code-envs responds
let codeEnvsResolve;
const codeEnvsPromise = new Promise((resolve) => { codeEnvsResolve = resolve; });
let codeEnvsRequested = false;

page.on('request', (req) => {
  const url = req.url();
  const method = req.method();
  const startMs = Date.now() - t0;
  allRequests.push({ url, method, startMs });

  if (url.includes('/api/') || url.includes('/code-envs')) {
    console.log(`${ts()} >> REQUEST  ${method} ${url}`);
    if (url.includes('/code-envs')) {
      codeEnvsRequested = true;
    }
  }
});

page.on('response', async (res) => {
  const url = res.url();
  const status = res.status();
  const matchingReq = allRequests.find((r) => r.url === url);
  const durationMs = matchingReq ? Date.now() - t0 - matchingReq.startMs : -1;

  let size = -1;
  try {
    const body = await res.body();
    size = body.length;
  } catch {
    // streaming or aborted
  }

  allResponses.push({ url, status, durationMs, size });

  const isApi = url.includes('/api/') || url.includes('/code-envs');
  if (isApi) {
    console.log(
      `${ts()} << RESPONSE ${status} ${url}  (${durationMs}ms, ${size > 0 ? (size / 1024).toFixed(1) + 'KB' : '?'})`
    );
  }
  if (url.includes('/code-envs')) {
    codeEnvsResolve({ status, durationMs, size });
  }
});

page.on('requestfailed', (req) => {
  const url = req.url();
  const failure = req.failure()?.errorText || 'unknown';
  failedRequests.push({ url, error: failure });
  console.log(`${ts()} !! FAILED  ${url}  -- ${failure}`);
  if (url.includes('/code-envs')) {
    codeEnvsResolve({ status: 'FAILED', durationMs: -1, size: -1, error: failure });
  }
});

// -- Track console messages ---------------------------------------------------

const consoleMsgs = [];

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  consoleMsgs.push({ type, text, timeMs: Date.now() - t0 });
  if (type === 'error' || type === 'warning') {
    console.log(`${ts()} CONSOLE.${type.toUpperCase()}: ${text.slice(0, 200)}`);
  }
});

page.on('pageerror', (err) => {
  console.log(`${ts()} PAGE ERROR: ${err.message.slice(0, 300)}`);
});

// -- Navigate -----------------------------------------------------------------

console.log(`${ts()} Navigating to ${FULL_URL} ...`);
const navStart = Date.now();

try {
  const navResponse = await page.goto(FULL_URL, {
    waitUntil: 'domcontentloaded',
    timeout: WAIT_TIMEOUT,
  });
  const navDuration = Date.now() - navStart;
  console.log(
    `${ts()} Navigation complete -- status ${navResponse?.status()}, took ${navDuration}ms`
  );
} catch (err) {
  console.log(`${ts()} Navigation FAILED: ${err.message}`);
}

// -- Wait for meaningful content (DOM selector) -------------------------------

console.log(`${ts()} Waiting for table / error / empty state...`);

const selectors = [
  { name: 'table', sel: 'table, [role="table"], [class*="table"]' },
  { name: 'error', sel: '[class*="error"], [class*="Error"], [role="alert"], .alert-danger' },
  { name: 'empty', sel: '[class*="empty"], [class*="Empty"], [class*="no-data"]' },
  { name: 'main-content', sel: 'main, #app > div > div, [class*="content"]' },
];

let outcome = 'timeout';
const waitStart = Date.now();

try {
  const result = await Promise.race([
    ...selectors.map(async ({ name, sel }) => {
      try {
        await page.waitForSelector(sel, { timeout: WAIT_TIMEOUT, state: 'attached' });
        return name;
      } catch {
        return null;
      }
    }),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), WAIT_TIMEOUT)),
  ]);
  outcome = result || 'timeout';
} catch {
  outcome = 'error';
}

const waitDuration = Date.now() - waitStart;
console.log(`${ts()} DOM outcome: "${outcome}" after ${waitDuration}ms`);

// -- Wait for /api/code-envs to complete (the key API call) -------------------

console.log(`${ts()} Waiting for /api/code-envs response (up to 120s)...`);

const codeEnvsResult = await Promise.race([
  codeEnvsPromise,
  new Promise((resolve) => setTimeout(() => resolve({ status: 'TIMED_OUT', durationMs: WAIT_TIMEOUT }), WAIT_TIMEOUT)),
]);

console.log(`${ts()} /api/code-envs result: status=${codeEnvsResult.status}, duration=${codeEnvsResult.durationMs}ms, size=${codeEnvsResult.size > 0 ? (codeEnvsResult.size / 1024).toFixed(1) + 'KB' : '?'}`);

// Wait a moment for the UI to update with the API data
await page.waitForTimeout(3000);

// -- Check page state after API completes -------------------------------------

const rowCount = await page.$$eval('table tr, [role="row"]', (rows) => rows.length).catch(() => 0);
const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1000)).catch(() => '');
console.log(`${ts()} Table rows found: ${rowCount}`);
console.log(`${ts()} Page text preview:`);
console.log(bodyText.slice(0, 500));

// -- Summary ------------------------------------------------------------------

console.log();
console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`Total elapsed:           ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`DOM outcome:             ${outcome}`);
console.log(`/api/code-envs status:   ${codeEnvsResult.status}`);
console.log(`/api/code-envs duration: ${codeEnvsResult.durationMs}ms`);
console.log(`/api/code-envs size:     ${codeEnvsResult.size > 0 ? (codeEnvsResult.size / 1024).toFixed(1) + 'KB' : '?'}`);
console.log(`Total requests:          ${allRequests.length} (${failedRequests.length} failed)`);
console.log(`Console messages:        ${consoleMsgs.length} (${consoleMsgs.filter((m) => m.type === 'error').length} errors)`);
console.log(`Table rows after load:   ${rowCount}`);
console.log();

// API requests detail
const apiResponses = allResponses.filter(
  (r) => r.url.includes('/api/') || r.url.includes('/code-envs')
);
if (apiResponses.length > 0) {
  console.log('-- API Requests --');
  for (const r of apiResponses) {
    console.log(
      `  ${r.status} ${r.url.replace(BASE_URL, '')}  ${r.durationMs}ms  ${r.size > 0 ? (r.size / 1024).toFixed(1) + 'KB' : '?'}`
    );
  }
  console.log();
}

if (failedRequests.length > 0) {
  console.log('-- Failed Requests --');
  for (const r of failedRequests) {
    console.log(`  ${r.url}  -- ${r.error}`);
  }
  console.log();
}

const consoleErrors = consoleMsgs.filter((m) => m.type === 'error');
if (consoleErrors.length > 0) {
  console.log('-- Console Errors --');
  for (const m of consoleErrors) {
    console.log(`  [+${(m.timeMs / 1000).toFixed(2)}s] ${m.text.slice(0, 300)}`);
  }
  console.log();
}

console.log('-- All Requests (by start time) --');
for (const r of allRequests.sort((a, b) => a.startMs - b.startMs)) {
  const resp = allResponses.find((res) => res.url === r.url);
  const status = resp ? resp.status : '???';
  const dur = resp ? `${resp.durationMs}ms` : 'STILL PENDING';
  const shortUrl = r.url.replace(BASE_URL, '');
  console.log(`  [+${(r.startMs / 1000).toFixed(2)}s] ${r.method} ${status} ${shortUrl}  ${dur}`);
}

const screenshotPath = '/data/projects/codenvclean/tests/perf-debug-screenshot.png';
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log();
console.log(`Screenshot saved to ${screenshotPath}`);

await browser.close();
console.log(`${ts()} Done.`);
