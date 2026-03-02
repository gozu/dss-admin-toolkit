# Diagnostics — Dataiku DSS Plugin

## Commands (run from resource/frontend/)
- `npm run dev` — dev server
- `npm run build` — production build (tsc + vite)
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript strict check
- `npm run format` — Prettier
- `npx playwright test` — E2E tests

## Deploy (from project root)
- `make deploy COMMIT_MSG="msg"` — build + deploy to DSS
- `make plugin` — build ZIP only
- Needs `.dss-url` + `.dss-api-key` files

## Style
- React 19, TypeScript 5.9, Tailwind 4.1, ES modules
- Functional components + hooks, no classes

## Key Paths
- Frontend: `resource/frontend/src/`
- Backend: `webapps/diag-parser-live/backend.py`
- Plugin manifest: `plugin.json`

## Workflow
- Always deploy with `make deploy` after completing changes
