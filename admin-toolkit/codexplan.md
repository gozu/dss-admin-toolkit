<proposed_plan>
# Outreach Memory and Run History Schema (DSS Dataset-Centered)

## Summary
This repo already has the core ingredients for a strong memory system:
- `resource/frontend/src/components/ToolsView.tsx` defines the outreach campaign taxonomy (`CampaignId`) and recipient shapes.
- `webapps/diag-parser-live/backend.py` computes live outreach data and sends emails (`/api/tools/outreach-data`, `/api/tools/email/preview`, `/api/tools/email/send`).
- `resource/frontend/src/components/ResultsView.tsx` exports a snapshot JSON (`Save report`), and `resource/frontend/src/hooks/useExportLiteZip.ts` exports `diag-lite.zip`.

The best architecture for this project is an **issue-centric, append-only history model** with:
- one row per run,
- one row per detected issue per run,
- one row per outreach preview/send item,
- lifecycle event rows for open/resolved/reopened,
- explicit run coverage status to prevent false “fixed” conclusions,
- raw artifact pointers (snapshot JSON / zip) for audit and reprocessing.

This is the minimum structure that correctly answers:
- who was emailed,
- for which campaign/reason,
- whether it was fixed later,
- whether the “fix” is real vs just missing data from a partial run,
- how the current run compares to prior runs.

## Key Design Invariants
- All **run results**, **issue observations**, **outreach actions**, and **lifecycle events** are append-only.
- “Fixed” is only auto-marked when the **rule has complete coverage** in the newer run.
- Case identity is stable across runs and independent of thresholds (threshold changes are tracked separately).
- Multi-instance support is built in from day 1 (no collisions on `projectKey`, scenario IDs, etc.).
- Raw exported artifacts are retained (via managed folder) and linked from datasets for audit/rebuild.
- Rule-specific details live in JSON columns (stored as JSONB if available, otherwise stringified JSON in DSS datasets).

## Physical Storage Choice (Based On Your Answers)
- Primary storage: **DSS Dataset(s)**.
- Recommended backing for those datasets: **SQL-backed DSS datasets** (PostgreSQL/MySQL) for upserts/materialized current-state tables.
- Artifact blobs (snapshot JSON, zipped exports): **DSS Managed Folder** (`memory_artifacts`) with metadata rows in a dataset.
- If only file-backed datasets are available, keep the same schema and use JSON-string columns + append-only writes + rebuild derived tables each run.

## Canonical IDs and Keys
- `instance_key`: deterministic hash from normalized `installId|nodeId|instanceUrl`.
- `run_id`: ULID.
- `threshold_profile_hash`: SHA-256 of canonical thresholds JSON.
- `entity_uid`: deterministic hash of `instance_key + entity_type + canonical_natural_key_json`.
- `case_uid`: deterministic hash of `instance_key + rule_id + canonical_case_identity_json`.
- `observation_id`: deterministic hash of `run_id + case_uid`.
- `artifact_sha256`: hash of file bytes.
- `template_hash`: hash of normalized `{subject, body}`.

## Rule/Case Identity Mapping (Decision Complete)
Use these case identities so “same problem across runs” is stable and queryable:

- `project` (Code Env Sprawl): case = `projectKey`
- `code_studio`: case = `projectKey`
- `disabled_user`: case = `projectKey`
- `default_code_env`: case = `projectKey`
- `overshared_project`: case = `projectKey`
- `empty_project`: case = `projectKey`
- `large_flow`: case = `projectKey`
- `orphan_notebooks`: case = `projectKey`
- `deprecated_code_env`: case = `codeEnvLang + codeEnvName`
- `code_env` (ownership mismatch): case = `projectKey + codeEnvLang + codeEnvName`
- `auto_scenario`: case = `projectKey + scenarioId`
- `scenario_frequency`: case = `projectKey + scenarioId`
- `scenario_failing`: case = `projectKey + scenarioId`

## Source-of-Truth Datasets (Append-Only Except `memory_issue_cases_current`)
### `memory_instances`
Purpose: stable instance identity across runs.

Columns:
- `instance_id` (string, PK, UUID/ULID)
- `instance_key` (string, unique)
- `install_id` (string, nullable)
- `node_id` (string, nullable)
- `instance_url` (string, nullable)
- `instance_host` (string, nullable)
- `display_name` (string)
- `first_seen_at_utc` (timestamp)
- `last_seen_at_utc` (timestamp)
- `last_seen_source_kind` (string: `live_api|snapshot_import|zip_import`)
- `active` (boolean)

