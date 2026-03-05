# Admin Toolkit

A Dataiku DSS plugin for instance administration — health scoring, outreach campaigns, auditing, and cleanup.

Connects to the running DSS instance via the Python API. All data is fetched in real time through a Flask backend with 38+ endpoints. No file uploads or diagnostic bundles needed.

## Tech Stack

React 19 / TypeScript 5.9 / Tailwind 4.1 / Vite / Chart.js — served from a Flask backend via the DSS webapp framework.

## Setup

### Prerequisites

- Node.js (for frontend builds)
- Access to a Dataiku DSS instance (admin API key)

### Configuration

Create these files in the project root:

| File | Contents |
|------|----------|
| `.dss-url` | DSS instance URL (e.g. `https://dss.example.com`) |
| `.dss-api-key` | Admin API key for the instance |
| `.dss-project-key` | *(optional)* Project key — defaults to `PYTHONAUDIT_TEST` |
| `.dss-webapp-id` | *(optional)* Webapp ID — defaults to `haoMNtw` |

### Development

```bash
cd resource/frontend
npm install
npm run dev
```

### Build & Deploy

```bash
make deploy COMMIT_MSG="your message"   # build, bump version, deploy to all targets
make plugin                              # build ZIP only
make deploy-dev                          # deploy to dev server only
make deploy-prod-secure                  # deploy to prod via sudo wrappers
make clean                               # remove dist + node_modules
```

`make deploy` auto-increments the patch version in `plugin.json` and `package.json`, commits deploy-relevant files, builds the frontend, archives the plugin, and pushes to all configured targets.

### Linting & Tests

```bash
cd resource/frontend
npm run lint          # ESLint
npm run typecheck     # TypeScript strict
npm run format        # Prettier
npx playwright test   # E2E tests
```

## Health Score

The composite health score (0-100) is built from six weighted categories:

| Category | Weight |
|----------|--------|
| Code Environments | 35% |
| Project Footprint | 30% |
| System Capacity | 15% |
| Security & Isolation | 10% |
| Version Currency | 5% |
| Runtime Config | 5% |

These are derived from 12 toggleable factors (configurable in Settings): Python versions, Spark version, memory availability, filesystem capacity, open files limit, user isolation, cgroups, code envs per project, project size pressure, disabled features, and Java memory limits.

## Outreach Campaigns

The outreach system sends targeted emails to project owners about unhealthy patterns. 15 built-in campaigns cover issues like code env sprawl, deprecated Python versions, inactive projects, failing scenarios, and more. Each campaign supports recipient preview, exemption management, email template preview, and send history.

## Project Structure

```
plugin.json                  # plugin manifest
webapps/admin-toolkit/       # Flask backend
python-lib/                  # shared Python utilities
resource/frontend/           # React frontend (src/, public/)
scripts/                     # deploy helper scripts
Makefile                     # build & deploy orchestration
```
