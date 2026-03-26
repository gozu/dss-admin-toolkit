"""
Tracking database for diagnostic run persistence, issue lifecycle management,
and outreach audit trail.

SQLite-backed, WAL mode, single connection with threading lock.
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# Section-to-campaign dependency mapping.
# Auto-resolution for a campaign is only safe when ALL its required sections
# completed successfully.
CAMPAIGN_REQUIRED_SECTIONS: Dict[str, List[str]] = {
    'project': ['projects', 'project_footprint', 'code_envs'],
    'code_env': ['projects', 'code_envs'],
    'code_studio': ['projects', 'project_footprint'],
    'auto_scenario': ['projects', 'scenarios'],
    'scenario_frequency': ['projects', 'scenarios'],
    'scenario_failing': ['projects', 'scenarios'],
    'disabled_user': ['projects', 'users', 'project_footprint'],
    'deprecated_code_env': ['code_envs'],
    'default_code_env': ['projects', 'code_envs'],
    'empty_project': ['projects', 'project_footprint'],
    'large_flow': ['projects', 'project_footprint'],
    'orphan_notebooks': ['projects', 'project_footprint'],
    'overshared_project': ['projects'],
    'inactive_project': ['projects'],
    'unused_code_env': ['code_envs'],
}

_SCHEMA_V1 = """
CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
    instance_id     TEXT PRIMARY KEY,
    instance_url    TEXT NOT NULL,
    install_id      TEXT,
    node_id         TEXT,
    company_name    TEXT,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    run_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id         TEXT NOT NULL REFERENCES instances(instance_id),
    run_at              TEXT NOT NULL,
    dss_version         TEXT,
    python_version      TEXT,
    health_score        REAL,
    health_status       TEXT,
    user_count          INTEGER,
    enabled_user_count  INTEGER,
    project_count       INTEGER,
    code_env_count      INTEGER,
    plugin_count        INTEGER,
    connection_count    INTEGER,
    cluster_count       INTEGER,
    coverage_status     TEXT NOT NULL DEFAULT 'complete',
    notes               TEXT
);

CREATE TABLE IF NOT EXISTS run_health_metrics (
    run_id                      INTEGER PRIMARY KEY REFERENCES runs(run_id),
    cpu_cores                   INTEGER,
    memory_total_mb             INTEGER,
    memory_used_mb              INTEGER,
    memory_available_mb         INTEGER,
    swap_total_mb               INTEGER,
    swap_used_mb                INTEGER,
    max_filesystem_pct          REAL,
    max_filesystem_mount        TEXT,
    backend_heap_mb             INTEGER,
    jek_heap_mb                 INTEGER,
    fek_heap_mb                 INTEGER,
    open_files_limit            INTEGER,
    version_currency_score      REAL,
    system_capacity_score       REAL,
    configuration_score         REAL,
    security_isolation_score    REAL,
    license_named_users_pct         REAL,
    license_concurrent_users_pct    REAL,
    license_projects_pct            REAL,
    license_connections_pct         REAL,
    license_expiry_date             TEXT
);

