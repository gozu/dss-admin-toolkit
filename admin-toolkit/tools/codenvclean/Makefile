# Makefile variables set automatically
plugin_id=`cat plugin.json | python3 -c "import sys, json; print(str(json.load(sys.stdin)['id']).replace('/',''))"`
plugin_version=`cat plugin.json | python3 -c "import sys, json; print(str(json.load(sys.stdin)['version']).replace('/',''))"`
archive_file_name="dss-plugin-${plugin_id}-${plugin_version}.zip"
remote_url=`git config --get remote.origin.url 2>/dev/null || echo "local"`
last_commit_id=`git rev-parse HEAD 2>/dev/null || echo "unknown"`

# DSS connection settings
DSS_URL ?= $(shell cat .dss-url 2>/dev/null || cat ~/.dss-url 2>/dev/null)
DSS_API_KEY ?= $(shell cat .dss-api-key 2>/dev/null || cat ~/.dss-api-key 2>/dev/null)
WEBAPP_PROJECT_KEY ?= $(shell cat .dss-project-key 2>/dev/null || echo "")
WEBAPP_ID ?= $(shell cat .dss-webapp-id 2>/dev/null || echo "")
RESTART_AFTER_DEPLOY ?= 1
COMMIT_MSG ?= Deploy update

.DEFAULT_GOAL := plugin

.PHONY: plugin deploy dist-clean clean

DEPLOY_COMMIT_PATHS := \
	plugin.json \
	webapps \
	scripts \
	Makefile

plugin: dist-clean
	@echo "[START] Archiving plugin to dist/ folder..."
	@python3 -c "import json; json.load(open('plugin.json'))" || (echo "[ERROR] Invalid plugin.json"; exit 1)
	@mkdir dist
	@echo "{\"remote_url\":\"${remote_url}\",\"last_commit_id\":\"${last_commit_id}\"}" > release_info.json
	@git archive -v -9 --format zip -o dist/${archive_file_name} HEAD
	@zip -u dist/${archive_file_name} release_info.json
	@rm release_info.json
	@echo "[SUCCESS] Archiving plugin to dist/ folder: Done!"

