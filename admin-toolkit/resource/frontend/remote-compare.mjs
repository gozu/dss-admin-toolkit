import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const LEGACY_URL = 'https://tam-global.fe-aws.dkucloud-dev.com/webapps/diagparser3/';
const LIVE_URL = 'https://akaos.fe-aws.dkucloud-dev.com/webapps/liveparser/';
const DIAG_ZIP = '/data/projects/dku_diagnosis_2026-02-05-20-15-02.zip';
const args = process.argv.slice(2);
const labelArg = args.find((arg) => arg.startsWith('--label='));
const LABEL = labelArg ? labelArg.split('=')[1] : 'before';

const OUT_DIR = path.resolve('./screenshots/remote-compare');
const BASELINE_DIR = path.join(OUT_DIR, 'baseline');
const CURRENT_DIR = path.join(OUT_DIR, 'current');
const REPORT_DIR = path.join(OUT_DIR, 'reports');

const BASELINE_IMG = path.join(BASELINE_DIR, 'legacy-baseline-full.png');
const BASELINE_TOP_IMG = path.join(BASELINE_DIR, 'legacy-baseline-top.png');
const BASELINE_SUMMARY = path.join(BASELINE_DIR, 'legacy-baseline-summary.json');
const LIVE_IMG = path.join(CURRENT_DIR, `live-${LABEL}-full.png`);
const LIVE_TOP_IMG = path.join(CURRENT_DIR, `live-${LABEL}-top.png`);
const LIVE_SUMMARY = path.join(CURRENT_DIR, `live-${LABEL}-summary.json`);
const COMPARE_REPORT = path.join(REPORT_DIR, `compare-${LABEL}.json`);

