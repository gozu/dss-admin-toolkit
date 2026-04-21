# Diag Parser DSS Plugin

A Dataiku DSS plugin that provides a webapp for analyzing Dataiku diagnostic files with visualizations and health scoring.

## Plugin Structure

```
diagwebappplugin/
├── plugin.json                 # Plugin manifest (id, version, metadata)
├── bump_version.py             # Auto-increment version script
├── Makefile                    # Build & deploy automation
├── webapps/
│   └── diag-parser/
│       ├── webapp.json         # Webapp configuration
│       ├── body.html           # HTML that loads the React app
│       ├── backend.py          # Dummy backend (enables SSO settings)
│       └── app.js              # Empty (all JS is bundled)
└── resource/
    ├── dist/                   # Built frontend assets (generated)
    │   └── assets/
    │       ├── index.js
    │       └── index.css
    └── frontend/               # React source code
        ├── src/
        ├── package.json
        ├── vite.config.ts
        └── ...
```

## Building

### Prerequisites
- Node.js 18+
- npm
- Python 3.x
- curl (for deployment)

### Build Frontend

```bash
cd resource/frontend
npm install
MODE=production npm run build
```

This outputs bundled assets to `resource/dist/assets/`.

### Create Plugin Zip

```bash
make dev    # Development build (includes source)
make dist   # Production build (git archive, excludes dev files)
```

## Deployment

### Setup Credentials

Create these files in the plugin root:

```bash
echo "https://your-dss-instance.com" > .dss-url
echo "your-api-key" > .dss-api-key
```

These files are gitignored. The API key needs admin privileges.

### Deploy to DSS

```bash
make deploy
```

This will:
1. Bump the version (both plugin.json and package.json)
2. Build the frontend
3. Commit and tag the release
4. Create a production zip
5. Install/update the plugin via DSS API

### Manual Deployment

If `make deploy` fails, use these steps:

```bash
# 1. Build the plugin zip (MUST use `make plugin`, not just git archive)
make plugin

# 2. The zip is at dist/dss-plugin-diag-parser-{version}.zip
```

**Important:** Always use `make plugin` or `make dev` to create the zip. Plain `git archive` won't include the built assets in `resource/dist/` since they're not committed.

### DSS API Endpoints

```bash
DSS_URL="https://your-instance.com"
API_KEY="your-api-key"

# Update existing plugin
curl -X POST "${DSS_URL}/public/api/plugins/diag-parser/actions/updateFromZip" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@dist/dss-plugin-diag-parser-0.7.3.zip"

# Fresh install (if plugin doesn't exist)
curl -X POST "${DSS_URL}/public/api/plugins/actions/installFromZip" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@dist/dss-plugin-diag-parser-0.7.3.zip"

# Force delete plugin (if update fails or plugin is stuck)
curl -X POST "${DSS_URL}/public/api/plugins/diag-parser/actions/delete" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| 500 "Could not install" | Plugin in bad state or server issue | Force delete then reinstall |
| 403 Forbidden | API key lacks admin privileges | Use an admin API key |
| "Plugin is used" on delete | Webapp instances exist | Use `{"force": true}` in delete |
| Assets not loading (404) | Used `git archive` instead of `make plugin` | Rebuild with `make plugin` |
| Version mismatch | package.json not synced | Run `bump_version.py` or check both files |

## Version Scheme

Versions follow `x.y.z` format:
- Patch (z): 0-9, then rolls to minor
- Minor (y): 0-9, then rolls to major
- Example: 0.0.9 → 0.1.0 → 0.9.9 → 1.0.0

## Webapp Configuration

Key settings in `webapp.json`:
- `baseType: "STANDARD"` - Standard HTML/JS webapp
- `hasBackend: "true"` - Enables authentication/SSO settings in DSS UI
- `enableJavascriptModules: "true"` - Required for ES modules (React)
- `noJSSecurity: "true"` - Required for zip.js web workers

## Development

For local development without DSS:

```bash
cd resource/frontend
npm install
npm run dev
```

The app runs at http://localhost:5173 with hot reload.

## Current Version

1.0.4

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Author

Alex Kaos

---

# Technical Architecture

## Overview

This plugin parses ZIP diagnostic bundles from Dataiku DSS instances, extracting and visualizing system health, configuration, and error data. The entire parsing and visualization happens client-side in the browser - no backend processing.

## Data Flow

```
ZIP Upload → zip.js extraction (web workers, 50 concurrent)
          → File categorization (regex path matching)
          → Sequential parsing (17 parsers with dependencies)
          → React state (DiagContext)
          → Health scoring & issue detection
          → Dashboard visualization