CREATE TABLE IF NOT EXISTS run_campaign_summaries (
    run_id          INTEGER NOT NULL REFERENCES runs(run_id),
    campaign_id     TEXT NOT NULL,
    finding_count   INTEGER NOT NULL,
    recipient_count INTEGER NOT NULL,
    PRIMARY KEY (run_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS run_sections (
    run_id          INTEGER NOT NULL REFERENCES runs(run_id),
    section_key     TEXT NOT NULL,
    status          TEXT NOT NULL,
    is_complete     INTEGER NOT NULL DEFAULT 1,
    error_message   TEXT,
    PRIMARY KEY (run_id, section_key)
);

CREATE TABLE IF NOT EXISTS findings (
    finding_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES runs(run_id),
    campaign_id     TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_key      TEXT NOT NULL,
    entity_name     TEXT,
    owner_login     TEXT NOT NULL,
    owner_email     TEXT,
    metrics_json    TEXT,
    UNIQUE(run_id, campaign_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_findings_run_campaign ON findings(run_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_findings_entity ON findings(campaign_id, entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_findings_owner ON findings(owner_login);

CREATE TABLE IF NOT EXISTS issues (
    issue_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id         TEXT NOT NULL REFERENCES instances(instance_id),
    campaign_id         TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_key          TEXT NOT NULL,
    owner_login         TEXT NOT NULL,
    owner_email         TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    first_detected_run  INTEGER NOT NULL REFERENCES runs(run_id),
    first_detected_at   TEXT NOT NULL,
    last_detected_run   INTEGER REFERENCES runs(run_id),
    last_detected_at    TEXT,
    resolved_run        INTEGER REFERENCES runs(run_id),
    resolved_at         TEXT,
    resolution_reason   TEXT,
    times_regressed     INTEGER NOT NULL DEFAULT 0,
    times_emailed       INTEGER NOT NULL DEFAULT 0,
    last_emailed_at     TEXT,
    UNIQUE(instance_id, campaign_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(instance_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_owner ON issues(owner_login, status);
CREATE INDEX IF NOT EXISTS idx_issues_campaign ON issues(instance_id, campaign_id, status);

CREATE TABLE IF NOT EXISTS outreach_emails (
    email_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER REFERENCES runs(run_id),
    campaign_id     TEXT NOT NULL,
    recipient_login TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    sent_at         TEXT NOT NULL,
    status          TEXT NOT NULL,
    error_message   TEXT,
    subject         TEXT NOT NULL,
    channel_id      TEXT,
    sent_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_emails_recipient ON outreach_emails(recipient_login, campaign_id);
CREATE INDEX IF NOT EXISTS idx_emails_run ON outreach_emails(run_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON outreach_emails(sent_at);

CREATE TABLE IF NOT EXISTS outreach_email_issues (
    email_id    INTEGER NOT NULL REFERENCES outreach_emails(email_id),
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    PRIMARY KEY (email_id, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_email_issues_issue ON outreach_email_issues(issue_id);

CREATE TABLE IF NOT EXISTS known_users (
    instance_id     TEXT NOT NULL REFERENCES instances(instance_id),
    login           TEXT NOT NULL,
    email           TEXT,
    display_name    TEXT,
    user_profile    TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    first_seen_run  INTEGER NOT NULL REFERENCES runs(run_id),
    last_seen_run   INTEGER NOT NULL REFERENCES runs(run_id),
    PRIMARY KEY (instance_id, login)
);

CREATE TABLE IF NOT EXISTS known_projects (
    instance_id     TEXT NOT NULL REFERENCES instances(instance_id),
    project_key     TEXT NOT NULL,
    name            TEXT,
    owner_login     TEXT,
    first_seen_run  INTEGER NOT NULL REFERENCES runs(run_id),
    last_seen_run   INTEGER NOT NULL REFERENCES runs(run_id),
    PRIMARY KEY (instance_id, project_key)
);

CREATE TABLE IF NOT EXISTS issue_notes (
    note_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    created_at  TEXT NOT NULL,
    created_by  TEXT,
    note        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_issue ON issue_notes(issue_id);

-- Views

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, datetime('now'));

CREATE VIEW IF NOT EXISTS v_user_compliance AS
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

CREATE VIEW IF NOT EXISTS v_stale_outreach AS
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

CREATE VIEW IF NOT EXISTS v_run_deltas AS
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

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
"""

_SCHEMA_V2 = [
    "ALTER TABLE issues ADD COLUMN entity_name TEXT",
    "ALTER TABLE issues ADD COLUMN metrics_json TEXT",
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, datetime('now'))",
]

_SCHEMA_V3 = [
    """CREATE TABLE IF NOT EXISTS campaign_settings (
        campaign_id TEXT PRIMARY KEY,
        enabled     INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT NOT NULL
    )""",
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, datetime('now'))",
]

_SCHEMA_V6 = [
    """CREATE TABLE IF NOT EXISTS user_snapshots (
        run_id       INTEGER NOT NULL REFERENCES runs(run_id),
        instance_id  TEXT NOT NULL,
        login        TEXT NOT NULL,
        display_name TEXT,
        email        TEXT,
        user_profile TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (run_id, instance_id, login)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_user_snapshots_instance_run ON user_snapshots(instance_id, run_id)",
    """CREATE TABLE IF NOT EXISTS project_snapshots (
        run_id       INTEGER NOT NULL REFERENCES runs(run_id),
        instance_id  TEXT NOT NULL,
        project_key  TEXT NOT NULL,
        name         TEXT,
        owner_login  TEXT,
        PRIMARY KEY (run_id, instance_id, project_key)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_project_snapshots_instance_run ON project_snapshots(instance_id, run_id)",
    """CREATE TABLE IF NOT EXISTS run_plugins (
        run_id    INTEGER NOT NULL REFERENCES runs(run_id),
        plugin_id TEXT NOT NULL,
        label     TEXT,
        version   TEXT,
        is_dev    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, plugin_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_run_plugins_plugin ON run_plugins(plugin_id)",
    """CREATE TABLE IF NOT EXISTS run_connections (
        run_id          INTEGER NOT NULL REFERENCES runs(run_id),
        connection_name TEXT NOT NULL,
        connection_type TEXT,
        PRIMARY KEY (run_id, connection_name)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_run_connections_type ON run_connections(connection_type)",
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (6, datetime('now'))",
]

_SCHEMA_V4 = [
    """CREATE TABLE IF NOT EXISTS campaign_exemptions (
        exemption_id  INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id   TEXT NOT NULL,
        entity_type   TEXT NOT NULL DEFAULT 'project',
        entity_key    TEXT NOT NULL,
        reason        TEXT,
        created_at    TEXT NOT NULL,
        UNIQUE(campaign_id, entity_type, entity_key)
    )""",
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (4, datetime('now'))",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class TrackingDB:
    """SQLite-backed tracking database for diagnostic runs and issue lifecycles."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._lock = threading.Lock()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                self._db_path,
                check_same_thread=False,
                timeout=30,
            )
            self._conn.execute('PRAGMA journal_mode=WAL')
            self._conn.execute('PRAGMA foreign_keys=ON')
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(_SCHEMA_V1)
            # V2 migration: add entity_name + metrics_json to issues
            v = self._conn.execute('SELECT MAX(version) FROM schema_version').fetchone()[0] or 1
            if v < 2:
                for stmt in _SCHEMA_V2:
                    try:
                        self._conn.execute(stmt)
                    except Exception:
                        pass  # column may already exist
                self._conn.commit()
            # V3 migration: campaign_settings table
            v = self._conn.execute('SELECT MAX(version) FROM schema_version').fetchone()[0] or 1
            if v < 3:
                for stmt in _SCHEMA_V3:
                    try:
                        self._conn.execute(stmt)
                    except Exception:
                        pass  # table may already exist
                self._conn.commit()
            # V4 migration: campaign_exemptions table
            v = self._conn.execute('SELECT MAX(version) FROM schema_version').fetchone()[0] or 1
            if v < 4:
                for stmt in _SCHEMA_V4:
                    try:
                        self._conn.execute(stmt)
                    except Exception:
                        pass  # table may already exist
                self._conn.commit()
            # V6 migration: over-time snapshot tables
            v = self._conn.execute('SELECT MAX(version) FROM schema_version').fetchone()[0] or 1
            if v < 6:
                for stmt in _SCHEMA_V6:
                    try:
                        self._conn.execute(stmt)
                    except Exception:
                        pass  # table/index may already exist
                self._conn.commit()
        return self._conn

    # ------------------------------------------------------------------
    # ingest_run — the core lifecycle engine
    # ------------------------------------------------------------------

    def ingest_run(
        self,
        instance_id: str,
        instance_url: str,
        install_id: Optional[str],
        node_id: Optional[str],
        run_data: Dict[str, Any],
        findings: List[Dict[str, Any]],
        users: List[Dict[str, Any]],
        projects: List[Dict[str, Any]],
        sections: Dict[str, Dict[str, Any]],
        health_metrics: Optional[Dict[str, Any]] = None,
        campaign_summaries: Optional[List[Dict[str, Any]]] = None,
        snapshot_data: Optional[Dict[str, Any]] = None,
    ) -> int:
        """Ingest a complete run. Returns the new run_id."""
        now = _now_iso()

        with self._lock:
            conn = self._get_conn()
            conn.execute('BEGIN IMMEDIATE')
            try:
                # 1. UPSERT instance
                conn.execute(
                    """INSERT INTO instances (instance_id, instance_url, install_id, node_id, first_seen_at, last_seen_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(instance_id) DO UPDATE SET
                           instance_url = excluded.instance_url,
                           install_id = COALESCE(excluded.install_id, instances.install_id),
                           node_id = COALESCE(excluded.node_id, instances.node_id),
                           last_seen_at = excluded.last_seen_at""",
                    (instance_id, instance_url, install_id, node_id, now, now),
                )

                # 2. INSERT run
                cur = conn.execute(
                    """INSERT INTO runs (instance_id, run_at, dss_version, python_version,
                           health_score, health_status, user_count, enabled_user_count,
                           project_count, code_env_count, plugin_count, connection_count,
                           cluster_count, coverage_status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        instance_id,
                        now,
                        run_data.get('dss_version'),
                        run_data.get('python_version'),
                        run_data.get('health_score'),
                        run_data.get('health_status'),
                        run_data.get('user_count'),
                        run_data.get('enabled_user_count'),
                        run_data.get('project_count'),
                        run_data.get('code_env_count'),
                        run_data.get('plugin_count'),
                        run_data.get('connection_count'),
                        run_data.get('cluster_count'),
                        run_data.get('coverage_status', 'complete'),
                    ),
                )
                run_id = cur.lastrowid

                # 3. INSERT run_health_metrics
                if health_metrics:
                    conn.execute(
                        """INSERT INTO run_health_metrics (
                               run_id, cpu_cores, memory_total_mb, memory_used_mb,
                               memory_available_mb, swap_total_mb, swap_used_mb,
                               max_filesystem_pct, max_filesystem_mount,
                               backend_heap_mb, jek_heap_mb, fek_heap_mb,
                               open_files_limit,
                               version_currency_score, system_capacity_score,
                               configuration_score, security_isolation_score,
                               license_named_users_pct, license_concurrent_users_pct,
                               license_projects_pct, license_connections_pct,
                               license_expiry_date)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            run_id,
                            health_metrics.get('cpu_cores'),
                            health_metrics.get('memory_total_mb'),
                            health_metrics.get('memory_used_mb'),
                            health_metrics.get('memory_available_mb'),
                            health_metrics.get('swap_total_mb'),
                            health_metrics.get('swap_used_mb'),
                            health_metrics.get('max_filesystem_pct'),
                            health_metrics.get('max_filesystem_mount'),
                            health_metrics.get('backend_heap_mb'),
                            health_metrics.get('jek_heap_mb'),
                            health_metrics.get('fek_heap_mb'),
                            health_metrics.get('open_files_limit'),
                            health_metrics.get('version_currency_score'),
                            health_metrics.get('system_capacity_score'),
                            health_metrics.get('configuration_score'),
                            health_metrics.get('security_isolation_score'),
                            health_metrics.get('license_named_users_pct'),
                            health_metrics.get('license_concurrent_users_pct'),
                            health_metrics.get('license_projects_pct'),
                            health_metrics.get('license_connections_pct'),
                            health_metrics.get('license_expiry_date'),
                        ),
                    )

                # 4. INSERT run_campaign_summaries
                if campaign_summaries:
                    for cs in campaign_summaries:
                        conn.execute(
                            """INSERT INTO run_campaign_summaries (run_id, campaign_id, finding_count, recipient_count)
                               VALUES (?, ?, ?, ?)""",
                            (run_id, cs['campaign_id'], cs['finding_count'], cs['recipient_count']),
                        )

                # 5. UPSERT known_users
                for user in users:
                    login = user.get('login')
                    if not login:
                        continue
                    conn.execute(
                        """INSERT INTO known_users (instance_id, login, email, display_name, user_profile, enabled, first_seen_run, last_seen_run)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(instance_id, login) DO UPDATE SET
                               email = COALESCE(excluded.email, known_users.email),
                               display_name = COALESCE(excluded.display_name, known_users.display_name),
                               user_profile = COALESCE(excluded.user_profile, known_users.user_profile),
                               enabled = excluded.enabled,
                               last_seen_run = excluded.last_seen_run""",
                        (
                            instance_id,
                            login,
                            user.get('email'),
                            user.get('display_name') or user.get('displayName'),
                            user.get('user_profile') or user.get('userProfile'),
                            1 if user.get('enabled', True) else 0,
                            run_id,
                            run_id,
                        ),
                    )

                # 6. UPSERT known_projects
                for proj in projects:
                    pkey = proj.get('project_key') or proj.get('projectKey')
                    if not pkey:
                        continue
                    conn.execute(
                        """INSERT INTO known_projects (instance_id, project_key, name, owner_login, first_seen_run, last_seen_run)
                           VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(instance_id, project_key) DO UPDATE SET
                               name = COALESCE(excluded.name, known_projects.name),
                               owner_login = COALESCE(excluded.owner_login, known_projects.owner_login),
                               last_seen_run = excluded.last_seen_run""",
                        (
                            instance_id,
                            pkey,
                            proj.get('name'),
                            proj.get('owner') or proj.get('owner_login'),
                            run_id,
                            run_id,
                        ),
                    )

                # 6a. INSERT user_snapshots (per-run roster for over-time tracking)
                for user in users:
                    login = user.get('login')
                    if not login:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO user_snapshots
                               (run_id, instance_id, login, display_name, email, user_profile, enabled)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (run_id, instance_id, login,
                         user.get('display_name') or user.get('displayName'),
                         user.get('email'),
                         user.get('user_profile') or user.get('userProfile'),
                         1 if user.get('enabled', True) else 0),
                    )

                # 6b. INSERT project_snapshots (per-run roster for over-time tracking)
                for proj in projects:
                    pkey = proj.get('project_key') or proj.get('projectKey')
                    if not pkey:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO project_snapshots
                               (run_id, instance_id, project_key, name, owner_login)
                           VALUES (?, ?, ?, ?, ?)""",
                        (run_id, instance_id, pkey,
                         proj.get('name'),
                         proj.get('owner') or proj.get('owner_login')),
                    )

                # 6c. INSERT run_plugins (normalized from snapshot_data)
                snap = snapshot_data or {}
                for plugin in (snap.get('plugins') or []):
                    if not isinstance(plugin, dict):
                        continue
                    pid = plugin.get('id')
                    if not pid:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO run_plugins
                               (run_id, plugin_id, label, version, is_dev)
                           VALUES (?, ?, ?, ?, ?)""",
                        (run_id, pid, plugin.get('label'),
                         plugin.get('installedVersion'),
                         1 if plugin.get('isDev') else 0),
                    )

                # 6d. INSERT run_connections (normalized from snapshot_data)
                snap_conns = snap.get('connections')
                conn_details = (snap_conns.get('details') or []) if isinstance(snap_conns, dict) else []
                for c in conn_details:
                    if not isinstance(c, dict):
                        continue
                    cname = c.get('name')
                    if not cname:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO run_connections
                               (run_id, connection_name, connection_type)
                           VALUES (?, ?, ?)""",
                        (run_id, cname, c.get('type')),
                    )

                # 7. INSERT findings + lifecycle issues
                finding_keys_this_run = set()  # (campaign_id, entity_type, entity_key)
                entities_this_run = set()      # (entity_type, entity_key)
                for f in findings:
                    campaign_id = f.get('campaign_id', '')
                    entity_type = f.get('entity_type', '')
                    entity_key = f.get('entity_key', '')
                    owner_login = f.get('owner_login', '')
                    if not campaign_id or not entity_key or not owner_login:
                        continue

                    finding_keys_this_run.add((campaign_id, entity_type, entity_key))
                    entities_this_run.add((entity_type, entity_key))

                    metrics = f.get('metrics_json')
                    if isinstance(metrics, dict):
                        metrics = json.dumps(metrics)

                    conn.execute(
                        """INSERT OR IGNORE INTO findings
                               (run_id, campaign_id, entity_type, entity_key, entity_name, owner_login, owner_email, metrics_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (run_id, campaign_id, entity_type, entity_key,
                         f.get('entity_name'), owner_login, f.get('owner_email'), metrics),
                    )

                    # Issue lifecycle
                    row = conn.execute(
                        """SELECT issue_id, status FROM issues
                           WHERE instance_id = ? AND campaign_id = ? AND entity_type = ? AND entity_key = ?""",
                        (instance_id, campaign_id, entity_type, entity_key),
                    ).fetchone()

                    if row is None:
                        conn.execute(
                            """INSERT INTO issues
                                   (instance_id, campaign_id, entity_type, entity_key,
                                    owner_login, owner_email, status,
                                    first_detected_run, first_detected_at,
                                    last_detected_run, last_detected_at,
                                    entity_name, metrics_json)
                               VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)""",
                            (instance_id, campaign_id, entity_type, entity_key,
                             owner_login, f.get('owner_email'),
                             run_id, now, run_id, now,
                             f.get('entity_name'), metrics),
                        )
                    elif row['status'] == 'resolved':
                        conn.execute(
                            """UPDATE issues SET
                                   status = 'regressed',
                                   times_regressed = times_regressed + 1,
                                   last_detected_run = ?,
                                   last_detected_at = ?,
                                   resolved_run = NULL,
                                   resolved_at = NULL,
                                   resolution_reason = NULL,
                                   owner_login = ?,
                                   owner_email = ?,
                                   entity_name = ?,
                                   metrics_json = ?
                               WHERE issue_id = ?""",
                            (run_id, now, owner_login, f.get('owner_email'),
                             f.get('entity_name'), metrics, row['issue_id']),
                        )
                    else:
                        conn.execute(
                            """UPDATE issues SET
                                   last_detected_run = ?,
                                   last_detected_at = ?,
                                   owner_login = ?,
                                   owner_email = ?,
                                   entity_name = ?,
                                   metrics_json = ?
                               WHERE issue_id = ?""",
                            (run_id, now, owner_login, f.get('owner_email'),
                             f.get('entity_name'), metrics, row['issue_id']),
                        )

                # 8. INSERT run_sections
                for section_key, sec_info in sections.items():
                    sec_status = sec_info.get('status', 'success')
                    is_complete = 1 if sec_status == 'success' else 0
                    conn.execute(
                        """INSERT OR IGNORE INTO run_sections (run_id, section_key, status, is_complete, error_message)
                           VALUES (?, ?, ?, ?, ?)""",
                        (run_id, section_key, sec_status, is_complete, sec_info.get('error_message')),
                    )

                # Update coverage_status based on section results
                all_statuses = [s.get('status', 'success') for s in sections.values()]
                if all(s == 'success' for s in all_statuses):
                    coverage = 'complete'
                elif any(s == 'error' for s in all_statuses):
                    coverage = 'failed'
                else:
                    coverage = 'partial'
                conn.execute(
                    'UPDATE runs SET coverage_status = ? WHERE run_id = ?',
                    (coverage, run_id),
                )

                # 9. Coverage-gated auto-resolve
                # Build set of safe campaigns
                complete_sections = set()
                for section_key, sec_info in sections.items():
                    if sec_info.get('status') == 'success':
                        complete_sections.add(section_key)

                safe_campaigns = set()
                for campaign_id, required in CAMPAIGN_REQUIRED_SECTIONS.items():
                    if all(s in complete_sections for s in required):
                        safe_campaigns.add(campaign_id)

                if safe_campaigns:
                    placeholders = ','.join('?' * len(safe_campaigns))
                    open_issues = conn.execute(
                        f"""SELECT issue_id, campaign_id, entity_type, entity_key
                            FROM issues
                            WHERE instance_id = ?
                              AND status IN ('open', 'regressed')
                              AND campaign_id IN ({placeholders})""",
                        [instance_id] + sorted(safe_campaigns),
                    ).fetchall()

                    for issue in open_issues:
                        key = (issue['campaign_id'], issue['entity_type'], issue['entity_key'])
                        if key in finding_keys_this_run:
                            continue  # still present, don't resolve

                        # Determine resolution reason: if the entity still
                        # appears in any finding this run → whitelisted (condition
                        # cleared); otherwise → deleted (entity gone).
                        etype = issue['entity_type']
                        ekey = issue['entity_key']
                        if (etype, ekey) in entities_this_run:
                            reason = 'condition_cleared'
                        else:
                            reason = 'entity_deleted'

                        conn.execute(
                            """UPDATE issues SET
                                   status = 'resolved',
                                   resolved_run = ?,
                                   resolved_at = ?,
                                   resolution_reason = ?
                               WHERE issue_id = ?""",
                            (run_id, now, reason, issue['issue_id']),
                        )

                conn.commit()
                return run_id

            except Exception:
                conn.rollback()
                raise

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def list_runs(self, instance_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            if instance_id:
                rows = conn.execute(
                    'SELECT * FROM runs WHERE instance_id = ? ORDER BY run_id DESC LIMIT ? OFFSET ?',
                    (instance_id, limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    'SELECT * FROM runs ORDER BY run_id DESC LIMIT ? OFFSET ?',
                    (limit, offset),
                ).fetchall()
            return [dict(r) for r in rows]

    def get_run(self, run_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute('SELECT * FROM runs WHERE run_id = ?', (run_id,)).fetchone()
            if not row:
                return None
            result = dict(row)

            # Campaign summaries
            summaries = conn.execute(
                'SELECT * FROM run_campaign_summaries WHERE run_id = ?', (run_id,),
            ).fetchall()
            result['campaign_summaries'] = [dict(s) for s in summaries]

            # Health metrics
            hm = conn.execute(
                'SELECT * FROM run_health_metrics WHERE run_id = ?', (run_id,),
            ).fetchone()
            result['health_metrics'] = dict(hm) if hm else None

            # Sections
            secs = conn.execute(
                'SELECT * FROM run_sections WHERE run_id = ?', (run_id,),
            ).fetchall()
            result['sections'] = [dict(s) for s in secs]

            return result

    def list_issues(
        self,
        instance_id: Optional[str] = None,
        status: Optional[str] = None,
        campaign_id: Optional[str] = None,
        owner_login: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            conditions = []
            params: list = []
            if instance_id:
                conditions.append('instance_id = ?')
                params.append(instance_id)
            if status:
                conditions.append('status = ?')
                params.append(status)
            if campaign_id:
                conditions.append('campaign_id = ?')
                params.append(campaign_id)
            if owner_login:
                conditions.append('owner_login = ?')
                params.append(owner_login)

            where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''
            params.extend([limit, offset])
            rows = conn.execute(
                f'SELECT * FROM issues{where} ORDER BY issue_id DESC LIMIT ? OFFSET ?',
                params,
            ).fetchall()
            results = []
            for r in rows:
                d = dict(r)
                if d.get('metrics_json'):
                    try:
                        d['metrics_json'] = json.loads(d['metrics_json'])
                    except (json.JSONDecodeError, TypeError):
                        pass
                results.append(d)
            return results

    def get_issue(self, issue_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute('SELECT * FROM issues WHERE issue_id = ?', (issue_id,)).fetchone()
            if not row:
                return None
            result = dict(row)

            # Finding history
            findings = conn.execute(
                """SELECT f.* FROM findings f
                   WHERE f.campaign_id = ? AND f.entity_type = ? AND f.entity_key = ?
                   ORDER BY f.run_id DESC""",
                (row['campaign_id'], row['entity_type'], row['entity_key']),
            ).fetchall()
            result['finding_history'] = [dict(f) for f in findings]

            # Email history
            emails = conn.execute(
                """SELECT oe.* FROM outreach_emails oe
                   JOIN outreach_email_issues oei ON oe.email_id = oei.email_id
                   WHERE oei.issue_id = ?
                   ORDER BY oe.sent_at DESC""",
                (issue_id,),
            ).fetchall()
            result['email_history'] = [dict(e) for e in emails]

            # Notes
            notes = conn.execute(
                'SELECT * FROM issue_notes WHERE issue_id = ? ORDER BY created_at DESC',
                (issue_id,),
            ).fetchall()
            result['notes'] = [dict(n) for n in notes]

            return result

    def list_all_user_compliance(self, instance_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            if instance_id:
                rows = conn.execute(
                    'SELECT * FROM v_user_compliance WHERE owner_login IN '
                    '(SELECT DISTINCT owner_login FROM issues WHERE instance_id = ?)',
                    (instance_id,),
                ).fetchall()
            else:
                rows = conn.execute('SELECT * FROM v_user_compliance').fetchall()
            return [dict(r) for r in rows]

    def get_user_compliance(self, login: str) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                'SELECT * FROM v_user_compliance WHERE owner_login = ?',
                (login,),
            ).fetchall()
            return [dict(r) for r in rows]

    def add_issue_note(self, issue_id: int, note: str, created_by: Optional[str] = None) -> int:
        now = _now_iso()
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                'INSERT INTO issue_notes (issue_id, created_at, created_by, note) VALUES (?, ?, ?, ?)',
                (issue_id, now, created_by, note),
            )
            conn.commit()
            return cur.lastrowid

    def compare_runs(self, run_id_1: int, run_id_2: int) -> Dict[str, Any]:
        with self._lock:
            conn = self._get_conn()
            r1 = conn.execute('SELECT * FROM runs WHERE run_id = ?', (run_id_1,)).fetchone()
            r2 = conn.execute('SELECT * FROM runs WHERE run_id = ?', (run_id_2,)).fetchone()
            if not r1 or not r2:
                return {'error': 'One or both runs not found'}

            # Campaign summaries for both
            s1 = conn.execute(
                'SELECT campaign_id, finding_count, recipient_count FROM run_campaign_summaries WHERE run_id = ?',
                (run_id_1,),
            ).fetchall()
            s2 = conn.execute(
                'SELECT campaign_id, finding_count, recipient_count FROM run_campaign_summaries WHERE run_id = ?',
                (run_id_2,),
            ).fetchall()

            map1 = {r['campaign_id']: dict(r) for r in s1}
            map2 = {r['campaign_id']: dict(r) for r in s2}
            all_campaigns = sorted(set(list(map1.keys()) + list(map2.keys())))

            deltas = []
            for cid in all_campaigns:
                fc1 = map1.get(cid, {}).get('finding_count', 0)
                fc2 = map2.get(cid, {}).get('finding_count', 0)
                rc1 = map1.get(cid, {}).get('recipient_count', 0)
                rc2 = map2.get(cid, {}).get('recipient_count', 0)
                deltas.append({
                    'campaign_id': cid,
                    'run1_findings': fc1,
                    'run2_findings': fc2,
                    'finding_delta': fc2 - fc1,
                    'run1_recipients': rc1,
                    'run2_recipients': rc2,
                    'recipient_delta': rc2 - rc1,
                })

            # Issues resolved between runs
            resolved = conn.execute(
                """SELECT * FROM issues
                   WHERE resolved_run = ? AND first_detected_run <= ?""",
                (run_id_2, run_id_1),
            ).fetchall()

            # Issues opened between runs
            opened = conn.execute(
                """SELECT * FROM issues
                   WHERE first_detected_run = ?""",
                (run_id_2,),
            ).fetchall()

            # Issues regressed between runs
            regressed = conn.execute(
                """SELECT * FROM issues
                   WHERE status = 'regressed' AND last_detected_run = ?""",
                (run_id_2,),
            ).fetchall()

            return {
                'run1': dict(r1),
                'run2': dict(r2),
                'campaign_deltas': deltas,
                'issues_resolved': [dict(r) for r in resolved],
                'issues_opened': [dict(r) for r in opened],
                'issues_regressed': [dict(r) for r in regressed],
            }

    def get_dashboard(self, instance_id: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            conn = self._get_conn()
            cond = ' WHERE instance_id = ?' if instance_id else ''
            params: list = [instance_id] if instance_id else []

            total_runs = conn.execute(
                f'SELECT COUNT(*) AS cnt FROM runs{cond}', params,
            ).fetchone()['cnt']

            open_issues = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM issues{' WHERE instance_id = ? AND' if instance_id else ' WHERE'} status IN ('open', 'regressed')",
                params,
            ).fetchone()['cnt']

            resolved_issues = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM issues{' WHERE instance_id = ? AND' if instance_id else ' WHERE'} status = 'resolved'",
                params,
            ).fetchone()['cnt']

            total_emails = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM outreach_emails{' WHERE run_id IN (SELECT run_id FROM runs WHERE instance_id = ?)' if instance_id else ''}",
                params,
            ).fetchone()['cnt']

            # By-campaign breakdown
            campaign_cond = ' WHERE instance_id = ?' if instance_id else ''
            campaign_stats = conn.execute(
                f"""SELECT campaign_id,
                       COUNT(CASE WHEN status IN ('open', 'regressed') THEN 1 END) AS open_count,
                       COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS resolved_count,
                       COUNT(*) AS total_count
                    FROM issues{campaign_cond}
                    GROUP BY campaign_id""",
                params,
            ).fetchall()

            # Latest run
            latest_run = conn.execute(
                f'SELECT * FROM runs{cond} ORDER BY run_id DESC LIMIT 1', params,
            ).fetchone()

            # Stale outreach count
            stale = conn.execute(
                'SELECT COUNT(*) AS cnt FROM v_stale_outreach',
            ).fetchone()['cnt']

            return {
                'total_runs': total_runs,
                'open_issues': open_issues,
                'resolved_issues': resolved_issues,
                'total_emails': total_emails,
                'stale_outreach_count': stale,
                'campaign_stats': [dict(r) for r in campaign_stats],
                'latest_run': dict(latest_run) if latest_run else None,
            }

    # ------------------------------------------------------------------
    # Campaign settings (enable/disable toggles)
    # ------------------------------------------------------------------

    def get_campaign_settings(self) -> Dict[str, bool]:
        """Return {campaign_id: enabled} for all rows in campaign_settings."""
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute('SELECT campaign_id, enabled FROM campaign_settings').fetchall()
            return {r['campaign_id']: bool(r['enabled']) for r in rows}

    def set_campaign_enabled(self, campaign_id: str, enabled: bool) -> None:
        """UPSERT a campaign's enabled state."""
        now = _now_iso()
        with self._lock:
            conn = self._get_conn()
            conn.execute(
                """INSERT INTO campaign_settings (campaign_id, enabled, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(campaign_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at""",
                (campaign_id, 1 if enabled else 0, now),
            )
            conn.commit()

    def get_disabled_campaigns(self) -> set:
        """Return set of campaign_ids where enabled=0."""
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute('SELECT campaign_id FROM campaign_settings WHERE enabled = 0').fetchall()
            return {r['campaign_id'] for r in rows}

    # ------------------------------------------------------------------
    # Campaign exemptions
    # ------------------------------------------------------------------

    def get_exemptions(self, campaign_id: str = None) -> list:
        """List all exemptions, optionally filtered by campaign_id."""
        with self._lock:
            conn = self._get_conn()
            if campaign_id:
                rows = conn.execute(
                    'SELECT * FROM campaign_exemptions WHERE campaign_id = ? ORDER BY created_at DESC',
                    (campaign_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    'SELECT * FROM campaign_exemptions ORDER BY created_at DESC',
                ).fetchall()
            return [dict(r) for r in rows]

    def get_exemption_set(self) -> set:
        """Return set of (campaign_id, entity_key) tuples for fast lookup during ingest."""
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute('SELECT campaign_id, entity_key FROM campaign_exemptions').fetchall()
            return {(r['campaign_id'], r['entity_key']) for r in rows}

    def add_exemption(self, campaign_id: str, entity_key: str, reason: str = None) -> dict:
        """Upsert an exemption. Returns the exemption row."""
        now = _now_iso()
        with self._lock:
            conn = self._get_conn()
            conn.execute(
                """INSERT INTO campaign_exemptions (campaign_id, entity_type, entity_key, reason, created_at)
                   VALUES (?, 'project', ?, ?, ?)
                   ON CONFLICT(campaign_id, entity_type, entity_key) DO UPDATE SET
                       reason = excluded.reason,
                       created_at = excluded.created_at""",
                (campaign_id, entity_key, reason, now),
            )
            conn.commit()
            row = conn.execute(
                'SELECT * FROM campaign_exemptions WHERE campaign_id = ? AND entity_key = ?',
                (campaign_id, entity_key),
            ).fetchone()
            return dict(row) if row else {}

    def remove_exemption(self, exemption_id: int) -> bool:
        """Delete an exemption by ID. Returns True if deleted."""
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute('DELETE FROM campaign_exemptions WHERE exemption_id = ?', (exemption_id,))
            conn.commit()
            return cur.rowcount > 0

    def resolve_issue_ids_for_preview(
        self,
        instance_id: str,
        campaign_id: str,
        entity_keys: List[Tuple[str, str]],
    ) -> List[int]:
        """Find open issue IDs matching campaign + entity type/key pairs."""
        if not entity_keys:
            return []
        with self._lock:
            conn = self._get_conn()
            issue_ids = []
            for entity_type, entity_key in entity_keys:
                row = conn.execute(
                    """SELECT issue_id FROM issues
                       WHERE instance_id = ? AND campaign_id = ?
                         AND entity_type = ? AND entity_key = ?
                         AND status IN ('open', 'regressed')""",
                    (instance_id, campaign_id, entity_type, entity_key),
                ).fetchone()
                if row:
                    issue_ids.append(row['issue_id'])
            return issue_ids

    def record_email_send(
        self,
        run_id: Optional[int],
        campaign_id: str,
        recipient_login: str,
        recipient_email: str,
        status: str,
        subject: str,
        linked_issue_ids: List[int],
        error_message: Optional[str] = None,
        channel_id: Optional[str] = None,
        sent_by: Optional[str] = None,
    ) -> Optional[int]:
        now = _now_iso()
        with self._lock:
            conn = self._get_conn()
            try:
                cur = conn.execute(
                    """INSERT INTO outreach_emails
                           (run_id, campaign_id, recipient_login, recipient_email,
                            sent_at, status, error_message, subject, channel_id, sent_by)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (run_id, campaign_id, recipient_login, recipient_email,
                     now, status, error_message, subject, channel_id, sent_by),
                )
                email_id = cur.lastrowid

                if linked_issue_ids and status == 'sent':
                    for iid in linked_issue_ids:
                        conn.execute(
                            'INSERT OR IGNORE INTO outreach_email_issues (email_id, issue_id) VALUES (?, ?)',
                            (email_id, iid),
                        )
                    placeholders = ','.join('?' * len(linked_issue_ids))
                    conn.execute(
                        f"""UPDATE issues SET
                                times_emailed = times_emailed + 1,
                                last_emailed_at = ?
                            WHERE issue_id IN ({placeholders})""",
                        [now] + linked_issue_ids,
                    )

                conn.commit()
                return email_id
            except Exception:
                conn.rollback()
                raise


# ------------------------------------------------------------------
# Finding extraction from outreach data
# ------------------------------------------------------------------

def extract_findings_from_outreach_data(
    data: Dict[str, Any],
    disabled_campaigns: Optional[set] = None,
    exemptions: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Convert outreach-data response into a flat findings list for ingestion.

    Args:
        exemptions: set of (campaign_id, entity_key) tuples to exclude from findings.
    """
    findings: List[Dict[str, Any]] = []

    # campaign → (recipients_key, entity_type, entity_extraction_fn)
    _CAMPAIGN_MAP = {
        'project': ('projectRecipients', 'project', _extract_project_findings),
        'code_env': ('codeEnvRecipients', 'project', _extract_project_findings_code_env),
        'code_studio': ('codeStudioRecipients', 'project', _extract_project_findings_code_studio),
        'auto_scenario': ('autoScenarioRecipients', 'scenario', _extract_scenario_findings),
        'scenario_frequency': ('scenarioFrequencyRecipients', 'scenario', _extract_scenario_findings_freq),
        'scenario_failing': ('scenarioFailingRecipients', 'scenario', _extract_scenario_findings_failing),
        'disabled_user': ('disabledUserRecipients', 'project', _extract_project_findings_disabled),
        'deprecated_code_env': ('deprecatedCodeEnvRecipients', 'code_env', _extract_deprecated_env_findings),
        'default_code_env': ('defaultCodeEnvRecipients', 'project', _extract_project_findings_default_env),
        'empty_project': ('emptyProjectRecipients', 'project', _extract_project_findings_empty),
        'large_flow': ('largeFlowRecipients', 'project', _extract_project_findings_large_flow),
        'orphan_notebooks': ('orphanNotebookRecipients', 'project', _extract_project_findings_orphan),
        'overshared_project': ('oversharedProjectRecipients', 'project', _extract_project_findings_overshared),
        'inactive_project': ('inactiveProjectRecipients', 'project', _extract_inactive_project_findings),
        'unused_code_env': ('unusedCodeEnvRecipients', 'code_env', _extract_unused_code_env_findings),
    }

    for campaign_id, (recipients_key, entity_type, extractor) in _CAMPAIGN_MAP.items():
        if disabled_campaigns and campaign_id in disabled_campaigns:
            continue
        recipients = data.get(recipients_key) or []
        for recipient in recipients:
            if not isinstance(recipient, dict):
                continue
            owner = str(recipient.get('owner') or recipient.get('recipientKey') or '')
            email = str(recipient.get('email') or owner)
            extracted = extractor(recipient, campaign_id, entity_type, owner, email)
            if exemptions:
                extracted = [f for f in extracted if (f['campaign_id'], f['entity_key']) not in exemptions]
            findings.extend(extracted)

    return findings


def _extract_project_findings(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'codeEnvCount': proj.get('codeEnvCount'), 'totalGB': proj.get('totalGB')},
        })
    return results


def _extract_project_findings_code_env(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'mismatchedEnvCount': proj.get('mismatchedCodeEnvCount')},
        })
    return results


def _extract_project_findings_code_studio(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'codeStudioCount': proj.get('codeStudioCount'), 'totalGB': proj.get('totalGB')},
        })
    return results


def _extract_scenario_findings(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        for sc in (proj.get('autoScenarios') or []):
            if not isinstance(sc, dict):
                continue
            sc_id = str(sc.get('id') or '')
            if not pkey or not sc_id:
                continue
            results.append({
                'campaign_id': campaign_id,
                'entity_type': entity_type,
                'entity_key': f'{pkey}:{sc_id}',
                'entity_name': sc.get('name'),
                'owner_login': owner,
                'owner_email': email,
                'metrics_json': {
                    'name': sc.get('name'),
                    'type': sc.get('type'),
                    'triggerCount': sc.get('triggerCount'),
                },
            })
    return results


def _extract_scenario_findings_freq(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        for sc in (proj.get('autoScenarios') or []):
            if not isinstance(sc, dict):
                continue
            sc_id = str(sc.get('id') or '')
            if not pkey or not sc_id:
                continue
            results.append({
                'campaign_id': campaign_id,
                'entity_type': entity_type,
                'entity_key': f'{pkey}:{sc_id}',
                'entity_name': sc.get('name'),
                'owner_login': owner,
                'owner_email': email,
                'metrics_json': {
                    'minTriggerMinutes': sc.get('minTriggerMinutes'),
                    'triggerType': sc.get('type'),
                },
            })
    return results


def _extract_scenario_findings_failing(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        for sc in (proj.get('autoScenarios') or []):
            if not isinstance(sc, dict):
                continue
            sc_id = str(sc.get('id') or '')
            if not pkey or not sc_id:
                continue
            results.append({
                'campaign_id': campaign_id,
                'entity_type': entity_type,
                'entity_key': f'{pkey}:{sc_id}',
                'entity_name': sc.get('name'),
                'owner_login': owner,
                'owner_email': email,
                'metrics_json': {
                    'lastOutcome': sc.get('lastOutcome'),
                },
            })
    return results


def _extract_project_findings_disabled(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'totalGB': proj.get('totalGB')},
        })
    return results


def _extract_deprecated_env_findings(recipient, campaign_id, entity_type, owner, email):
    results = []
    for env in (recipient.get('codeEnvs') or []):
        if not isinstance(env, dict):
            continue
        env_name = str(env.get('name') or env.get('key') or '')
        if not env_name:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': env_name,
            'entity_name': env_name,
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {
                'pythonVersion': env.get('pythonVersion'),
                'language': env.get('language'),
                'impactedProjects': env.get('impactedProjects'),
            },
        })
    return results


def _extract_project_findings_default_env(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'codeEnvCount': proj.get('codeEnvCount')},
        })
    return results


def _extract_project_findings_empty(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'totalGB': proj.get('totalGB')},
        })
    return results


def _extract_project_findings_large_flow(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'totalObjects': proj.get('totalObjects')},
        })
    return results


def _extract_project_findings_orphan(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {
                'notebookCount': proj.get('notebookCount'),
                'recipeCount': proj.get('recipeCount'),
            },
        })
    return results


def _extract_inactive_project_findings(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'daysInactive': proj.get('daysInactive')},
        })
    return results


def _extract_unused_code_env_findings(recipient, campaign_id, entity_type, owner, email):
    results = []
    for env in (recipient.get('codeEnvs') or []):
        if not isinstance(env, dict):
            continue
        env_key = str(env.get('key') or env.get('name') or '')
        if not env_key:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': env_key,
            'entity_name': env.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {
                'name': env.get('name'),
                'language': env.get('language'),
            },
        })
    return results


def _extract_project_findings_overshared(recipient, campaign_id, entity_type, owner, email):
    results = []
    for proj in (recipient.get('projects') or []):
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        if not pkey:
            continue
        results.append({
            'campaign_id': campaign_id,
            'entity_type': entity_type,
            'entity_key': pkey,
            'entity_name': proj.get('name'),
            'owner_login': owner,
            'owner_email': email,
            'metrics_json': {'permissionCount': proj.get('permissionCount')},
        })
    return results
