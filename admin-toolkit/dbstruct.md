# Diagnostics Tracking Database Architecture

## Storage

**SQLite** — `$DIP_HOME/plugins/diag-parser-live/tracking.db`

Zero dependencies (Python `sqlite3` built-in), embedded, persists across runs. No external infrastructure needed.

---

## Core Concept

Three temporal layers:

1. **Point-in-time snapshots** — "what did the instance look like during this run?"
2. **Issue lifecycles** — "when did this problem first appear, and is it still open?"
3. **Outreach actions** — "who was emailed, when, about what, and did they act?"

---

## Tables

### 1. `instances`

Tracks DSS instances the tool is used against (live mode can target different instances).

```sql
CREATE TABLE instances (
    instance_id     TEXT PRIMARY KEY,          -- install_id from install.ini, or sha256(url)
    instance_url    TEXT NOT NULL,
    install_id      TEXT,
    node_id         TEXT,
    company_name    TEXT,
    first_seen_at   TEXT NOT NULL,             -- ISO-8601
    last_seen_at    TEXT NOT NULL
);
```

Without this, findings from instance A would pollute instance B's history.

---

### 2. `runs`

Each time outreach data is computed or diagnostics are loaded. The spine of the entire tracking system.

```sql
CREATE TABLE runs (
    run_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id         TEXT NOT NULL REFERENCES instances(instance_id),
    run_at              TEXT NOT NULL,             -- ISO-8601
    dss_version         TEXT,
    python_version      TEXT,
    health_score        REAL,                      -- 0-100
    health_status       TEXT,                      -- 'healthy' | 'warning' | 'critical'
    user_count          INTEGER,
    enabled_user_count  INTEGER,
    project_count       INTEGER,
    code_env_count      INTEGER,
    plugin_count        INTEGER,
    connection_count    INTEGER,
    cluster_count       INTEGER,
    notes               TEXT                       -- optional admin annotation
);
```

---

### 3. `run_health_metrics`

System-level health data per run. Enables trend tracking ("filesystem has been climbing for 3 months").

```sql
CREATE TABLE run_health_metrics (
    run_id                      INTEGER PRIMARY KEY REFERENCES runs(run_id),
    cpu_cores                   INTEGER,
    memory_total_mb             INTEGER,
    memory_used_mb              INTEGER,
    memory_available_mb         INTEGER,
    swap_total_mb               INTEGER,
    swap_used_mb                INTEGER,
    max_filesystem_pct          REAL,              -- highest mount point usage
    max_filesystem_mount        TEXT,              -- which mount point
    backend_heap_mb             INTEGER,
    jek_heap_mb                 INTEGER,
    fek_heap_mb                 INTEGER,
    open_files_limit            INTEGER,
    -- health sub-scores (4-category weighted system)
    version_currency_score      REAL,
    system_capacity_score       REAL,
    configuration_score         REAL,
    security_isolation_score    REAL,
    -- license pressure
    license_named_users_pct         REAL,
    license_concurrent_users_pct    REAL,
    license_projects_pct            REAL,
    license_connections_pct         REAL,
    license_expiry_date             TEXT
);
```

Structured columns (not a JSON blob) because you'll want SQL queries like "show me runs where filesystem > 80%" or "plot health score over time."

---

### 4. `run_campaign_summaries`

Per-run aggregate counts for each campaign. Fast dashboard queries without scanning all findings.

```sql
CREATE TABLE run_campaign_summaries (
    run_id          INTEGER NOT NULL REFERENCES runs(run_id),
    campaign_id     TEXT NOT NULL,             -- one of 13 campaign IDs
    finding_count   INTEGER NOT NULL,          -- number of flagged entities
    recipient_count INTEGER NOT NULL,          -- number of unique owners affected
    PRIMARY KEY (run_id, campaign_id)
);
```

Needed for heatmaps and trend charts without `COUNT(*)` across findings for every cell.

