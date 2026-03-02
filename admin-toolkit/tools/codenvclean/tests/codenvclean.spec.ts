import { test, expect } from '@playwright/test';

const WEBAPP_URL = '/webapps/codenv/';

/** Click the Scan button to start loading */
async function startScan(page: import('@playwright/test').Page) {
  await expect(page.locator('#scan-settings')).toBeVisible({ timeout: 15_000 });
  await page.locator('#scan-settings button:has-text("Scan")').click();
}

/** Wait for scan to fully complete */
async function waitForScanComplete(page: import('@playwright/test').Page) {
  await startScan(page);
  await expect(page.locator('#loading')).toBeHidden({ timeout: 120_000 });
}

test.describe('Code Env Cleaner', () => {
  test('page loads and shows header and scan settings', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await expect(page.locator('h1')).toContainText('Code Env Cleaner', { timeout: 15_000 });
    await expect(page.locator('#scan-settings')).toBeVisible();
    await expect(page.locator('#thread-count')).toBeVisible();
  });

  test('thread selector has correct options', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await expect(page.locator('#scan-settings')).toBeVisible({ timeout: 15_000 });

    const options = await page.locator('#thread-count option').allTextContents();
    expect(options).toEqual(['1 (sequential)', '4', '8', '12', '16', '20']);

    // Default should be 4
    const selected = await page.locator('#thread-count').inputValue();
    expect(selected).toBe('4');
  });

  test('clicking Scan shows loading indicator', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await startScan(page);

    await expect(page.locator('#loading')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.spinner')).toBeVisible();
    await expect(page.locator('#scan-settings')).toBeHidden();
  });

  test('progress bar updates during SSE loading', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await startScan(page);
    await expect(page.locator('#loading')).toBeVisible({ timeout: 5_000 });

    // Wait for progress text to show count format
    await expect(page.locator('#loading-text')).toContainText(/Checking/, { timeout: 30_000 });

    // Progress bar should have non-zero width
    const width = await page.locator('.progress-bar').evaluate(el => (el as HTMLElement).style.width);
    expect(width).not.toBe('0%');
  });

  test('table loads with code environments via SSE', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    if (errors.length > 0) {
      console.log('Console errors:', errors);
    }

    const rows = page.locator('#env-tbody tr');
    await expect(rows).not.toHaveCount(0);
  });

  test('stats bar shows correct counts', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    const total = await page.locator('#stat-total').textContent();
    expect(Number(total)).toBeGreaterThan(0);
  });

  test('unused envs have Delete button, used envs show In use', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    const deleteButtons = page.locator('#env-tbody button:has-text("Delete")');
    await expect(deleteButtons.first()).toBeVisible();

    const inUseLabels = page.locator('#env-tbody :text("In use")');
    await expect(inUseLabels.first()).toBeVisible();
  });

  test('env name links to DSS admin design page', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    const firstLink = page.locator('#env-tbody a').first();
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/\/admin\/code-envs\/design\/python\//);
    expect(await firstLink.getAttribute('target')).toBe('_blank');
  });

  test('clicking Delete opens confirmation modal', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    await page.locator('#env-tbody button:has-text("Delete")').first().click();

    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('#modal-env-name')).not.toBeEmpty();
  });

  test('modal delete button is disabled until correct text is typed', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    await page.locator('#env-tbody button:has-text("Delete")').first().click();
    await expect(page.locator('#modal-overlay')).toBeVisible();

    await expect(page.locator('#modal-delete-btn')).toBeDisabled();

    await page.locator('#modal-input').fill('wrong text');
    await expect(page.locator('#modal-delete-btn')).toBeDisabled();

    const envName = await page.locator('#modal-env-name').textContent();
    await page.locator('#modal-input').fill('delete ' + envName);
    await expect(page.locator('#modal-delete-btn')).toBeEnabled();
  });

  test('modal closes on Cancel click', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    await page.locator('#env-tbody button:has-text("Delete")').first().click();
    await expect(page.locator('#modal-overlay')).toBeVisible();

    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('modal closes on Escape key', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    await page.locator('#env-tbody button:has-text("Delete")').first().click();
    await expect(page.locator('#modal-overlay')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('refresh button triggers new scan', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    await page.locator('#refresh-btn').click();
    await expect(page.locator('#loading')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 120_000 });
  });

  test('language column shows Python version instead of PYTHON', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    // At least one Python env should show "Python X.Y" format
    const langCells = page.locator('#env-tbody td:nth-child(2)');
    const count = await langCells.count();
    let foundPythonVersion = false;
    for (let i = 0; i < count; i++) {
      const text = await langCells.nth(i).textContent();
      if (text && /Python \d+\.\d+/.test(text)) {
        foundPythonVersion = true;
        break;
      }
    }
    expect(foundPythonVersion).toBe(true);
  });

  test('usage badge has tooltip with usage details', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    // Find a green usage badge (non-zero usages)
    const usageBadge = page.locator('#env-tbody .bg-green-50[title]').first();
    const exists = await usageBadge.count();
    if (exists > 0) {
      const title = await usageBadge.getAttribute('title');
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(0);
    }
  });

  test('clicking usage badge opens detail view', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    // Find and click a green usage badge
    const usageBadge = page.locator('#env-tbody .bg-green-50.cursor-pointer').first();
    const exists = await usageBadge.count();
    if (exists === 0) {
      test.skip();
      return;
    }

    await usageBadge.click();

    // Detail view should be visible, table should be hidden
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('#table-wrap')).toBeHidden();
    await expect(page.locator('#detail-env-name')).not.toBeEmpty();

    // Should have usage rows in detail table
    const detailRows = page.locator('#detail-tbody tr');
    await expect(detailRows).not.toHaveCount(0);
  });

  test('detail view Back button returns to table', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    const usageBadge = page.locator('#env-tbody .bg-green-50.cursor-pointer').first();
    const exists = await usageBadge.count();
    if (exists === 0) {
      test.skip();
      return;
    }

    await usageBadge.click();
    await expect(page.locator('#detail-view')).toBeVisible();

    // Click Back
    await page.locator('#detail-view button:has-text("Back")').click();
    await expect(page.locator('#detail-view')).toBeHidden();
    await expect(page.locator('#table-wrap')).toBeVisible();
  });

  test('clicking Name header sorts table alphabetically', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    // Click Name header to sort ascending
    await page.locator('th:has-text("Name")').click();
    await expect(page.locator('#sort-name')).toContainText('\u25B2');

    // Get all env names and verify they are sorted
    const names = await page.locator('#env-tbody tr').evaluateAll(rows =>
      rows.map(r => r.getAttribute('data-sortname') || '')
    );
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);

    // Click again to reverse sort
    await page.locator('th:has-text("Name")').click();
    await expect(page.locator('#sort-name')).toContainText('\u25BC');

    const namesDesc = await page.locator('#env-tbody tr').evaluateAll(rows =>
      rows.map(r => r.getAttribute('data-sortname') || '')
    );
    const sortedDesc = [...namesDesc].sort().reverse();
    expect(namesDesc).toEqual(sortedDesc);
  });

  test('clicking Usages header sorts by usage count', async ({ page }) => {
    await page.goto(WEBAPP_URL);
    await waitForScanComplete(page);

    // Click Usages header
    await page.locator('th:has-text("Usages")').click();
    await expect(page.locator('#sort-usages')).toContainText('\u25B2');

    // Verify rows are sorted by usage count ascending
    const counts = await page.locator('#env-tbody tr').evaluateAll(rows =>
      rows.map(r => {
        const badge = r.querySelector('td:nth-child(5)');
        const text = badge?.textContent || '';
        if (text.includes('Unused')) return 0;
        const m = text.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });
});
