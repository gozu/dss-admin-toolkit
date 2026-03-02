/**
 * TAM debug script — monitors codenvclean webapp on tam-global.
 * Tracks: console.log (especially [codenvclean] timing), SSE stream requests,
 * table row count over time, and #loading visibility.
 *
 * Usage:  cd /data/projects/codenvclean && node tests/tam-debug.mjs
 */

import { chromium } from '@playwright/test';

const BASE_URL = 'https://tam-global.fe-aws.dkucloud-dev.com';
const WEBAPP_PATH = '/webapps/codenv/';
const FULL_URL = `${BASE_URL}${WEBAPP_PATH}`;
const WAIT_TIMEOUT = 180_000; // 180 seconds

const t0 = Date.now();
const ts = () => `[+${((Date.now() - t0) / 1000).toFixed(2)}s]`;

// Collected timeline events: { timeMs, type, detail }
const timeline = [];
function logEvent(type, detail) {
  const timeMs = Date.now() - t0;
  timeline.push({ timeMs, type, detail });
  console.log(`${ts()} [${type}] ${detail}`);
}

console.log(`${ts()} === tam-debug: codenvclean SSE + table monitor ===`);
console.log(`${ts()} Target: ${FULL_URL}`);
console.log(`${ts()} Timeout: ${WAIT_TIMEOUT / 1000}s`);
console.log();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

// ── Console message capture ──────────────────────────────────────────────────

const allConsoleMsgs = [];

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  const timeMs = Date.now() - t0;
  allConsoleMsgs.push({ type, text, timeMs });

  // Always log [codenvclean] messages prominently
  if (text.startsWith('[codenvclean]')) {
    logEvent('CODENVCLEAN', text);
  } else if (type === 'log') {
    // Log all console.log messages
    logEvent('CONSOLE.LOG', text.slice(0, 300));
  } else if (type === 'error') {
    logEvent('CONSOLE.ERR', text.slice(0, 300));
  } else if (type === 'warning') {
    logEvent('CONSOLE.WARN', text.slice(0, 200));
  }
});

page.on('pageerror', (err) => {
  logEvent('PAGE_ERROR', err.message.slice(0, 300));
});

// ── Network request tracking (focus on /api/code-envs/stream) ────────────────

const allRequests = [];
const allResponses = [];
const failedRequests = [];

let sseStreamResolve;
const sseStreamPromise = new Promise((resolve) => { sseStreamResolve = resolve; });
let sseStreamSeen = false;

page.on('request', (req) => {
  const url = req.url();
  const method = req.method();
  const startMs = Date.now() - t0;
  allRequests.push({ url, method, startMs });

  if (url.includes('/api/code-envs/stream')) {
    sseStreamSeen = true;
    logEvent('SSE_REQ', `${method} ${url}`);
  } else if (url.includes('/api/')) {
    logEvent('API_REQ', `${method} ${url}`);
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
    // streaming / aborted — expected for SSE
  }

  allResponses.push({ url, status, durationMs, size });

  if (url.includes('/api/code-envs/stream')) {
    logEvent('SSE_RESP', `status=${status} duration=${durationMs}ms size=${size > 0 ? (size / 1024).toFixed(1) + 'KB' : 'streaming/unknown'}`);
    sseStreamResolve({ status, durationMs, size });
  } else if (url.includes('/api/')) {
    logEvent('API_RESP', `${status} ${url.replace(BASE_URL, '')} (${durationMs}ms)`);
  }
});

page.on('requestfailed', (req) => {
  const url = req.url();
  const failure = req.failure()?.errorText || 'unknown';
  failedRequests.push({ url, error: failure });
  logEvent('REQ_FAIL', `${url} -- ${failure}`);
  if (url.includes('/api/code-envs/stream')) {
    sseStreamResolve({ status: 'FAILED', durationMs: -1, size: -1, error: failure });
  }
});

// ── Navigate ─────────────────────────────────────────────────────────────────

logEvent('NAV', `Navigating to ${FULL_URL}`);
const navStart = Date.now();

