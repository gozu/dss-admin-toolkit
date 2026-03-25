# Makefile variables set automatically
plugin_id=`cat plugin.json | python3 -c "import sys, json; print(str(json.load(sys.stdin)['id']).replace('/',''))"`
plugin_version=`cat plugin.json | python3 -c "import sys, json; print(str(json.load(sys.stdin)['version']).replace('/',''))"`
archive_file_name="dss-plugin-${plugin_id}-${plugin_version}.zip"
remote_url=`git config --get remote.origin.url`
last_commit_id=`git rev-parse HEAD`

# DSS connection settings (read from local files, fallback to home directory)
DSS_URL ?= $(shell cat .dss-url 2>/dev/null || cat ~/.dss-url 2>/dev/null)
DSS_API_KEY ?= $(shell cat .dss-api-key 2>/dev/null || cat ~/.dss-api-key 2>/dev/null)

.DEFAULT_GOAL := plugin

.PHONY: build-frontend plugin dev deploy dist-clean clean

build-frontend:
	@echo "[START] Building frontend..."
	@cd resource/frontend && npm install && MODE=production npm run build
	@echo "[SUCCESS] Frontend build complete!"

plugin: dist-clean build-frontend
	@echo "[START] Archiving plugin to dist/ folder..."
	@python3 -c "import json; json.load(open('plugin.json'))" || (echo "[ERROR] Invalid plugin.json"; exit 1)
	@mkdir dist
	@echo "{\"remote_url\":\"${remote_url}\",\"last_commit_id\":\"${last_commit_id}\"}" > release_info.json
	@git archive -v -9 --format zip -o dist/${archive_file_name} HEAD
	@zip -u dist/${archive_file_name} release_info.json
	@zip -u -r dist/${archive_file_name} resource/dist
	@rm release_info.json
	@echo "[SUCCESS] Archiving plugin to dist/ folder: Done!"

dev: dist-clean build-frontend
	@echo "[START] Archiving plugin to dist/ folder... (dev mode)"
	@python3 -c "import json; json.load(open('plugin.json'))" || (echo "[ERROR] Invalid plugin.json"; exit 1)
	@mkdir dist
	@zip -v -9 dist/${archive_file_name} -r . \
		--exclude "resource/frontend/node_modules/*" \
		--exclude "resource/frontend/.git/*" \
		--exclude "dist/*" \
		--exclude ".git/*" \
		--exclude "*.DS_Store" \
		--exclude "__pycache__/*" \
		--exclude "*.pyc" \
		--exclude "plugins.html" \
		--exclude "webapps.html" \
		--exclude ".dss-url" \
		--exclude ".dss-api-key" \
		--exclude ".gitignore"
	@echo "[SUCCESS] Archiving plugin to dist/ folder: Done!"

# Deploy to Dataiku DSS (bumps version, commits all changes, installs if not exists)
deploy:
	@echo "[START] Bumping version..."
	@python3 bump_version.py
	@echo "[START] Committing changes..."
	@git add -A
	@git commit -m "Deploy update" || echo "[INFO] Nothing to commit"
	@git tag -f "v$(shell cat plugin.json | python3 -c "import sys, json; print(json.load(sys.stdin)['version'])")"
	@$(MAKE) plugin
	@echo "[START] Deploying plugin to DSS..."
	@if [ -z "$(DSS_URL)" ]; then echo "[ERROR] DSS_URL not set. Create ~/.dss-url with your DSS instance URL."; exit 1; fi
	@if [ -z "$(DSS_API_KEY)" ]; then echo "[ERROR] DSS_API_KEY not set. Create ~/.dss-api-key with your API key."; exit 1; fi
	@RESPONSE=$$(curl -s -w "\n%{http_code}" -X POST "$(DSS_URL)/public/api/plugins/$(plugin_id)/actions/updateFromZip" \
		-H "Authorization: Bearer $(DSS_API_KEY)" \
		-F "file=@dist/$(archive_file_name)"); \
	HTTP_CODE=$$(echo "$$RESPONSE" | tail -n1); \
	BODY=$$(echo "$$RESPONSE" | sed '$$d'); \
	if [ "$$HTTP_CODE" = "204" ] || [ "$$HTTP_CODE" = "200" ]; then \
		echo "[SUCCESS] Plugin updated!"; \
	elif [ "$$HTTP_CODE" = "404" ]; then \
		echo "[INFO] Plugin not found, installing..."; \
		INSTALL_RESPONSE=$$(curl -s -w "\n%{http_code}" -X POST "$(DSS_URL)/public/api/plugins/actions/installFromZip" \
			-H "Authorization: Bearer $(DSS_API_KEY)" \
			-F "file=@dist/$(archive_file_name)"); \
		INSTALL_CODE=$$(echo "$$INSTALL_RESPONSE" | tail -n1); \
		INSTALL_BODY=$$(echo "$$INSTALL_RESPONSE" | sed '$$d'); \
		if [ "$$INSTALL_CODE" = "204" ] || [ "$$INSTALL_CODE" = "200" ]; then \
			echo "[SUCCESS] Plugin installed!"; \
		else \
			echo "[ERROR] Install failed (HTTP $$INSTALL_CODE): $$INSTALL_BODY"; \
			exit 1; \
		fi; \
	else \
		echo "[ERROR] Deploy failed (HTTP $$HTTP_CODE): $$BODY"; \
		exit 1; \
	fi

dist-clean:
	rm -rf dist

clean: dist-clean
	rm -rf resource/dist
	rm -rf resource/frontend/node_modules