```

## Supported Diagnostic Types

| Type | Detection | Contents |
|------|-----------|----------|
| **Instance Diag** | Contains `diag.txt` | Full DSS instance diagnostics |
| **Job Diag** | Contains `localconfig.zip` | Job execution diagnostics |
| **FM Diag** | Contains FM-specific markers | Fleet Manager diagnostics |
| **Unknown** | Fallback | Partial parsing attempted |

## Frontend Source Structure

```
resource/frontend/src/
├── main.tsx                    # Entry point
├── App.tsx                     # Root component, routing
├── context/
│   └── DiagContext.tsx         # Global state (Redux-like)
├── hooks/
│   ├── useFileProcessor.ts     # ZIP extraction orchestration
│   ├── useDataParser.ts        # Parser sequencing
│   ├── useDirTreeLoader.ts     # Async large file extraction
│   ├── useIssueDetection.ts    # Critical/warning issue detection
│   ├── useHealthScore.ts       # Health score calculation
│   └── useTableFilter.ts       # Section visibility toggle
├── parsers/
│   ├── index.ts                # Parser exports
│   ├── BaseJSONParser.ts       # JSON parsing with fallback
│   ├── BaseTextParser.ts       # Text/regex parsing base
│   ├── DiagTextParser.ts       # diag.txt → system info
│   ├── VersionParser.ts        # dss-version.json
│   ├── VersionExtractionParser.ts  # Python/Spark versions
│   ├── ConnectionsParser.ts    # connections.json
│   ├── GeneralSettingsParser.ts    # general-settings.json (complex)
│   ├── LicenseParser.ts        # license.json
│   ├── UsersParser.ts          # users.json
│   ├── ClustersParser.ts       # K8s cluster configs (YAML+logs)
│   ├── RestartTimeParser.ts    # supervisord.log
│   ├── JavaMemoryParser.ts     # env-default.sh
│   ├── PluginDiscoveryParser.ts    # Plugin directory discovery
│   ├── CodeEnvsParser.ts       # Code environment desc.json
│   ├── ProjectsParser.ts       # Project params.json
│   ├── LogParser.ts            # backend.log errors
│   └── DirListingParser.ts     # datadir_listing.txt → tree
├── components/
│   ├── FileUpload.tsx          # Drag & drop upload
│   ├── ResultsView.tsx         # Main dashboard orchestrator
│   ├── Header.tsx              # Title, navigation
│   ├── AlertBanner.tsx         # Critical/warning alerts
│   ├── HealthScoreCard.tsx     # Overall health gauge
│   ├── InfoPanel.tsx           # Key system facts
│   ├── FilterBar.tsx           # Section visibility toggles
│   ├── DataTables.tsx          # 14 different data tables
│   ├── ProjectsTable.tsx       # Projects with permissions modal
│   ├── PluginsTable.tsx        # Plugin list
│   ├── CodeEnvsTable.tsx       # Code envs with Python distribution
│   ├── ClustersTable.tsx       # K8s clusters (height-matched layout)
│   ├── DirTreeSection.tsx      # Directory space analysis
│   ├── DirTreemap.tsx          # Sunburst/treemap visualization
│   ├── DirTreeTable.tsx        # Flat directory table
│   ├── LogErrorsSection.tsx    # Error logs with highlighting
│   ├── FilesystemChart.tsx     # Disk usage chart
│   ├── MemoryChart.tsx         # Memory breakdown
│   ├── ConnectionsChart.tsx    # Connection types chart
│   └── ...                     # Modals, cards, utilities
├── types/
│   └── index.ts                # TypeScript interfaces
└── styles/
    └── index.css               # Tailwind + CSS variables