try {
  const navResponse = await page.goto(FULL_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  const navDuration = Date.now() - navStart;
  logEvent('NAV', `DOM content loaded — status ${navResponse?.status()}, took ${navDuration}ms`);
} catch (err) {
  logEvent('NAV_FAIL', err.message);
}

// ── Poll table row count (#env-tbody tr) over time ───────────────────────────

const rowSnapshots = []; // { timeMs, count }
let lastRowCount = -1;
let pollingStopped = false;

const rowPollInterval = setInterval(async () => {
  if (pollingStopped) return;
  try {
    const count = await page.$$eval('#env-tbody tr', (rows) => rows.length).catch(() => 0);
    const timeMs = Date.now() - t0;
    rowSnapshots.push({ timeMs, count });
    if (count !== lastRowCount) {
      logEvent('ROWS', `#env-tbody tr count changed: ${lastRowCount} -> ${count}`);
      lastRowCount = count;
    }
  } catch {
    // page might be navigating
  }
}, 1000); // poll every second

// ── Wait for #loading to become hidden (SSE stream completed) ────────────────

logEvent('WAIT', 'Waiting for #loading to become hidden (up to 180s)...');

let loadingHidden = false;
let loadingHiddenAt = -1;

try {
  await page.waitForSelector('#loading', { state: 'hidden', timeout: WAIT_TIMEOUT });
  loadingHidden = true;
  loadingHiddenAt = Date.now() - t0;
  logEvent('LOADING', `#loading is now hidden at +${(loadingHiddenAt / 1000).toFixed(2)}s`);
} catch (err) {
  logEvent('LOADING', `#loading did NOT become hidden within ${WAIT_TIMEOUT / 1000}s: ${err.message.slice(0, 150)}`);
}

// Give UI a moment to finalize rendering after loading hides
await page.waitForTimeout(2000);

// Stop row polling
pollingStopped = true;
clearInterval(rowPollInterval);

// Final row count
const finalRowCount = await page.$$eval('#env-tbody tr', (rows) => rows.length).catch(() => 0);
logEvent('ROWS', `Final #env-tbody tr count: ${finalRowCount}`);

// ── Check SSE stream result ──────────────────────────────────────────────────

const sseResult = await Promise.race([
  sseStreamPromise,
  new Promise((resolve) => setTimeout(() => resolve({ status: 'NOT_SEEN', durationMs: -1, size: -1 }), 2000)),
]);

// ── Screenshot ───────────────────────────────────────────────────────────────

const screenshotPath = '/data/projects/codenvclean/tests/tam-debug-screenshot.png';
await page.screenshot({ path: screenshotPath, fullPage: true });
logEvent('SCREENSHOT', `Saved to ${screenshotPath}`);

// ── Collect page text snippet ────────────────────────────────────────────────

const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 800)).catch(() => '');

// ── Print full summary ───────────────────────────────────────────────────────

const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log();
console.log('='.repeat(80));
console.log('  FULL TIMELINE');
console.log('='.repeat(80));
for (const evt of timeline) {
  const sec = (evt.timeMs / 1000).toFixed(2);
  console.log(`  +${sec.padStart(7)}s  [${evt.type.padEnd(14)}] ${evt.detail}`);
}

console.log();
console.log('='.repeat(80));
console.log('  TABLE ROW SNAPSHOTS (#env-tbody tr count over time)');
console.log('='.repeat(80));
if (rowSnapshots.length === 0) {
  console.log('  (no snapshots captured)');
} else {
  // Show only when count changed, plus first/last
  let prev = -1;
  for (const snap of rowSnapshots) {
    if (snap.count !== prev || snap === rowSnapshots[rowSnapshots.length - 1]) {
      console.log(`  +${(snap.timeMs / 1000).toFixed(2).padStart(7)}s  rows: ${snap.count}`);
      prev = snap.count;
    }
  }
}

console.log();
console.log('='.repeat(80));
console.log('  [codenvclean] CONSOLE MESSAGES (timing info)');
console.log('='.repeat(80));
const codenvMsgs = allConsoleMsgs.filter((m) => m.text.startsWith('[codenvclean]'));
if (codenvMsgs.length === 0) {
  console.log('  (none captured)');
} else {
  for (const m of codenvMsgs) {
    console.log(`  +${(m.timeMs / 1000).toFixed(2).padStart(7)}s  ${m.text}`);
  }
}

console.log();
console.log('='.repeat(80));
console.log('  ALL CONSOLE MESSAGES');
console.log('='.repeat(80));
for (const m of allConsoleMsgs) {
  console.log(`  +${(m.timeMs / 1000).toFixed(2).padStart(7)}s  [${m.type}] ${m.text.slice(0, 200)}`);
}

console.log();
console.log('='.repeat(80));
console.log('  NETWORK REQUESTS (sorted by start time)');
console.log('='.repeat(80));
for (const r of allRequests.sort((a, b) => a.startMs - b.startMs)) {
  const resp = allResponses.find((res) => res.url === r.url);
  const status = resp ? resp.status : '???';
  const dur = resp ? `${resp.durationMs}ms` : 'PENDING';
  const sizeStr = resp && resp.size > 0 ? `${(resp.size / 1024).toFixed(1)}KB` : '';
  const shortUrl = r.url.replace(BASE_URL, '');
  const isSSE = r.url.includes('/api/code-envs/stream') ? ' ** SSE **' : '';
  console.log(`  +${(r.startMs / 1000).toFixed(2).padStart(7)}s  ${r.method} ${status} ${shortUrl}  ${dur} ${sizeStr}${isSSE}`);
}

console.log();
console.log('='.repeat(80));
console.log('  SUMMARY');
console.log('='.repeat(80));
console.log(`  Total elapsed:              ${totalElapsed}s`);
console.log(`  #loading hidden:            ${loadingHidden ? `YES at +${(loadingHiddenAt / 1000).toFixed(2)}s` : 'NO (timed out)'}`);
console.log(`  SSE /code-envs/stream:      ${sseStreamSeen ? `status=${sseResult.status}, duration=${sseResult.durationMs}ms` : 'NOT SEEN'}`);
console.log(`  Final table rows:           ${finalRowCount}`);
console.log(`  Total network requests:     ${allRequests.length} (${failedRequests.length} failed)`);
console.log(`  Console messages:           ${allConsoleMsgs.length} total, ${codenvMsgs.length} [codenvclean]`);
console.log(`  Console errors:             ${allConsoleMsgs.filter((m) => m.type === 'error').length}`);
console.log(`  Screenshot:                 ${screenshotPath}`);
console.log('='.repeat(80));

console.log();
console.log('Page text preview:');
console.log(bodySnippet.slice(0, 500));

await browser.close();
console.log();
console.log(`${ts()} Done.`);