---

### 5. `findings`

One row per **flagged entity per run**. Raw observation — "in run #7, project SALES was found empty."

```sql
CREATE TABLE findings (
    finding_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES runs(run_id),
    campaign_id     TEXT NOT NULL,             -- e.g. 'empty_project', 'deprecated_code_env'
    entity_type     TEXT NOT NULL,             -- 'project' | 'code_env'
    entity_key      TEXT NOT NULL,             -- project_key or code_env_name
    entity_name     TEXT,                      -- human-readable name
    owner_login     TEXT NOT NULL,
    owner_email     TEXT,
    metrics_json    TEXT,                      -- campaign-specific metrics (see mapping below)
    UNIQUE(run_id, campaign_id, entity_type, entity_key)
);

CREATE INDEX idx_findings_run_campaign ON findings(run_id, campaign_id);
CREATE INDEX idx_findings_entity ON findings(campaign_id, entity_type, entity_key);
CREATE INDEX idx_findings_owner ON findings(owner_login);
```

#### Entity type & metrics mapping per campaign

| Campaign | entity_type | entity_key | metrics_json example |
|---|---|---|---|
| `project` | `project` | project_key | `{"codeEnvCount": 5, "totalGB": 12.3}` |
| `code_env` | `project` | project_key | `{"mismatchedEnvCount": 2}` |
| `code_studio` | `project` | project_key | `{"codeStudioCount": 12, "totalGB": 5.0}` |
| `auto_scenario` | `project` | project_key | `{"scenarioCount": 3, "scenarios": [{"id":"s1","name":"Daily Load","type":"temporal","triggerCount":2}]}` |
| `scenario_frequency` | `project` | project_key | `{"minTriggerMinutes": 5, "scenarios": [...]}` |
| `scenario_failing` | `project` | project_key | `{"failingCount": 2, "scenarios": [...]}` |
| `disabled_user` | `project` | project_key | `{"totalGB": 3.2}` |
| `deprecated_code_env` | `code_env` | env_name | `{"pythonVersion": "3.6", "language": "python", "sizeBytes": 524288, "impactedProjects": ["PROJ1","PROJ2"]}` |
| `default_code_env` | `project` | project_key | `{"codeEnvCount": 3}` |
| `empty_project` | `project` | project_key | `{"totalGB": 0.001}` |
| `large_flow` | `project` | project_key | `{"totalObjects": 153}` |
| `orphan_notebooks` | `project` | project_key | `{"notebookCount": 8, "recipeCount": 2}` |
| `overshared_project` | `project` | project_key | `{"permissionCount": 47}` |

JSON for metrics because each campaign has different relevant numbers. The relational columns (`campaign_id`, `entity_key`, `owner_login`) handle all cross-campaign queries.

---

### 6. `issues`

**The key differentiator.** Tracks the **lifecycle** of a specific problem across runs. A finding is a point-in-time observation; an issue is continuity — "project SALES has been empty since run #3."

```sql
CREATE TABLE issues (
    issue_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id         TEXT NOT NULL REFERENCES instances(instance_id),
    campaign_id         TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_key          TEXT NOT NULL,
    owner_login         TEXT NOT NULL,
    owner_email         TEXT,
    status              TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'regressed'
    first_detected_run  INTEGER NOT NULL REFERENCES runs(run_id),
    first_detected_at   TEXT NOT NULL,
    last_detected_run   INTEGER REFERENCES runs(run_id),
    last_detected_at    TEXT,
    resolved_run        INTEGER REFERENCES runs(run_id),  -- first run where NOT found
    resolved_at         TEXT,
    times_regressed     INTEGER NOT NULL DEFAULT 0,       -- reopened count
    times_emailed       INTEGER NOT NULL DEFAULT 0,       -- denormalized for fast queries
    last_emailed_at     TEXT,
    UNIQUE(instance_id, campaign_id, entity_type, entity_key)
);

CREATE INDEX idx_issues_status ON issues(instance_id, status);
CREATE INDEX idx_issues_owner ON issues(owner_login, status);
CREATE INDEX idx_issues_campaign ON issues(instance_id, campaign_id, status);
```

