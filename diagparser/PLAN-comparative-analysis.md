# Plan: Comparative Analysis (2 Diagnostics)

## Overview

Add comparison mode for exactly 2 diagnostic files. Landing page offers two choices: single analysis (current) or comparison mode.

---

## Landing Page Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Diag Parser                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌──────────────────────────────┐    ┌──────────────────────────────┐    │
│    │                              │    │                              │    │
│    │      📊 Single Analysis      │    │      ⚖️  Compare Two          │    │
│    │                              │    │                              │    │
│    │   Analyze one diagnostic     │    │   Compare diagnostics from   │    │
│    │   file for health issues,    │    │   different times or         │    │
│    │   configuration, and         │    │   environments to track      │    │
│    │   system information         │    │   changes and drift          │    │
│    │                              │    │                              │    │
│    │      [Select File]           │    │      [Select Files]          │    │
│    │                              │    │                              │    │
│    └──────────────────────────────┘    └──────────────────────────────┘    │
│                                                                             │
│                    Files are processed locally in your browser              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- **Single Analysis** → Current FileUpload behavior (accepts 1 file)
- **Compare Two** → Modified upload accepting exactly 2 files, then comparison view

---

## Comparison Mode Flow

```
1. User clicks "Compare Two"
2. Upload UI shows two drop zones side by side:
   ┌─────────────────┐  ┌─────────────────┐
   │  "Before" Diag  │  │  "After" Diag   │
   │                 │  │                 │
   │  [Drop/Select]  │  │  [Drop/Select]  │
   │                 │  │                 │
   │  (older file)   │  │  (newer file)   │
   └─────────────────┘  └─────────────────┘

3. As each file uploads, show:
   - Filename, size
   - Processing progress
   - Once parsed: health score preview, DSS version, date extracted

4. When both ready → [Compare] button enabled

5. Click Compare → ComparisonResultsView
```

---

## Comparison Results Layout Options

### Option A: Delta-Focused View (Recommended Default)

Single-column layout highlighting only differences. Best for: "what changed?"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back    Comparing: prod-jan.zip vs prod-feb.zip           [Export] [View] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────┐     ┌─────────────────────────┐               │
│  │ Before: prod-jan.zip    │     │ After: prod-feb.zip     │               │
│  │ Jan 15, 2024            │ --> │ Feb 12, 2024            │               │
│  │ DSS 12.4.0              │     │ DSS 12.6.1              │               │
│  │ Health: 72              │     │ Health: 78 (+6) ✓       │               │
│  └─────────────────────────┘     └─────────────────────────┘               │
│                                                                             │
│  ═══════════════════════════════════════════════════════════════════════   │
│                                                                             │
│  Summary: 47 changes  •  12 improvements  •  5 regressions  •  30 neutral   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚠️ Critical Changes (3)                                     [expand] │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Filesystem /data         65%        →  89%        ↑ +24%  ⚠️        │   │
│  │ Open files limit         65535      →  4096       ↓ -93%  ⚠️        │   │
│  │ Python version           3.8.10     →  3.11.4     ✓ upgraded        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📊 System Changes (5)                                       [expand] │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Total Memory             64 GB      →  128 GB     ↑ +100%  ✓        │   │
│  │ CPU Cores                16         →  16         (unchanged)       │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 👥 Users & Projects (27 changes)                            [expand] │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ + 7 projects added: NEW_PROJ_1, NEW_PROJ_2, ...                     │   │
│  │ - 2 projects removed: OLD_PROJ_1, OLD_PROJ_2                        │   │
│  │ ~ 6 projects modified (owner/permissions changed)                   │   │
│  │                                                                     │   │
│  │ + 3 users added                                                     │   │
│  │ - 1 user removed                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☸️ Infrastructure (4 changes)                                [expand] │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ + 1 cluster added: prod-cluster-3                                   │   │
│  │ ~ eks-prod-1: K8s 1.27 → 1.29, maxNodes 10 → 20                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚙️ Configuration (8 changes)                                 [expand] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔌 Plugins & Code Envs (6 changes)                           [expand] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Works on any screen size (single column, max-width 1200px)
- Focuses attention on what matters (changes)
- Fast to scan
- Collapsible sections reduce overwhelm
- No modal width issues (same as current)

**Cons:**
- Can't see full context of either diagnostic
- New components needed

---

### Option B: Side-by-Side View (Secondary, Toggle)