### `memory_threshold_profiles`
Purpose: dedupe/store threshold settings that affect detection outcomes.

Columns:
- `threshold_profile_hash` (string, PK)
- `source_kind` (string: `ui_local_storage|default|imported`)
- `code_env_count_unhealthy` (bigint)
- `code_studio_count_unhealthy` (bigint)
- `filesystem_warning_pct` (double)
- `filesystem_critical_pct` (double)
- `open_files_minimum` (bigint)
- `java_heap_minimum_mb` (bigint)
- `raw_json` (string/json)
- `created_at_utc` (timestamp)

### `memory_rule_catalog`
Purpose: immutable-ish catalog of campaigns/rules and support matrix.

Columns:
- `rule_id` (string, PK; matches `CampaignId`)
- `title` (string)
- `description` (string)
- `primary_entity_type` (string)
- `supports_live_api` (boolean)
- `supports_snapshot_v1` (boolean)
- `supports_snapshot_v2` (boolean)
- `depends_on_sections_json` (string/json)
- `case_identity_schema_json` (string/json)
- `rule_version` (string)
- `default_severity` (string)
- `active` (boolean)
- `effective_from_utc` (timestamp)
- `effective_to_utc` (timestamp, nullable)

### `memory_runs`
Purpose: one row per recorded run/import.

Columns:
- `run_id` (string, PK)
- `instance_id` (string, FK/logical to `memory_instances`)
- `run_kind` (string: `live_api|snapshot_import|zip_import|recompute`)
- `trigger_kind` (string: `manual_record|auto_record|import`)
- `status` (string: `completed|partial|failed|cancelled`)
- `coverage_status` (string: `complete|partial|insufficient_for_resolution`)
- `data_source_family` (string: `api|snapshot_json|diag_zip|diag_lite_zip`)
- `snapshot_schema_version` (bigint, nullable)
- `frontend_app_version` (string, nullable)
- `backend_plugin_version` (string, nullable)
- `detector_version` (string)
- `threshold_profile_hash` (string, FK/logical)
- `run_started_at_utc` (timestamp)
- `run_finished_at_utc` (timestamp)
- `recorded_by_user` (string, nullable)
- `previous_run_id` (string, nullable)
- `previous_comparable_run_id` (string, nullable)
- `content_fingerprint_hash` (string, nullable)
- `parsed_data_hash` (string, nullable)
- `outreach_data_hash` (string, nullable)
- `source_file_name` (string, nullable)
- `source_file_sha256` (string, nullable)
- `source_snapshot_timestamp_utc` (timestamp, nullable)
- `summary_json` (string/json)
- `error_summary` (string, nullable)

### `memory_run_sections`
Purpose: endpoint/section-level completeness and timeout status (critical for safe auto-resolution).

Columns:
- `run_id` (string)
- `section_key` (string; examples: `overview`, `users`, `projects`, `code_envs`, `project_footprint`, `outreach_data`, `mail_channels`)
- `status` (string: `success|partial|error|skipped|unsupported`)
- `is_complete` (boolean)
- `timed_out` (boolean)
- `timeout_at_step` (string, nullable)
- `started_at_utc` (timestamp, nullable)
- `finished_at_utc` (timestamp, nullable)
- `duration_ms` (double, nullable)
- `selected_count` (bigint, nullable)
- `completed_count` (bigint, nullable)
- `error_message` (string, nullable)
- `summary_json` (string/json)
- `raw_status_payload_json` (string/json)
- PK (logical): `run_id + section_key`

### `memory_run_rule_status`
Purpose: per-rule detection counts, comparison results, and whether resolution is safe for that rule in this run.

Columns:
- `run_id` (string)
- `rule_id` (string)
- `rule_version` (string)
- `support_status` (string: `supported|partial_support|unsupported`)
- `detection_status` (string: `success|partial|error|skipped`)
- `coverage_status` (string: `complete|partial|none`)
- `resolution_safe` (boolean)
- `resolution_block_reason` (string, nullable)
- `previous_comparable_run_id` (string, nullable)
- `detected_case_count` (bigint)
- `recipient_count` (bigint)
- `preview_batch_count` (bigint)
- `preview_message_count` (bigint)
- `send_attempt_count` (bigint)
- `send_sent_count` (bigint)
- `send_error_count` (bigint)
- `new_case_count` (bigint)
- `persisting_case_count` (bigint)
- `resolved_case_count` (bigint)
- `reopened_case_count` (bigint)
- `summary_json` (string/json)
- PK (logical): `run_id + rule_id`

