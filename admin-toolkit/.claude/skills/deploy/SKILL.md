# Deploy to DSS

1. Verify quality: `cd resource/frontend && npm run lint && npm run typecheck`
2. Deploy: `make deploy COMMIT_MSG="Your message"`
   - Bumps version, commits deploy paths, builds, uploads ZIP, restarts webapp
   - 3-step strategy: update existing → install fresh → retry update
3. Optional Plik share: `make deploy-plik COMMIT_MSG="Your message"`

## Other build targets
- `make plugin` — build ZIP without deploying
- `make dev` — dev build with full source
- `make clean` — remove dist/ + node_modules

## Troubleshooting
- Check `.dss-url` and `.dss-api-key` files if HTTP errors occur
- Webapp restart uses WEBAPP_PROJECT_KEY (default: PYTHONAUDIT_TEST) and WEBAPP_ID (default: haoMNtw)