deploy:
	@echo "[START] Bumping version..."
	@python3 -c "import json,pathlib; pf=pathlib.Path('plugin.json'); d=json.loads(pf.read_text()); v=list(map(int,d['version'].split('.'))); v2=(v[0],v[1],v[2]+1) if v[2]<9 else (v[0],v[1]+1,0) if v[1]<9 else (v[0]+1,0,0); nv='%d.%d.%d'%v2; print('plugin.json: %s -> %s'%(d['version'],nv)); d['version']=nv; pf.write_text(json.dumps(d,indent=4)+chr(10))"
	@echo "[START] Committing deploy-relevant changes..."
	@git add -- $(DEPLOY_COMMIT_PATHS)
	@git commit -m "$(COMMIT_MSG)" -- $(DEPLOY_COMMIT_PATHS) || echo "[INFO] Nothing deploy-relevant to commit"
	@$(MAKE) plugin
	@cp -f "dist/$(archive_file_name)" "/tmp/$(archive_file_name)"
	@echo "[SUCCESS] Copied plugin ZIP to /tmp/$(archive_file_name)"
	@echo "[START] Deploying plugin to DSS..."
	@if [ -z "$(DSS_URL)" ]; then echo "[ERROR] DSS_URL not set. Create ~/.dss-url with your DSS instance URL."; exit 1; fi
	@if [ -z "$(DSS_API_KEY)" ]; then echo "[ERROR] DSS_API_KEY not set. Create ~/.dss-api-key with your API key."; exit 1; fi
	@echo "[INFO] Attempting update first..."; \
	UPDATE_RESPONSE=$$(DSS_URL="$(DSS_URL)" DSS_API_KEY="$(DSS_API_KEY)" bash scripts/dss_api.sh POST "/public/api/plugins/$(plugin_id)/actions/updateFromZip" \
		--form "file=@dist/$(archive_file_name)"); \
	UPDATE_CODE=$$(echo "$$UPDATE_RESPONSE" | tail -n1); \
	UPDATE_BODY=$$(echo "$$UPDATE_RESPONSE" | sed '$$d'); \
	if [ "$$UPDATE_CODE" = "204" ] || [ "$$UPDATE_CODE" = "200" ]; then \
		echo "[SUCCESS] Plugin updated!"; \
		if [ "$(RESTART_AFTER_DEPLOY)" = "1" ] && [ -n "$(WEBAPP_PROJECT_KEY)" ] && [ -n "$(WEBAPP_ID)" ]; then \
			echo "[START] Restarting webapp backend $(WEBAPP_PROJECT_KEY)/$(WEBAPP_ID)..."; \
			RESTART_RESPONSE=$$(DSS_URL="$(DSS_URL)" DSS_API_KEY="$(DSS_API_KEY)" bash scripts/dss_api.sh PUT "/public/api/projects/$(WEBAPP_PROJECT_KEY)/webapps/$(WEBAPP_ID)/backend/actions/restart"); \
			RESTART_CODE=$$(echo "$$RESTART_RESPONSE" | tail -n1); \
			if [ "$$RESTART_CODE" = "204" ] || [ "$$RESTART_CODE" = "200" ]; then \
				echo "[SUCCESS] Webapp backend restart requested."; \
			else \
				echo "[WARN] Webapp backend restart failed (HTTP $$RESTART_CODE)."; \
			fi; \
		fi; \
		exit 0; \
	fi; \
	echo "[INFO] Update failed (HTTP $$UPDATE_CODE), attempting install..."; \
	INSTALL_RESPONSE=$$(DSS_URL="$(DSS_URL)" DSS_API_KEY="$(DSS_API_KEY)" bash scripts/dss_api.sh POST "/public/api/plugins/actions/installFromZip" \
		--form "file=@dist/$(archive_file_name)"); \
	INSTALL_CODE=$$(echo "$$INSTALL_RESPONSE" | tail -n1); \
	INSTALL_BODY=$$(echo "$$INSTALL_RESPONSE" | sed '$$d'); \
	if [ "$$INSTALL_CODE" = "204" ] || [ "$$INSTALL_CODE" = "200" ]; then \
		echo "[SUCCESS] Plugin installed!"; \
		if [ "$(RESTART_AFTER_DEPLOY)" = "1" ] && [ -n "$(WEBAPP_PROJECT_KEY)" ] && [ -n "$(WEBAPP_ID)" ]; then \
			echo "[START] Restarting webapp backend $(WEBAPP_PROJECT_KEY)/$(WEBAPP_ID)..."; \
			RESTART_RESPONSE=$$(DSS_URL="$(DSS_URL)" DSS_API_KEY="$(DSS_API_KEY)" bash scripts/dss_api.sh PUT "/public/api/projects/$(WEBAPP_PROJECT_KEY)/webapps/$(WEBAPP_ID)/backend/actions/restart"); \
			RESTART_CODE=$$(echo "$$RESTART_RESPONSE" | tail -n1); \
			if [ "$$RESTART_CODE" = "204" ] || [ "$$RESTART_CODE" = "200" ]; then \
				echo "[SUCCESS] Webapp backend restart requested."; \
			else \
				echo "[WARN] Webapp backend restart failed (HTTP $$RESTART_CODE)."; \
			fi; \
		fi; \
		exit 0; \
	fi; \
	echo "[ERROR] Deploy failed."; \
	echo "[ERROR] Update (HTTP $$UPDATE_CODE): $$UPDATE_BODY"; \
	echo "[ERROR] Install (HTTP $$INSTALL_CODE): $$INSTALL_BODY"; \
	exit 1

dist-clean:
	rm -rf dist

clean: dist-clean