### `memory_run_artifacts`
Purpose: pointers to raw files used for audit/reprocessing (snapshots/zips/outreach payloads).

Columns:
- `artifact_id` (string, PK)
- `run_id` (string)
- `artifact_type` (string: `diag_snapshot_json`, `diag_snapshot_zip`, `diag_lite_zip`, `outreach_data_json`, `parsed_data_json`)
- `storage_kind` (string: `managed_folder`)
- `folder_path` (string)
- `file_name` (string)
- `content_type` (string)
- `content_encoding` (string: `identity|gzip|zip`)
- `bytes_size` (bigint)
- `sha256` (string)
- `schema_version` (bigint, nullable)
- `created_at_utc` (timestamp)

### `memory_entity_presence`
Purpose: entity inventory per run for correct resolution classification (`deleted` vs `condition fixed` vs `not observed`).

Columns:
- `run_id` (string)
- `instance_id` (string)
- `entity_type` (string: `project|code_env|scenario|user`)
- `entity_uid` (string)
- `natural_key` (string)
- `natural_key_json` (string/json)
- `parent_entity_uid` (string, nullable)
- `parent_natural_key` (string, nullable)
- `display_name` (string, nullable)
- `owner_login` (string, nullable)
- `owner_email` (string, nullable)
- `presence_source` (string: `projects`, `project_footprint`, `code_envs`, `outreach_scenarios`, `users`)
- `attributes_json` (string/json)
- `fingerprint_hash` (string, nullable)
- `seen_at_utc` (timestamp)
- PK (logical): `run_id + entity_uid + presence_source`

### `memory_issue_observations`
Purpose: one row per detected issue case per run (the core “what was wrong this run” fact table).

Columns:
- `observation_id` (string, PK)
- `run_id` (string)
- `instance_id` (string)
- `rule_id` (string)
- `rule_version` (string)
- `threshold_profile_hash` (string)
- `case_uid` (string)
- `case_identity_json` (string/json)
- `subject_entity_type` (string)
- `subject_entity_uid` (string)
- `subject_natural_key` (string)
- `subject_display_name` (string, nullable)
- `parent_entity_type` (string, nullable)
- `parent_entity_uid` (string, nullable)
- `parent_natural_key` (string, nullable)
- `owner_login` (string, nullable)
- `owner_email` (string, nullable)
- `default_recipient_key` (string)
- `default_recipient_login` (string, nullable)
- `default_recipient_email` (string)
- `severity` (string)
- `reason_summary` (string)
- `metric_primary_name` (string, nullable)
- `metric_primary_value_num` (double, nullable)
- `metric_threshold_num` (double, nullable)
- `metric_unit` (string, nullable)
- `details_json` (string/json)
- `fingerprint_hash` (string)
- `detected_at_utc` (timestamp)

### `memory_issue_case_events`
Purpose: append-only lifecycle/audit events for each case (open, resolved, reopened, outreach sent, manual notes).

Columns:
- `event_id` (string, PK)
- `event_at_utc` (timestamp)
- `instance_id` (string)
- `case_uid` (string)
- `rule_id` (string)
- `run_id` (string, nullable)
- `observation_id` (string, nullable)
- `event_type` (string: `opened|observed|reopened|resolved_auto|resolved_manual|dismissed|undismissed|outreach_previewed|outreach_sent|outreach_send_failed|note`)
- `status_before` (string, nullable)
- `status_after` (string, nullable)
- `resolution_reason` (string, nullable: `condition_cleared|entity_deleted|ownership_changed|threshold_change|manual|unknown`)
- `event_origin` (string: `system|user|email_workflow`)
- `actor_user` (string, nullable)
- `linked_batch_id` (string, nullable)
- `linked_message_id` (string, nullable)
- `linked_send_attempt_id` (string, nullable)
- `note_text` (string, nullable)
- `evidence_json` (string/json)

### `memory_outreach_batches`
Purpose: one row per preview-generation batch for a campaign in a run (template/channel snapshot).