#### Lifecycle state machine

```
[new finding, no existing issue]        → INSERT status='open'
[finding exists, issue is 'open']       → UPDATE last_detected_run/at
[finding exists, issue was 'resolved']  → UPDATE status='regressed', times_regressed++, clear resolved_*
[no finding, issue was 'open']          → UPDATE status='resolved', set resolved_run/at
[no finding, issue was 'resolved']      → no-op
```

`times_regressed` catches the "whack-a-mole" pattern — user fixes something then breaks it again. "Project SALES has regressed 3 times" is a different conversation than "found empty once."

`times_emailed` and `last_emailed_at` denormalized here because the #1 query is "which open issues have been emailed but not fixed?" — avoids a 3-table JOIN every time.

---

### 7. `outreach_emails`

Every email sent through the outreach system. Full audit trail.

```sql
CREATE TABLE outreach_emails (
    email_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER REFERENCES runs(run_id),   -- context run (nullable for manual sends)
    campaign_id     TEXT NOT NULL,
    recipient_login TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    sent_at         TEXT NOT NULL,
    status          TEXT NOT NULL,                      -- 'sent' | 'error'
    error_message   TEXT,
    subject         TEXT NOT NULL,
    channel_id      TEXT,
    sent_by         TEXT                                -- admin who triggered the send
);

CREATE INDEX idx_emails_recipient ON outreach_emails(recipient_login, campaign_id);
CREATE INDEX idx_emails_run ON outreach_emails(run_id);
CREATE INDEX idx_emails_sent_at ON outreach_emails(sent_at);
```

---

### 8. `outreach_email_issues`

Junction table linking each email to the specific issues it addresses. One email about "project sprawl" to user X might cover 5 projects — each project is a separate issue.

```sql
CREATE TABLE outreach_email_issues (
    email_id    INTEGER NOT NULL REFERENCES outreach_emails(email_id),
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    PRIMARY KEY (email_id, issue_id)
);

CREATE INDEX idx_email_issues_issue ON outreach_email_issues(issue_id);
```

When project #3 gets resolved but #4 doesn't, you need to know exactly which issues were covered by which email.

---

### 9. `known_users`

User registry across runs. Enables "user X was disabled between run 5 and run 6" detection.

```sql
CREATE TABLE known_users (
    instance_id     TEXT NOT NULL REFERENCES instances(instance_id),
    login           TEXT NOT NULL,
    email           TEXT,
    display_name    TEXT,
    user_profile    TEXT,                     -- 'DESIGNER', 'ANALYST', 'DATA_SCIENTIST', etc.
    enabled         INTEGER NOT NULL DEFAULT 1,
    first_seen_run  INTEGER NOT NULL REFERENCES runs(run_id),
    last_seen_run   INTEGER NOT NULL REFERENCES runs(run_id),
    PRIMARY KEY (instance_id, login)
);
```

Without this, you can't distinguish "user deleted their account" from "user fixed their issues." Also essential for the `disabled_user` campaign.

---

### 10. `known_projects`

Project registry across runs. Enables "project was deleted" detection.

```sql
CREATE TABLE known_projects (
    instance_id     TEXT NOT NULL REFERENCES instances(instance_id),
    project_key     TEXT NOT NULL,
    name            TEXT,
    owner_login     TEXT,
    first_seen_run  INTEGER NOT NULL REFERENCES runs(run_id),
    last_seen_run   INTEGER NOT NULL REFERENCES runs(run_id),
    PRIMARY KEY (instance_id, project_key)
);
```

**Critical for the core use case**: when `known_projects.last_seen_run < current_run`, the project was deleted. Combined with `issues`, this produces: "Project SALES: empty_project issue resolved — project deleted between run 6 and run 7."

