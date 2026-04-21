# Diag Compare Visualization Improvement Plan

## Overview

This plan proposes visualization improvements for the diagnostic comparison feature in the Diag Parser webapp. The current implementation is functional but can be enhanced for better user comprehension of changes between diagnostic files.

## Current State Analysis

### Existing Comparison Components
- `ComparisonResultsView.tsx` - Main orchestrator with summary stats
- `ComparisonHealthSection.tsx` - Circular gauges + category bars + issue list
- `ComparisonSystemSection.tsx` - Grid of system field cards
- `ComparisonChartsSection.tsx` - Memory, filesystem, connections comparison charts
- `ComparisonSettingsSection.tsx` - Collapsible setting tables
- `ComparisonCollectionsSection.tsx` - Users, projects, clusters cards
- `DeltaBadge.tsx` - Change type badges (Added/Removed/Modified)

### Current Visualization Patterns
- Side-by-side circular gauges for health scores
- Dual progress bars (before/after) for categories
- Table rows with before → after values
- Collapsible sections with change counts

## Proposed Improvements

### 1. Change Impact Summary Dashboard (High Priority)

**Problem**: The current summary is just numbers. Users need an at-a-glance view of what matters most.

**Solution**: Add a visual summary dashboard showing:
- **Proportional bar**: Horizontal stacked bar (improvements | neutral | regressions)
- **Top 5 Critical Changes**: Clickable cards that jump to relevant sections
- **Quick-jump icons**: Navigate to sections with changes

**New Component**: `ComparisonSummaryDashboard.tsx`

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonResultsView.tsx`
- Create: `resource/frontend/src/components/comparison/ComparisonSummaryDashboard.tsx`

---

### 2. Butterfly/Tornado Chart for Health Categories (Medium Priority)

**Problem**: Side-by-side category bars don't clearly show magnitude of change.

**Solution**: Replace with butterfly chart where:
- Categories listed vertically in center
- Before bars extend left, After bars extend right
- Delta badges at row ends
- Visual emphasis on largest deltas

```
         Before    |    After
    Memory ======|======== Memory (+15)
    Config    ===|=== Config (-5)
      Auth   ====|==== Auth (0)
```

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonHealthSection.tsx`
- Create: `resource/frontend/src/components/comparison/HealthButterflyChart.tsx`

---

### 3. Unified Diff View for Settings (Medium Priority)

**Problem**: Settings tables show all rows equally. Changed settings get lost in noise.

**Solution**: GitHub-style unified diff view with:
- Line highlighting (green: added, red: removed, amber: modified)
- Context collapse (show N lines around changes)
- Filter toggle: "All" | "Changes only" | "Critical only"
- Syntax highlighting for JSON/boolean values

**New Component**: `InlineDiffView.tsx`

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonSettingsSection.tsx`
- Create: `resource/frontend/src/components/comparison/InlineDiffView.tsx`

---

### 4. Settings Category Heat Map (Medium Priority)

**Problem**: Many settings categories, hard to see which have the most changes.

**Solution**: Mini heat map grid at the top of settings section:
- Tiles for each category
- Color intensity = number of changes
- Border color = most severe change type
- Click to expand/scroll to that category

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonSettingsSection.tsx`
- Create: `resource/frontend/src/components/comparison/SettingsHeatMap.tsx`

---

### 5. Floating Change Navigator (Low Priority)

**Problem**: Users must scroll through all sections to find relevant changes.

**Solution**: Sticky sidebar with:
- Section icons with badge counts
- Active section highlighting
- Click to smooth-scroll
- Collapses on mobile

**New Component**: `ChangeNavigator.tsx`

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonResultsView.tsx`
- Create: `resource/frontend/src/components/comparison/ChangeNavigator.tsx`

---

### 6. Enhanced Resource Charts with Sparklines (Low Priority)

**Problem**: Current charts are good but lack context for small percentage changes.

**Solution**: Add mini sparklines showing:
- Trend direction indicator
- Threshold lines more prominent
- Numeric delta with arrow indicators

**Files to modify**:
- `resource/frontend/src/components/comparison/ComparisonChartsSection.tsx`
- Create: `resource/frontend/src/components/comparison/Sparkline.tsx`

---

## Implementation Order

### Phase 1: Core Visual Improvements
1. Create `ComparisonSummaryDashboard.tsx` - Summary with proportional bar and top changes
2. Create `HealthButterflyChart.tsx` - Alternative health visualization
3. Add view mode toggle to `ComparisonResultsView.tsx`

### Phase 2: Settings Enhancements
4. Create `SettingsHeatMap.tsx` - Category overview
5. Create `InlineDiffView.tsx` - Unified diff style for settings

### Phase 3: Navigation & Polish
6. Create `ChangeNavigator.tsx` - Floating sidebar
7. Enhance `ComparisonChartsSection.tsx` with sparklines

---

## Playwright Screenshot Setup

To capture current state before changes:

**Create**: `resource/frontend/playwright.config.ts`
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

**Create**: `resource/frontend/tests/comparison-screenshots.spec.ts`
```typescript
import { test, expect } from '@playwright/test';
import path from 'path';