Columns:
- `batch_id` (string, PK)
- `run_id` (string)
- `instance_id` (string)
- `rule_id` (string; same as campaign)
- `threshold_profile_hash` (string)
- `created_at_utc` (timestamp)
- `created_by_user` (string, nullable)
- `template_subject` (string)
- `template_body` (string)
- `template_hash` (string)
- `selected_channel_id` (string, nullable)
- `selected_recipient_count` (bigint)
- `preview_message_count` (bigint)
- `status` (string: `preview_created|send_attempted|send_completed|send_partial|send_failed`)
- `error_summary` (string, nullable)

### `memory_outreach_messages`
Purpose: preview message rows (one per recipient in batch), independent of send attempts.

Columns:
- `message_id` (string, PK)
- `batch_id` (string)
- `run_id` (string)
- `rule_id` (string)
- `preview_order` (bigint)
- `recipient_key` (string)
- `recipient_login` (string, nullable)
- `recipient_owner_label` (string, nullable)
- `recipient_email` (string)
- `project_key_for_send` (string, nullable)
- `project_keys_json` (string/json)
- `code_env_names_json` (string/json)
- `object_count` (bigint)
- `rendered_subject` (string)
- `rendered_body` (string)
- `rendered_body_hash` (string)
- `usage_details_json` (string/json)
- `created_at_utc` (timestamp)

### `memory_outreach_send_attempts`
Purpose: one row per click of “Send Emails” (supports retries).

Columns:
- `send_attempt_id` (string, PK)
- `batch_id` (string)
- `run_id` (string)
- `rule_id` (string)
- `requested_at_utc` (timestamp)
- `completed_at_utc` (timestamp, nullable)
- `requested_by_user` (string, nullable)
- `requested_channel_id` (string, nullable)
- `resolved_channel_id` (string, nullable)
- `requested_count` (bigint)
- `sent_count` (bigint)
- `error_count` (bigint)
- `status` (string: `completed|partial|failed`)
- `response_json` (string/json, nullable)
- `error_summary` (string, nullable)

### `memory_outreach_send_results`
Purpose: per-message delivery result for each send attempt.

Columns:
- `send_result_id` (string, PK)
- `send_attempt_id` (string)
- `message_id` (string)
- `run_id` (string)
- `rule_id` (string)
- `recipient_key` (string)
- `recipient_email` (string)
- `project_key_for_send` (string, nullable)
- `status` (string: `sent|error`)
- `error_message` (string, nullable)
- `provider_message_id` (string, nullable)
- `sent_at_utc` (timestamp, nullable)
- `created_at_utc` (timestamp)

### `memory_outreach_message_issue_links`
Purpose: exact mapping from outreach message to the issue observations/cases it referenced.

Columns:
- `link_id` (string, PK)
- `message_id` (string)
- `batch_id` (string)
- `run_id` (string)
- `rule_id` (string)
- `case_uid` (string)
- `observation_id` (string)
- `link_reason` (string: `message_includes_case`)
- `created_at_utc` (timestamp)

## Derived / Materialized Datasets (Rebuilt or Upserted)
### `memory_issue_cases_current`
Purpose: fast current-state table for UI/reporting (“open vs fixed”, “who still hasn’t fixed it”).

Columns:
- `case_uid` (string, PK)
- `instance_id` (string)
- `rule_id` (string)
- `current_status` (string: `open|resolved|dismissed`)
- `is_open` (boolean)
- `first_seen_run_id` (string)
- `first_seen_at_utc` (timestamp)
- `last_observed_run_id` (string, nullable)
- `last_observed_at_utc` (timestamp, nullable)
- `last_checked_run_id` (string, nullable)
- `last_resolution_run_id` (string, nullable)
- `last_resolution_at_utc` (timestamp, nullable)
- `last_resolution_reason` (string, nullable)
- `reopen_count` (bigint)
- `total_observed_runs` (bigint)
- `open_streak_runs` (bigint)
- `outreach_sent_count` (bigint)
- `last_outreach_sent_at_utc` (timestamp, nullable)
- `last_outreach_message_id` (string, nullable)
- `last_recipient_key` (string, nullable)
- `last_recipient_email` (string, nullable)
- `subject_entity_type` (string)
- `subject_entity_uid` (string)
- `subject_natural_key` (string)
- `subject_display_name` (string, nullable)
- `owner_login_last` (string, nullable)
- `owner_email_last` (string, nullable)
- `last_reason_summary` (string, nullable)
- `last_details_json` (string/json, nullable)
- `updated_at_utc` (timestamp)