```

## Parsers Reference

### Text Parsers (regex-based)

| Parser | Input File | Extracts |
|--------|------------|----------|
| `DiagTextParser` | `diag.txt` | CPU cores, OS info, memory (free -m), system limits (ulimit), filesystem usage (df -h) |
| `VersionExtractionParser` | `diag.txt` | Python version, Spark version (DKU_SPARK_VERSION) |
| `JavaMemoryParser` | `bin/env-default.sh` | Java heap: BACKEND, JEK, FEK, DKUJAVABIN |
| `RestartTimeParser` | `run/supervisord.log` | Last restart time ("backend entered RUNNING") |
| `LogParser` | `run/backend.log` | Error logs with 10-line before/100-line after context, deduped by 5s window, max 5 errors |

### JSON Parsers

| Parser | Input File | Extracts |
|--------|------------|----------|
| `VersionParser` | `dss-version.json` | `product_version` |
| `ConnectionsParser` | `config/connections.json` | Connection types and counts |
| `UsersParser` | `config/users.json` | User stats, profiles, groups, enabled/disabled counts |
| `LicenseParser` | `config/license.json` | Company, license props, usage percentages, expiration |
| `GeneralSettingsParser` | `config/general-settings.json` | 50+ settings: auth (LDAP/SSO/SAML/OIDC), Spark, containers, K8s, cgroups, proxy, disabled features |

### Structured Data Parsers

| Parser | Input Pattern | Extracts |
|--------|---------------|----------|
| `ProjectsParser` | `config/projects/*/params.json` | Project key, name, owner, version, permissions matrix |
| `CodeEnvsParser` | `code-envs/desc/*/desc.json` | Env name, Python version, version distribution |
| `PluginDiscoveryParser` | Any path with `/plugins/` | Plugin directory names, count |
| `ClustersParser` | `clusters/*/exec/*_config.yaml`, `kube_config`, `log/*.log` | K8s: region, version, VPC, subnets, node groups (instance type, capacity, spot, taints, labels), server endpoint, status (ON/OFF), uptime |
| `DirListingParser` | `datadir_listing.txt` | Hierarchical directory tree with cumulative sizes |

## Health Scoring

Categories (weighted):
- **Version (25%)**: Python 3.10+ adoption, Spark 3.x
- **System (30%)**: Memory availability, disk space, file limits
- **Config (30%)**: Disabled features, missing recommended settings
- **Security (15%)**: Impersonation, cgroups configuration

## Issue Detection

Automatic checks for:
- Filesystem usage ≥70% (warning) / ≥90% (critical)
- Open files limit <65535
- Java heap <2GB
- Python 2.x or 3.6-3.8 (EOL)
- Spark 2.x
- Empty cgroups targets
- Disabled critical features

## Key Implementation Details

### Large File Handling
`datadir_listing.txt` can be 100MB+. Handled via:
1. During extraction: stored as blob with `__BLOB_STORED__` marker
2. On-demand: `useDirTreeLoader` extracts from original ZIP when DirTreeSection expands
3. Streaming parse builds tree incrementally

### Cluster Card Height Matching
`ClustersTable.tsx` uses a greedy algorithm to pair clusters with similar heights in the 2-column grid, minimizing whitespace. Height score based on: node pool count, optional fields, labels/taints.

### Log Syntax Highlighting
`LogParser` adds HTML spans for: timestamps, log levels (ERROR/WARN/INFO), IP addresses, K8s resources (pod names, namespaces).

## State Shape (DiagContext)

```typescript
interface DiagState {
  // Raw data
  extractedFiles: Record<string, string>;  // filename → content
  originalFile: File | null;               // For deferred extraction

  // Metadata
  diagType: 'instance' | 'job' | 'fm' | 'unknown';
  dsshome: string;

  // Parsed data (populated by parsers)
  parsedData: {
    // System
    cpuCores, osInfo, memoryInfo, systemLimits, filesystemInfo,
    dssVersion, pythonVersion, sparkVersion, lastRestartTime,
    javaMemorySettings,

    // Config
    connections, connectionCounts, generalSettings, disabledFeatures,
    enabledSettings, sparkSettings, authSettings, containerSettings,
    integrationSettings, resourceLimits, cgroupsSettings, proxySettings,

    // License
    company, licenseProperties, licenseUsage,

    // Users & Projects
    users, userStats, usersByProjects, projects,

    // Infrastructure
    clusters, codeEnvs, pythonVersionCounts, plugins, pluginsCount,

    // Logs & Diagnostics
    formattedLogErrors, rawLogErrors, logStats, dirTree,
  };

  // UI state
  isLoading, error, activeFilter, projectFiles,
}
```

## Adding a New Parser

1. Create `parsers/MyNewParser.ts` extending `BaseJSONParser` or `BaseTextParser`
2. Implement `parse(content: string): Partial<ParsedData>`
3. Export from `parsers/index.ts`
4. Add to parser sequence in `useDataParser.ts` (order matters for dependencies)
5. Add types to `types/index.ts`
6. Create visualization component if needed

## Performance Optimizations

- **Web Workers**: zip.js uses workers for parallel extraction
- **Concurrency Limit**: 50 simultaneous file extractions
- **Deferred Parsing**: Large files extracted on-demand
- **useMemo**: Expensive computations memoized (cluster arrangement, health scores)
- **Virtualization**: Not yet implemented but recommended for large tables

## Comparison Mode

The plugin supports comparing two diagnostic files to identify changes between them.

### Features

- **Side-by-side upload**: Upload "before" and "after" diagnostic files
- **Auto date detection**: Parses timestamps from filenames (e.g., `dku_diagnosis_2025-02-12-15-11-44.zip`) and automatically swaps files if uploaded in wrong order
- **Delta visualization**: Shows added, removed, and modified items across all sections
- **2-column layout**: All comparison grids use max 2 columns for better readability
- **Smart defaults**: When no changes exist, sections expand and show all values by default

### Comparison Sections

| Section | What's Compared |
|---------|-----------------|
| Health Score | Overall score delta with breakdown by category |
| System Info | DSS version, Python, Spark, memory, filesystem |
| Resource Charts | Memory usage, filesystem, connections with before/after bars |
| Configuration | Settings tables with row-level change highlighting |
| Collections | Users, projects, clusters, code envs, plugins |

### Components

```
src/components/comparison/
├── ComparisonUpload.tsx        # Dual file upload with date validation
├── ComparisonResultsView.tsx   # Main results orchestrator
├── ComparisonHealthSection.tsx # Health score comparison
├── ComparisonSystemSection.tsx # System info deltas
├── ComparisonChartsSection.tsx # Resource usage charts
├── ComparisonSettingsSection.tsx # Config tables with filters
├── ComparisonCollectionsSection.tsx # Collection cards/combined view
└── DeltaBadge.tsx              # Added/removed/modified badges
```