Two synchronized panels showing both full dashboards. Best for: "show me everything"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back    [Delta View] [Side-by-Side ✓]                     [Export]        │
├──────────────────────────────────┬──────────────────────────────────────────┤
│ prod-jan.zip                     │ prod-feb.zip                             │
│ Jan 15 | DSS 12.4.0 | Score: 72  │ Feb 12 | DSS 12.6.1 | Score: 78 (+6)     │
├──────────────────────────────────┼──────────────────────────────────────────┤
│                                  │                                          │
│  [Health Score Card]             │  [Health Score Card]  ← highlighted      │
│                                  │                                          │
│  [Info Panel]                    │  [Info Panel]                            │
│  Memory: 64 GB                   │  Memory: 128 GB  ↑                       │
│                                  │                                          │
│  [Filesystem Chart]              │  [Filesystem Chart]  ← warning glow      │
│  /data: 65%                      │  /data: 89%  ⚠️                           │
│                                  │                                          │
│  [Projects Table]                │  [Projects Table]                        │
│  45 projects                     │  52 projects (+7)                        │
│                                  │                                          │
│  ...                             │  ...                                     │
│                                  │                                          │
│  (scroll synced)                 │  (scroll synced)                         │
│                                  │                                          │
└──────────────────────────────────┴──────────────────────────────────────────┘
```

**Layout considerations:**
- Remove `max-width: 1600px` constraint, use full viewport
- Each panel ~50% viewport width
- Minimum viable: 1400px viewport (700px per panel)
- Below 1400px: stack vertically or show warning
- Scroll sync: both panels scroll together

**Pros:**
- Full context visible
- Familiar layout (existing components)
- Easy to implement (render ResultsView twice with different data)

**Cons:**
- Needs wide screen (1400px+)
- Overwhelming - two dashboards of data
- Harder to spot differences
- Modal behavior: modals overlay everything (OK)

---

### Option C: Tabbed View (Fallback for Narrow Screens)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back    [Summary] [Before ✓] [After]                      [Export]        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  (Full ResultsView for selected file)                                       │
│                                                                             │
│  With delta badges on changed values:                                       │
│  Memory: 64 GB  [was: 32 GB ↑]                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Use when viewport < 1400px.

---

## Recommended Approach

**Default:** Delta View (Option A)
**Toggle:** Side-by-Side (Option B) for users who want full context
**Fallback:** Tabbed (Option C) on narrow screens

```typescript
type ComparisonViewMode = 'delta' | 'side-by-side' | 'tabbed';

// Auto-select based on viewport
const defaultMode = window.innerWidth >= 1400 ? 'delta' : 'tabbed';
```

---

## Modal Behavior in Comparison Mode

**No changes needed.** Modals are:
- Positioned fixed over entire viewport
- Default width: `min(896px, 90vw)`
- Resizable via react-rnd
- Same behavior in both single and comparison modes

The only consideration: if user opens a modal from the "After" panel in side-by-side mode, it should be clear which file it's from → add filename badge in modal title.

```
Before: "Project Permissions - MY_PROJECT"
After:  "Project Permissions - MY_PROJECT (prod-feb.zip)"
```

---

## State Management Changes

### Current State
```typescript
interface DiagState {
  extractedFiles: Record<string, string>;
  parsedData: ParsedData;
  diagType: DiagType;
  // ... single file assumption throughout
}
```

### New State
```typescript
interface DiagState {
  // Mode
  mode: 'single' | 'comparison';

  // Single mode (backwards compatible)
  extractedFiles: Record<string, string>;
  parsedData: ParsedData;
  diagType: DiagType;
  dsshome: string;
  originalFile: File | null;
  // ...existing fields

  // Comparison mode (new)
  comparison: {
    before: DiagFile | null;
    after: DiagFile | null;
    result: ComparisonResult | null;
    viewMode: ComparisonViewMode;
  } | null;
}

interface DiagFile {
  id: string;
  filename: string;
  uploadedAt: Date;
  fileSize: number;
  parsedData: ParsedData;
  extractedFiles: Record<string, string>;
  diagType: DiagType;
  dsshome: string;
  originalFile: File | null;
  healthScore: HealthScore;
  issues: Issue[];
}
```

### New Actions
```typescript
type DiagAction =
  // Existing
  | { type: 'SET_PARSED_DATA'; payload: Partial<ParsedData> }
  | { type: 'RESET' }
  // ...

  // New for comparison
  | { type: 'SET_MODE'; payload: 'single' | 'comparison' }
  | { type: 'SET_COMPARISON_FILE'; payload: { slot: 'before' | 'after'; file: DiagFile } }
  | { type: 'CLEAR_COMPARISON_FILE'; payload: 'before' | 'after' }
  | { type: 'SET_COMPARISON_RESULT'; payload: ComparisonResult }
  | { type: 'SET_COMPARISON_VIEW_MODE'; payload: ComparisonViewMode }