### `memory_recipient_followup_current`
Purpose: user/recipient-centric follow-up reporting.

Columns:
- `instance_id` (string)
- `recipient_key` (string)
- `recipient_email` (string)
- `rule_id` (string)
- `open_case_count` (bigint)
- `emailed_case_count_total` (bigint)
- `emailed_open_case_count` (bigint)
- `resolved_after_email_count` (bigint)
- `last_email_sent_at_utc` (timestamp, nullable)
- `last_resolution_after_email_at_utc` (timestamp, nullable)
- `oldest_open_case_first_emailed_at_utc` (timestamp, nullable)
- `stale_days_max` (bigint, nullable)
- PK (logical): `instance_id + recipient_key + rule_id`

### `memory_run_deltas`
Purpose: per-run compare summary against previous comparable run (trend UI and auditing).

Columns:
- `run_id` (string)
- `rule_id` (string)
- `previous_comparable_run_id` (string, nullable)
- `new_case_count` (bigint)
- `persisting_case_count` (bigint)
- `resolved_case_count` (bigint)
- `reopened_case_count` (bigint)
- `coverage_limited` (boolean)
- `created_at_utc` (timestamp)
- PK (logical): `run_id + rule_id`

## Auto-Resolution Logic (Strict, Coverage-Gated)
Use this exact policy (you selected “auto-resolve with evidence”):

- Only evaluate auto-resolution for cases whose rule has `memory_run_rule_status.resolution_safe = true`.
- If the same `case_uid` appears in `memory_issue_observations` for the current run, the case remains open (or reopens if previously resolved).
- If the case does not appear and the subject entity is present in `memory_entity_presence`, emit `resolved_auto` with `resolution_reason = condition_cleared`.
- If the case does not appear and the subject entity is absent but the entity’s presence source coverage is complete, emit `resolved_auto` with `resolution_reason = entity_deleted`.
- If thresholds changed and the case disappears only because the threshold changed, emit `resolved_auto` with `resolution_reason = threshold_change`.
- If coverage is partial/unsafe, do not resolve; leave case open and record no state change (or optional `note` event for audit).

## Public API / Interface Changes (Required)
### Backend API additions
- `POST /api/memory/runs/record-live`
- Behavior: records the current live run, computes/stores observations/entity presence/rule status, stores artifacts, returns `runId`.
- `POST /api/memory/runs/import`
- Accepts snapshot JSON or zipped snapshot, records an import run (`snapshot_import` / `zip_import`).
- `GET /api/memory/runs`
- Returns run history and top-level statuses.
- `GET /api/memory/issues/current`
- Returns current open/resolved cases (filterable by rule, recipient, instance).
- `GET /api/memory/followup`
- Returns recipient-centric follow-up summary.
- `GET /api/memory/runs/{runId}/diff`
- Returns `memory_run_deltas` + rule summaries.

### Changes to existing email preview/send contracts
These are needed to make message-to-issue linkage exact (no fuzzy matching):
- `/api/tools/email/preview` response should include:
  - `batchId`
  - per preview item: `messageId`
  - per preview item: `linkedObservationIds` (or `linkedCaseUids`)
- `/api/tools/email/send` request should accept:
  - `batchId`
  - `messageIds` (instead of only raw preview payloads; raw payloads can remain backward-compatible)
- `/api/tools/email/send` response should include:
  - `sendAttemptId`
  - per result item: `messageId`, `sendResultId`

### Frontend type additions/changes
- Add `batchId`, `messageId`, and `linkedObservationIds` to `EmailPreviewResponse` / `EmailPreviewItem` in `resource/frontend/src/types/index.ts`.
- Add memory-specific types:
  - `MemoryRun`
  - `MemoryIssueCaseCurrent`
  - `MemoryRecipientFollowup`
  - `MemoryRunDelta`
- Add a memory persistence action path (button or auto-record flow) in tools/results UI.

### Snapshot export upgrade (recommended)
Current `Save report` in `resource/frontend/src/components/ResultsView.tsx` exports `version: 1` JSON with `metadata + parsedData`. Upgrade to `version: 2` and include:
- `thresholds`
- `outreachData` (if available)
- `ruleStatus`
- `frontendAppVersion`
- `detectorVersion`
- `coverageStatus`
Keep v1 import support.