---

### 11. `issue_notes`

Manual annotations by admins. "Spoke to John, he'll clean up by Friday."

```sql
CREATE TABLE issue_notes (
    note_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    created_at  TEXT NOT NULL,
    created_by  TEXT,
    note        TEXT NOT NULL
);

CREATE INDEX idx_notes_issue ON issue_notes(issue_id);
```

---

## Views

### User compliance overview

"Show me all users, their open issues, and email history."

```sql
CREATE VIEW v_user_compliance AS
SELECT
    i.owner_login,
    i.owner_email,
    i.campaign_id,
    COUNT(CASE WHEN i.status = 'open' THEN 1 END)     AS open_issues,
    COUNT(CASE WHEN i.status = 'resolved' THEN 1 END)  AS resolved_issues,
    COUNT(CASE WHEN i.status = 'regressed' THEN 1 END) AS regressed_issues,
    SUM(i.times_emailed)                                AS total_emails_sent,
    MAX(i.last_emailed_at)                              AS last_emailed,
    MIN(i.first_detected_at)                            AS earliest_issue
FROM issues i
GROUP BY i.owner_login, i.campaign_id;
```

### Stale outreach

"Issues that were emailed but never fixed."

```sql
CREATE VIEW v_stale_outreach AS
SELECT
    i.issue_id,
    i.campaign_id,
    i.entity_type,
    i.entity_key,
    i.owner_login,
    i.owner_email,
    i.first_detected_at,
    i.times_emailed,
    i.last_emailed_at,
    CAST(julianday('now') - julianday(i.last_emailed_at) AS INTEGER) AS days_since_email,
    CAST(julianday('now') - julianday(i.first_detected_at) AS INTEGER) AS days_open
FROM issues i
WHERE i.status IN ('open', 'regressed')
  AND i.times_emailed > 0
ORDER BY days_since_email DESC;
```

### Run-over-run deltas

"What changed between two consecutive runs?"

```sql
CREATE VIEW v_run_deltas AS
SELECT
    r.run_id,
    r.run_at,
    r.instance_id,
    rcs.campaign_id,
    rcs.finding_count,
    LAG(rcs.finding_count) OVER (
        PARTITION BY r.instance_id, rcs.campaign_id
        ORDER BY r.run_id
    ) AS prev_finding_count,
    rcs.finding_count - COALESCE(LAG(rcs.finding_count) OVER (
        PARTITION BY r.instance_id, rcs.campaign_id
        ORDER BY r.run_id
    ), 0) AS delta
FROM runs r
JOIN run_campaign_summaries rcs ON r.run_id = rcs.run_id;
```

---

## Run Ingestion Algorithm

How findings from a new run get processed — the lifecycle engine:

```
PROCEDURE ingest_run(instance_id, run_data, findings[]):

  1. UPSERT instances (update last_seen_at)

  2. INSERT INTO runs (...)  →  get new run_id
     INSERT INTO run_health_metrics (...)
     INSERT INTO run_campaign_summaries (...)

  3. UPSERT known_users:
       - UPDATE last_seen_run for users seen in this run
       - INSERT new users not yet in known_users
       - (users NOT seen retain their old last_seen_run — signals deletion)

  4. UPSERT known_projects:
       - UPDATE last_seen_run for projects seen in this run
       - INSERT new projects not yet in known_projects
       - (projects NOT seen retain their old last_seen_run — signals deletion)

  5. FOR EACH finding:
       a. INSERT INTO findings (run_id, campaign_id, entity_type, entity_key, ...)

       b. SELECT issue FROM issues
          WHERE instance_id = ? AND campaign_id = ? AND entity_type = ? AND entity_key = ?

       c. IF no issue exists:
            INSERT issues (status='open', first_detected_run=run_id, first_detected_at=now)
          ELIF issue.status = 'resolved':
            UPDATE issues SET status='regressed', times_regressed=times_regressed+1,
                             last_detected_run=run_id, last_detected_at=now,
                             resolved_run=NULL, resolved_at=NULL
          ELSE: -- status is 'open' or 'regressed'
            UPDATE issues SET last_detected_run=run_id, last_detected_at=now

  6. AUTO-RESOLVE: mark open issues NOT in this run's findings as resolved
     UPDATE issues
        SET status='resolved', resolved_run=run_id, resolved_at=now
      WHERE instance_id = ?
        AND status IN ('open', 'regressed')
        AND (campaign_id, entity_type, entity_key) NOT IN
            (SELECT campaign_id, entity_type, entity_key FROM findings WHERE run_id = ?)
```