```

---

## File Structure

```
resource/frontend/src/
├── context/
│   └── DiagContext.tsx                 # MODIFY: Add comparison state
│
├── types/
│   ├── index.ts                        # MODIFY: Add DiagFile, ComparisonResult
│   └── comparison.ts                   # NEW: Comparison-specific types
│
├── hooks/
│   ├── useFileProcessor.ts             # MODIFY: Return DiagFile structure
│   ├── useDeltaCalculator.ts           # NEW: Compute comparison result
│   └── useComparisonExport.ts          # NEW: Export comparison
│
├── comparison/                         # NEW: Comparison logic
│   ├── index.ts
│   ├── calculateDelta.ts               # Main delta calculation
│   ├── fieldComparators.ts             # Per-field comparison logic
│   ├── collectionDiff.ts               # Array diffing (projects, users, etc.)
│   └── directionRules.ts               # Is change good/bad/neutral?
│
├── components/
│   ├── FileUpload.tsx                  # MODIFY: Support comparison mode
│   ├── LandingPage.tsx                 # NEW: Mode selection cards
│   ├── ComparisonUpload.tsx            # NEW: Two-file upload UI
│   ├── App.tsx                         # MODIFY: Route based on mode
│   ├── ResultsView.tsx                 # KEEP: Single file results
│   │
│   └── comparison/                     # NEW: Comparison components
│       ├── index.ts
│       ├── ComparisonResultsView.tsx   # Main comparison container
│       ├── ComparisonHeader.tsx        # Header with file info + mode toggle
│       ├── DeltaView.tsx               # Delta-focused layout
│       ├── SideBySideView.tsx          # Two-panel layout
│       ├── FileSummaryCard.tsx         # File info card (name, date, score)
│       ├── DeltaSummary.tsx            # Change counts bar
│       ├── DeltaSection.tsx            # Collapsible section of changes
│       ├── FieldDelta.tsx              # Single field change row
│       ├── CollectionDelta.tsx         # Added/removed/modified list
│       └── DeltaBadge.tsx              # +/-/~ indicator badge
```

---

## Delta Calculation

### Categories
```typescript
interface ComparisonResult {
  computedAt: Date;

  summary: {
    totalChanges: number;
    improvements: number;
    regressions: number;
    neutral: number;
    critical: number;
  };

  health: HealthDelta;