## Why This Schema Is Better Than Simpler Alternatives
- Better than “one snapshot table”: snapshots alone cannot answer who was emailed and which exact issue items were in the email.
- Better than “one outreach history table”: you need issue observations and entity presence to determine real fixes.
- Better than “issue table only”: without section/rule coverage tables you will produce false fixes on timed-out/partial runs.
- Better than “fully typed project/codeenv/scenario history only”: campaign logic evolves; JSON detail columns prevent schema churn while keeping queryable core columns stable.

## Test Cases and Scenarios (Acceptance Criteria)
### Core lifecycle
- Run A flags `empty_project` on `PROJ1`; run B still flags it -> case stays open, no resolve event.
- Run A flags `empty_project` on `PROJ1`; run B has `PROJ1` present but not empty -> `resolved_auto / condition_cleared`.
- Run A flags `empty_project` on `PROJ1`; run B has no `PROJ1` and project coverage complete -> `resolved_auto / entity_deleted`.
- Run A flags `scenario_failing` on `P1:S1`; run B scenario exists and no longer failing -> `resolved_auto / condition_cleared`.
- Resolved case appears again in later run -> `reopened` event and `current_status = open`.

### Coverage safety
- `project_footprint` times out in run B -> no project-based cases auto-resolved in run B.
- Snapshot v1 import run lacks scenario data -> scenario rules marked `unsupported`; no scenario case state changes.
- Partial `/api/tools/outreach-data` failure -> `run_rule_status.detection_status = partial/error` and `resolution_safe = false`.

### Outreach auditability
- Preview batch records one row in `memory_outreach_batches` and N rows in `memory_outreach_messages`.
- Send click records one row in `memory_outreach_send_attempts` and N rows in `memory_outreach_send_results`.
- Every sent message links to exact observations via `memory_outreach_message_issue_links`.
- “Who was sent outreach for empty projects and did they fix it?” can be answered by a single query joining `memory_outreach_send_results` -> links -> `memory_issue_cases_current`.

### Identity / multi-instance correctness
- Same `projectKey` on two DSS instances creates different `entity_uid` and different `case_uid`.
- User email change across runs does not break case continuity (case keyed by entity/rule, not email).
- Code env renamed (new natural key) creates a new case when appropriate; old case can resolve as deleted/changed.

### Threshold and rule-version changes
- Threshold raised from 1 to 2 causes a project sprawl case to disappear -> `resolved_auto / threshold_change`.
- Rule version changes but same case identity remains stable and history is preserved with new `rule_version` on observations.

## Implementation Notes (DSS Dataset-Specific)
- Use append-only writes for all event/fact tables.
- Rebuild or upsert `memory_issue_cases_current`, `memory_recipient_followup_current`, and `memory_run_deltas` after each committed run.
- Store large artifacts in a managed folder and reference them from `memory_run_artifacts`.
- If SQL-backed datasets are available, enforce PK/unique keys and add indexes; if not, enforce uniqueness in code via deterministic IDs.

## Recommended Indexes (If SQL-Backed DSS Datasets)
- `memory_runs(instance_id, run_finished_at_utc desc)`
- `memory_issue_observations(run_id, rule_id)`
- `memory_issue_observations(case_uid, run_id desc)`
- `memory_issue_case_events(case_uid, event_at_utc desc)`
- `memory_issue_cases_current(instance_id, rule_id, current_status)`
- `memory_outreach_batches(run_id, rule_id)`
- `memory_outreach_messages(batch_id)`
- `memory_outreach_send_results(send_attempt_id, status)`
- `memory_outreach_message_issue_links(message_id)`
- `memory_entity_presence(run_id, entity_type, entity_uid)`

## Assumptions and Defaults Chosen
- Storage backend: DSS Datasets (your choice), with SQL-backed datasets preferred.
- Scope: multi-instance in one database (your choice).
- Fix policy: auto-resolve with evidence and strict coverage gating (your choice).
- Timestamps are stored in UTC.
- JSON payload columns are canonical JSON strings unless native JSON types are available.
- Full rendered email subject/body is stored for auditability (plus hashes). This can be redacted later if needed.
- Existing snapshot export is plain JSON (`Save report`), and `diag-lite.zip` is a separate export; the memory system supports both via `memory_run_artifacts`.
</proposed_plan>