---

## Email Send Hook

When `/api/tools/email/send` sends emails, additionally:

```
FOR EACH sent email:
  1. INSERT INTO outreach_emails (run_id, campaign_id, recipient_login, ...)
  2. Look up all open issues for this (recipient_login, campaign_id)
  3. INSERT INTO outreach_email_issues for each
  4. UPDATE issues SET times_emailed = times_emailed + 1, last_emailed_at = now
     WHERE issue_id IN (matched issues)
```

---

## Integration Points

| Existing endpoint | New behavior |
|---|---|
| `GET /api/tools/outreach-data` | After computing, call `ingest_run()` to persist findings |
| `POST /api/tools/email/send` | After sending, record emails + link to issues |
| `GET /api/overview` | Feed `run_health_metrics` |
| `GET /api/users` | Feed `known_users` |
| `GET /api/projects` | Feed `known_projects` |

New endpoints needed:

| Endpoint | Purpose |
|---|---|
| `GET /api/tracking/runs` | List all runs for an instance |
| `GET /api/tracking/runs/:id` | Single run detail with campaign summaries |
| `GET /api/tracking/issues` | List issues with filters (status, campaign, owner) |
| `GET /api/tracking/issues/:id` | Issue detail with finding history + email history + notes |
| `GET /api/tracking/users/:login` | User compliance profile across all campaigns |
| `POST /api/tracking/issues/:id/notes` | Add admin note to an issue |
| `GET /api/tracking/compare/:run1/:run2` | Delta between two runs |
| `GET /api/tracking/dashboard` | Aggregate stats for the tracking dashboard |

---

## Design Rationale

1. **Matches the 13-campaign architecture exactly** — `campaign_id` as discriminator everywhere, `metrics_json` for campaign-specific flexibility, relational columns for cross-campaign queries.

2. **Handles "did they fix it?" directly** — The `issues` lifecycle + `known_projects.last_seen_run` detection gives: "Project deleted," "Code env removed," "Scenario fixed," etc. — no manual tracking needed.

3. **Links outreach to outcomes** — `outreach_emails → outreach_email_issues → issues` gives the complete chain: "We emailed John about 5 empty projects on Jan 15. He deleted 3 by Jan 22. 2 remain open."

4. **Supports run comparison natively** — `run_campaign_summaries` + `run_health_metrics` + `v_run_deltas` give run-over-run comparison without storing full diagnostic snapshots.

5. **Handles regression** — `times_regressed` catches users who "fix" issues then recreate them. `regressed` status is distinct from `open` for escalation.

6. **Entity granularity matches outreach granularity** — Projects for 12 campaigns, code_envs for 1. Mirrors exactly how the email system groups recipients.

7. **Denormalized where it matters** — `times_emailed`/`last_emailed_at` on `issues` avoids a 3-table JOIN for the most common query. `run_campaign_summaries` avoids `GROUP BY` scans for dashboards.

8. **Plugs into existing code naturally** — `/api/tools/email/send` already returns per-recipient results; adding `INSERT INTO outreach_emails` is minimal. `/api/tools/outreach-data` already computes all findings; adding `INSERT INTO findings` at the end is straightforward.