  sections: {
    critical: DeltaSection;      // High-priority changes
    system: DeltaSection;        // Memory, CPU, disk, limits
    versions: DeltaSection;      // DSS, Python, Spark
    config: DeltaSection;        // Settings, features
    users: CollectionDelta<User>;
    projects: CollectionDelta<Project>;
    clusters: CollectionDelta<Cluster>;
    codeEnvs: CollectionDelta<CodeEnv>;
    plugins: CollectionDelta<string>;
    connections: DeltaSection;
  };
}
```

### Direction Rules (is change good or bad?)

| Field | Increase = | Decrease = |
|-------|------------|------------|
| `memoryInfo.MemTotal` | ✓ improvement | ⚠ regression |
| `memoryInfo.MemAvailable` | ✓ improvement | ⚠ regression |
| `filesystemInfo.*.Use%` | ⚠ regression | ✓ improvement |
| `systemLimits.Max open files` | ✓ improvement | ⚠ regression |
| `dssVersion` | ✓ improvement | ⚠ regression (downgrade?) |
| `pythonVersion` | ✓ improvement | ⚠ regression |
| `healthScore.overall` | ✓ improvement | ⚠ regression |
| `users.length` | neutral | neutral |
| `projects.length` | neutral | neutral |
| `clusters.length` | neutral | neutral |
| `enabledSettings.*` | true→true: neutral, false→true: ✓, true→false: ⚠ |
| `disabledFeatures.count` | ⚠ regression | ✓ improvement |

### Severity Rules

| Condition | Severity |
|-----------|----------|
| Filesystem > 80% | critical |
| Filesystem > 70% | warning |
| Open files < 65535 | critical |
| Python < 3.10 | warning |
| Health score drop > 10 | critical |
| Health score drop > 5 | warning |
| Any field change | info |

---

## Reusable Components

### From Single Mode (no changes needed)
- `Header` (add comparison indicator)
- `Container`
- `Modal`
- `FileViewer`
- `PacmanLoader`
- All chart components (if used in side-by-side)
- All table components (if used in side-by-side)

### Needs Modification
- `FileUpload` → Support comparison mode upload
- `App` → Add mode routing
- `DiagContext` → Add comparison state

### New Components
- `LandingPage` - Mode selection
- `ComparisonUpload` - Two-file upload
- `ComparisonResultsView` - Main comparison container
- `DeltaView` - Delta-focused layout
- `SideBySideView` - Two-panel layout
- `DeltaSection`, `FieldDelta`, `CollectionDelta`, etc.

---

## Implementation Phases

### Phase 1: Landing Page + State Foundation
**Files:** LandingPage.tsx, DiagContext.tsx (modify), App.tsx (modify), types/comparison.ts

1. Create `LandingPage` with two mode cards
2. Add `mode` and `comparison` to DiagContext
3. Route: landing → single upload OR comparison upload
4. Keep single mode working exactly as before

**Test:** Click "Single Analysis" → existing flow works unchanged

### Phase 2: Comparison Upload UI
**Files:** ComparisonUpload.tsx, useFileProcessor.ts (modify)

1. Create two-zone upload UI
2. Modify `useFileProcessor` to return `DiagFile` structure
3. Process both files, store in context
4. Show file summaries as they complete
5. Enable "Compare" button when both ready

**Test:** Upload two files, see summaries, click Compare

### Phase 3: Delta Calculation Engine
**Files:** comparison/*.ts, useDeltaCalculator.ts

1. Implement `calculateDelta(before, after)`
2. Field comparators for each data type
3. Collection diff for arrays
4. Direction and severity rules
5. Summary statistics

**Test:** Unit tests for delta calculation

### Phase 4: Delta View UI
**Files:** comparison/DeltaView.tsx, DeltaSection.tsx, FieldDelta.tsx, etc.

1. Create `ComparisonResultsView` container
2. Implement `DeltaView` with collapsible sections
3. Render all delta sections
4. Add export functionality

**Test:** See comparison results in delta view

### Phase 5: Side-by-Side View (Optional)
**Files:** SideBySideView.tsx

1. Create two-panel layout
2. Pass `parsedData` as props to existing components
3. Implement scroll sync
4. Add delta badges to components

**Test:** Toggle to side-by-side, scroll syncs

### Phase 6: Polish & Edge Cases
- Responsive behavior (narrow screens → tabbed)
- Export comparison report
- Handle mismatched diag types (warn user)
- Handle identical files (show "no changes")
- Performance optimization for large files

---

## Edge Cases

| Case | Handling |
|------|----------|
| Same file uploaded twice | Show "No changes detected" |
| Different diag types (instance vs job) | Warning banner, allow comparison |
| Very large files (100MB+) | Progress indicator, lazy loading |
| One file fails to parse | Show error on that slot, allow retry |
| User switches mode mid-upload | Confirm and reset |
| Narrow viewport (<1400px) in side-by-side | Auto-switch to tabbed or delta view |

---

## Estimated Scope

| Phase | New Files | Modified Files | Lines | Effort |
|-------|-----------|----------------|-------|--------|
| 1. Landing + State | 2 | 2 | ~300 | Small |
| 2. Comparison Upload | 1 | 1 | ~250 | Small |
| 3. Delta Engine | 5 | 0 | ~600 | Medium |
| 4. Delta View UI | 6 | 1 | ~800 | Medium |
| 5. Side-by-Side | 1 | 0 | ~300 | Small |
| 6. Polish | 0 | 3 | ~200 | Small |
| **Total** | **15** | **7** | **~2450** | - |

---

## Open Questions

1. **File naming:** "Before/After" vs "File 1/File 2" vs auto-detect by date?
   - Recommend: Auto-detect by extracted timestamp, label as "Older/Newer"

2. **Persist comparison?** Save to localStorage for session?
   - Recommend: No for v1, keep it ephemeral

3. **Deep link to section?** URL hash for specific delta section?
   - Recommend: Yes, easy to add (`#delta-projects`)

4. **Comparison export format?**
   - Recommend: JSON (machine-readable) + Markdown (human-readable)