function ensureDirs() {
  [OUT_DIR, BASELINE_DIR, CURRENT_DIR, REPORT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function maybeClickSingleAnalysis(page) {
  const button = page.getByText('Single Analysis', { exact: false }).first();
  const visible = await button.isVisible().catch(() => false);
  if (visible) {
    await button.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function maybeUploadDiag(page) {
  const input = page.locator('input[type="file"]').first();
  const count = await input.count();
  if (count === 0) return false;

  await input.setInputFiles(DIAG_ZIP);

  // Wait for processing state to appear/disappear where applicable.
  await page.waitForTimeout(1000);
  for (let i = 0; i < 60; i++) {
    const processing = await page.getByText('Processing diagnostic file...', { exact: false }).first().isVisible().catch(() => false);
    if (!processing) break;
    await page.waitForTimeout(1000);
  }

  // Wait for at least one core section to render.
  const selectors = [
    '#projects-table',
    '#clusters-table',
    '#filesystem-table',
    '.glass-card',
    '.bg-[var(--bg-surface)]',
  ];

  for (const selector of selectors) {
    const ok = await page.locator(selector).first().isVisible().catch(() => false);
    if (ok) break;
  }

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  return true;
}

async function collectSummary(page, url) {
  return page.evaluate(async (u) => {
    const sectionIds = [
      'projects-table',
      'clusters-table',
      'log-errors-section',
      'filesystem-table',
      'userStats-table',
      'systemLimits-table',
      'licenseProperties-table',
    ];

    const foundSections = {};
    for (const id of sectionIds) {
      foundSections[id] = !!document.getElementById(id);
    }

    const text = document.body?.innerText || '';
    const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
    const scriptSrcs = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src') || '');
    const cssHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href') || '');

    const debugVisible = lines.some((line) => line.includes('Show Debug') || line.includes('Hide Debug'));
    const hasApiModeSignal = lines.some((line) => line.includes('Save Snapshot') || line.includes('Compare Snapshots'));

    async function checkEndpoint(ep) {
      const resolveUrl = (window.dataiku && window.dataiku.getWebAppBackendUrl)
        ? window.dataiku.getWebAppBackendUrl(ep)
        : ep;
      try {
        const resp = await fetch(resolveUrl, { credentials: 'same-origin' });
        const text = await resp.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const base = {
          ok: resp.ok,
          status: resp.status,
          textSize: text.length,
          textHead: text.slice(0, 400),
        };
        if (!parsed || typeof parsed !== 'object') {
          return { ...base, kind: 'text' };
        }
        if (ep === '/api/clusters') {
          return { ...base, kind: 'json', clusters: Array.isArray(parsed.clusters) ? parsed.clusters.length : 0 };
        }
        if (ep === '/api/license') {
          const props = parsed.licenseProperties || {};
          return { ...base, kind: 'json', licenseProperties: Object.keys(props).length };
        }
        if (ep === '/api/logs/errors') {
          const stats = parsed.logStats || {};
          return { ...base, kind: 'json', displayedErrors: stats['Displayed Errors'] || 0, uniqueErrors: stats['Unique Errors'] || 0 };
        }
        if (ep.startsWith('/api/dir-tree')) {
          const root = parsed.root || parsed.node || null;
          return { ...base, kind: 'json', hasRoot: !!root, rootPath: parsed.rootPath || (root && root.path) || null };
        }
        return { ...base, kind: 'json', keys: Object.keys(parsed).slice(0, 10) };
      } catch (e) {
        return { ok: false, status: null, error: String(e) };
      }
    }

    const apiChecks = {
      ping: await checkEndpoint('/__ping'),
      mode: await checkEndpoint('/api/mode'),
      license: await checkEndpoint('/api/license'),
      clusters: await checkEndpoint('/api/clusters'),
      logErrors: await checkEndpoint('/api/logs/errors'),
      dirTree: await checkEndpoint('/api/dir-tree?maxDepth=2'),
    };

    return {
      url: u,
      title: document.title,
      timestamp: new Date().toISOString(),
      foundSections,
      lineSample: lines.slice(0, 120),
      flags: {
        hasDebugPanel: debugVisible,
        hasApiModeSignal,
      },
      assets: {
        scripts: scriptSrcs.slice(0, 10),
        stylesheets: cssHrefs.slice(0, 10),
      },
      apiChecks,
      counts: {
        cards: document.querySelectorAll('.glass-card').length,
        tables: document.querySelectorAll('table').length,
        buttons: document.querySelectorAll('button').length,
      },
    };
  }, url);
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function compareSummaries(legacy, live) {
  const keys = Object.keys(legacy.foundSections);
  const sectionDiff = keys.map((k) => ({
    section: k,
    legacy: !!legacy.foundSections[k],
    live: !!live.foundSections[k],
    match: !!legacy.foundSections[k] === !!live.foundSections[k],
  }));

  return {
    generatedAt: new Date().toISOString(),
    legacyTitle: legacy.title,
    liveTitle: live.title,
    sectionDiff,
    legacyCounts: legacy.counts,
    liveCounts: live.counts,
    legacyFlags: legacy.flags,
    liveFlags: live.flags,
  };
}

async function captureApp(page, url, fullPath, topPath, summaryPath) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);

  await maybeClickSingleAnalysis(page);
  await maybeUploadDiag(page);

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.screenshot({ path: fullPath, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: topPath, fullPage: false });

  const summary = await collectSummary(page, url);
  writeJson(summaryPath, summary);
  return summary;
}

async function main() {
  ensureDirs();

  if (!fileExists(DIAG_ZIP)) {
    throw new Error(`Missing diagnostic ZIP: ${DIAG_ZIP}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    let legacySummary;

    if (fileExists(BASELINE_IMG) && fileExists(BASELINE_SUMMARY)) {
      legacySummary = JSON.parse(fs.readFileSync(BASELINE_SUMMARY, 'utf-8'));
      console.log('Using existing read-only baseline');
    } else {
      console.log('Capturing legacy baseline');
      legacySummary = await captureApp(page, LEGACY_URL, BASELINE_IMG, BASELINE_TOP_IMG, BASELINE_SUMMARY);
      fs.chmodSync(BASELINE_IMG, 0o444);
      fs.chmodSync(BASELINE_TOP_IMG, 0o444);
      fs.chmodSync(BASELINE_SUMMARY, 0o444);
      console.log('Baseline captured and locked read-only');
    }

    console.log(`Capturing live screenshot (${LABEL})`);
    const liveSummary = await captureApp(page, LIVE_URL, LIVE_IMG, LIVE_TOP_IMG, LIVE_SUMMARY);

    const report = compareSummaries(legacySummary, liveSummary);
    writeJson(COMPARE_REPORT, report);

    console.log('Comparison report written:', COMPARE_REPORT);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