const BEFORE_DIAG = '/data/projects/dku_diagnosis_2025-02-12-15-11-44.zip';
const AFTER_DIAG = '/data/projects/dku_diagnosis_2025-12-16-19-07-07.zip';

test.describe('Comparison Visualization Screenshots', () => {
  test('capture comparison view', async ({ page }) => {
    await page.goto('/');

    // Select comparison mode
    await page.getByText('Compare Diagnostics').click();

    // Upload before file
    const beforeInput = page.locator('input[type="file"]').first();
    await beforeInput.setInputFiles(BEFORE_DIAG);
    await page.waitForSelector('text=dku_diagnosis_2025-02-12');

    // Upload after file
    const afterInput = page.locator('input[type="file"]').last();
    await afterInput.setInputFiles(AFTER_DIAG);
    await page.waitForSelector('text=dku_diagnosis_2025-12-16');

    // Wait for processing and click compare
    await page.getByRole('button', { name: /compare/i }).click();
    await page.waitForSelector('text=Total Changes');

    // Take full page screenshot
    await page.screenshot({
      path: 'screenshots/comparison-full.png',
      fullPage: true
    });

    // Screenshot individual sections
    await page.locator('.glass-card').first().screenshot({
      path: 'screenshots/comparison-health.png'
    });
  });
});
```

**Run screenshots**:
```bash
cd resource/frontend
npm run dev &  # Start dev server
npx playwright test --project=chromium
```

---

## CSS Additions Required

```css
/* New animations for improvements */
@keyframes pulse-improvement {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(0, 255, 136, 0); }
}

@keyframes pulse-regression {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 51, 102, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(255, 51, 102, 0); }
}

/* Heat map colors */
.heatmap-cold { background: rgba(0, 245, 255, 0.1); }
.heatmap-warm { background: rgba(255, 184, 0, 0.2); }
.heatmap-hot { background: rgba(255, 51, 102, 0.3); }

/* Diff line backgrounds */
.diff-added { background: rgba(0, 255, 136, 0.1); }
.diff-removed { background: rgba(255, 51, 102, 0.1); }
.diff-modified { background: rgba(255, 184, 0, 0.1); }
```

---

## Utility Additions to compareData.ts

```typescript
/**
 * Calculate significance score for a delta (0-100)
 */
export function calculateSignificance(delta: FieldDelta): number;

/**
 * Get top N most impactful changes
 */
export function getTopChanges(result: ComparisonResult, n: number): FieldDelta[];

/**
 * Group deltas by significance tier
 */
export function groupBySignificance(deltas: FieldDelta[]): {
  critical: FieldDelta[];
  significant: FieldDelta[];
  minor: FieldDelta[];
};
```

---

## Verification Steps

1. **Start dev server**: `cd resource/frontend && npm run dev`
2. **Run Playwright tests**: `npx playwright test`
3. **Manual verification**:
   - Load `/data/projects/dku_diagnosis_2025-02-12-15-11-44.zip` as "Before"
   - Load `/data/projects/dku_diagnosis_2025-12-16-19-07-07.zip` as "After"
   - Verify all new visualizations render correctly
   - Check responsive behavior on mobile
   - Verify animations are smooth

---

## Critical Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `ComparisonResultsView.tsx` | Modify | Add summary dashboard, view toggle |
| `ComparisonHealthSection.tsx` | Modify | Add butterfly chart option |
| `ComparisonSettingsSection.tsx` | Modify | Add heat map, diff view |
| `ComparisonChartsSection.tsx` | Modify | Add sparklines |
| `compareData.ts` | Modify | Add significance scoring |
| `index.css` | Modify | Add new CSS classes |
| `ComparisonSummaryDashboard.tsx` | Create | New summary component |
| `HealthButterflyChart.tsx` | Create | New health visualization |
| `SettingsHeatMap.tsx` | Create | Category heat map |
| `InlineDiffView.tsx` | Create | Unified diff view |
| `ChangeNavigator.tsx` | Create | Floating navigation |
| `Sparkline.tsx` | Create | Mini trend charts |
| `playwright.config.ts` | Create | Test configuration |
| `comparison-screenshots.spec.ts` | Create | Screenshot tests |

---

## Available Test Diags

- `/data/projects/dku_diagnosis_2025-02-12-15-11-44.zip` (432 MB) - Use as "Before"
- `/data/projects/dku_diagnosis_2025-12-16-19-07-07.zip` (889 MB) - Use as "After"
