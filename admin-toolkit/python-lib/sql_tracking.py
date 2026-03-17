"""
SQL-connection-backed tracking database for diagnostic run persistence,
issue lifecycle management, and outreach audit trail.

Uses Dataiku SQLExecutor2.query_to_df() exclusively — no raw connections,
no cursors, no psycopg2.  Database-agnostic: no PostgreSQL-specific syntax.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from tracking import CAMPAIGN_REQUIRED_SECTIONS

_log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _q(prefix: Optional[str], table: str) -> str:
    """Prefix a table name (e.g. 'adtk' + 'runs' → 'adtk_runs')."""
    if prefix:
        return f"{prefix}_{table}"
    return table


def _L(val) -> str:
    """Convert a Python value to a safe SQL literal string."""
    if val is None:
        return 'NULL'
    if isinstance(val, bool):
        return 'TRUE' if val else 'FALSE'
    if isinstance(val, (int, float)):
        if isinstance(val, float) and (val != val):  # NaN
            return 'NULL'
        return str(val)
    return "'" + str(val).replace("'", "''") + "'"


def _int_val(val) -> str:
    """Coerce a value to a SQL integer literal. Extracts leading digits from strings like '4 Cores / 8 Threads'."""
    if val is None:
        return 'NULL'
    if isinstance(val, bool):
        return '1' if val else '0'
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if val != val:  # NaN
            return 'NULL'
        return str(int(val))
    import re
    m = re.search(r'-?\d+', str(val))
    return m.group(0) if m else 'NULL'


def _float_val(val) -> str:
    """Coerce a value to a SQL float literal."""
    if val is None:
        return 'NULL'
    if isinstance(val, bool):
        return '1.0' if val else '0.0'
    if isinstance(val, (int, float)):
        if isinstance(val, float) and (val != val):  # NaN
            return 'NULL'
        return str(float(val))
    import re
    m = re.search(r'-?\d+\.?\d*', str(val))
    return m.group(0) if m else 'NULL'


# All tracking table base names (unprefixed)
_ALL_TABLES = [
    'schema_version', 'instances', 'runs', 'run_health_metrics',
    'run_campaign_summaries', 'run_sections', 'findings', 'issues',
    'outreach_emails', 'outreach_email_issues', 'known_users',
    'known_projects', 'issue_notes', 'campaign_settings', 'campaign_exemptions',
]


class SQLTrackingDB:
    """SQL-connection-backed tracking database with the same public API as TrackingDB."""

    # Current schema version this code expects
    _TARGET_SCHEMA_VERSION = 4

    def __init__(self, connection_name: str, table_prefix: Optional[str] = None):
        self._connection_name = connection_name
        self._prefix = table_prefix
        self._lock = threading.Lock()
        self._initialized = False

    # ------------------------------------------------------------------
    # Executor helpers
    # ------------------------------------------------------------------

    def _get_executor(self):
        """Obtain a fresh SQLExecutor2 for this connection."""
        from dataiku.core.sql import SQLExecutor2
        return SQLExecutor2(connection=self._connection_name)

    def _read(self, executor, sql: str) -> List[Dict[str, Any]]:
        """Execute a SELECT and return rows as list of dicts."""
        df = executor.query_to_df(sql)
        if df is None or df.empty:
            return []
        return df.to_dict('records')

    def _read_one(self, executor, sql: str) -> Optional[Dict[str, Any]]:
        """Execute a SELECT and return the first row or None."""
        rows = self._read(executor, sql)
        return rows[0] if rows else None

    def _t(self, table: str) -> str:
        """Shortcut: prefix table name."""
        return _q(self._prefix, table)

    def _idx(self, name: str) -> str:
        """Prefix an index name."""
        if self._prefix:
            return f"{self._prefix}_{name}"
        return name

    def _next_id(self, executor, table: str, column: str) -> int:
        """Generate next integer ID via SELECT MAX(col)+1."""
        row = self._read_one(
            executor,
            f"SELECT COALESCE(MAX({column}), 0) + 1 AS next_id FROM {self._t(table)}",
        )
        return int(row['next_id']) if row else 1

    # ------------------------------------------------------------------
    # Schema initialization
    # ------------------------------------------------------------------

    def _init_tables(self):
        """Create all tables if they don't exist (idempotent)."""
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            executor = self._get_executor()
            ddl = self._get_ddl_statements()
            executor.query_to_df("SELECT 1", pre_queries=ddl, post_queries=['COMMIT'])
            self._initialized = True

    def _get_ddl_statements(self) -> List[str]:
        """Return list of CREATE TABLE/INDEX statements."""
        return [
            f"""CREATE TABLE IF NOT EXISTS {self._t('schema_version')} (
                version     INTEGER PRIMARY KEY,
                applied_at  TEXT NOT NULL
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('instances')} (
                instance_id     TEXT PRIMARY KEY,
                instance_url    TEXT NOT NULL,
                install_id      TEXT,
                node_id         TEXT,
                company_name    TEXT,
                first_seen_at   TEXT NOT NULL,
                last_seen_at    TEXT NOT NULL
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('runs')} (
                run_id              INTEGER PRIMARY KEY,
                instance_id         TEXT NOT NULL REFERENCES {self._t('instances')}(instance_id),
                run_at              TEXT NOT NULL,
                dss_version         TEXT,
                python_version      TEXT,
                health_score        DOUBLE PRECISION,
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
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('run_health_metrics')} (
                run_id                      INTEGER PRIMARY KEY REFERENCES {self._t('runs')}(run_id),
                cpu_cores                   INTEGER,
                memory_total_mb             INTEGER,
                memory_used_mb              INTEGER,
                memory_available_mb         INTEGER,
                swap_total_mb               INTEGER,
                swap_used_mb                INTEGER,
                max_filesystem_pct          DOUBLE PRECISION,
                max_filesystem_mount        TEXT,
                backend_heap_mb             INTEGER,
                jek_heap_mb                 INTEGER,
                fek_heap_mb                 INTEGER,
                open_files_limit            INTEGER,
                version_currency_score      DOUBLE PRECISION,
                system_capacity_score       DOUBLE PRECISION,
                configuration_score         DOUBLE PRECISION,
                security_isolation_score    DOUBLE PRECISION,
                license_named_users_pct         DOUBLE PRECISION,
                license_concurrent_users_pct    DOUBLE PRECISION,
                license_projects_pct            DOUBLE PRECISION,
                license_connections_pct         DOUBLE PRECISION,
                license_expiry_date             TEXT
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('run_campaign_summaries')} (
                run_id          INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                campaign_id     TEXT NOT NULL,
                finding_count   INTEGER NOT NULL,
                recipient_count INTEGER NOT NULL,
                PRIMARY KEY (run_id, campaign_id)
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('run_sections')} (
                run_id          INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                section_key     TEXT NOT NULL,
                status          TEXT NOT NULL,
                is_complete     INTEGER NOT NULL DEFAULT 1,
                error_message   TEXT,
                PRIMARY KEY (run_id, section_key)
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('findings')} (
                finding_id      INTEGER PRIMARY KEY,
                run_id          INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                campaign_id     TEXT NOT NULL,
                entity_type     TEXT NOT NULL,
                entity_key      TEXT NOT NULL,
                entity_name     TEXT,
                owner_login     TEXT NOT NULL,
                owner_email     TEXT,
                metrics_json    TEXT,
                UNIQUE(run_id, campaign_id, entity_type, entity_key)
            )""",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_findings_run_campaign')} ON {self._t('findings')}(run_id, campaign_id)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_findings_entity')} ON {self._t('findings')}(campaign_id, entity_type, entity_key)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_findings_owner')} ON {self._t('findings')}(owner_login)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('issues')} (
                issue_id            INTEGER PRIMARY KEY,
                instance_id         TEXT NOT NULL REFERENCES {self._t('instances')}(instance_id),
                campaign_id         TEXT NOT NULL,
                entity_type         TEXT NOT NULL,
                entity_key          TEXT NOT NULL,
                owner_login         TEXT NOT NULL,
                owner_email         TEXT,
                status              TEXT NOT NULL DEFAULT 'open',
                first_detected_run  INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                first_detected_at   TEXT NOT NULL,
                last_detected_run   INTEGER REFERENCES {self._t('runs')}(run_id),
                last_detected_at    TEXT,
                resolved_run        INTEGER REFERENCES {self._t('runs')}(run_id),
                resolved_at         TEXT,
                resolution_reason   TEXT,
                times_regressed     INTEGER NOT NULL DEFAULT 0,
                times_emailed       INTEGER NOT NULL DEFAULT 0,
                last_emailed_at     TEXT,
                entity_name         TEXT,
                metrics_json        TEXT,
                UNIQUE(instance_id, campaign_id, entity_type, entity_key)
            )""",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_issues_status')} ON {self._t('issues')}(instance_id, status)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_issues_owner')} ON {self._t('issues')}(owner_login, status)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_issues_campaign')} ON {self._t('issues')}(instance_id, campaign_id, status)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('outreach_emails')} (
                email_id        INTEGER PRIMARY KEY,
                run_id          INTEGER REFERENCES {self._t('runs')}(run_id),
                campaign_id     TEXT NOT NULL,
                recipient_login TEXT NOT NULL,
                recipient_email TEXT NOT NULL,
                sent_at         TEXT NOT NULL,
                status          TEXT NOT NULL,
                error_message   TEXT,
                subject         TEXT NOT NULL,
                channel_id      TEXT,
                sent_by         TEXT
            )""",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_emails_recipient')} ON {self._t('outreach_emails')}(recipient_login, campaign_id)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_emails_run')} ON {self._t('outreach_emails')}(run_id)",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_emails_sent_at')} ON {self._t('outreach_emails')}(sent_at)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('outreach_email_issues')} (
                email_id    INTEGER NOT NULL REFERENCES {self._t('outreach_emails')}(email_id),
                issue_id    INTEGER NOT NULL REFERENCES {self._t('issues')}(issue_id),
                PRIMARY KEY (email_id, issue_id)
            )""",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_email_issues_issue')} ON {self._t('outreach_email_issues')}(issue_id)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('known_users')} (
                instance_id     TEXT NOT NULL REFERENCES {self._t('instances')}(instance_id),
                login           TEXT NOT NULL,
                email           TEXT,
                display_name    TEXT,
                user_profile    TEXT,
                enabled         INTEGER NOT NULL DEFAULT 1,
                first_seen_run  INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                last_seen_run   INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                PRIMARY KEY (instance_id, login)
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('known_projects')} (
                instance_id     TEXT NOT NULL REFERENCES {self._t('instances')}(instance_id),
                project_key     TEXT NOT NULL,
                name            TEXT,
                owner_login     TEXT,
                first_seen_run  INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                last_seen_run   INTEGER NOT NULL REFERENCES {self._t('runs')}(run_id),
                PRIMARY KEY (instance_id, project_key)
            )""",
            f"""CREATE TABLE IF NOT EXISTS {self._t('issue_notes')} (
                note_id     INTEGER PRIMARY KEY,
                issue_id    INTEGER NOT NULL REFERENCES {self._t('issues')}(issue_id),
                created_at  TEXT NOT NULL,
                created_by  TEXT,
                note        TEXT NOT NULL
            )""",
            f"CREATE INDEX IF NOT EXISTS {self._idx('idx_notes_issue')} ON {self._t('issue_notes')}(issue_id)",
            # V3 table
            f"""CREATE TABLE IF NOT EXISTS {self._t('campaign_settings')} (
                campaign_id TEXT PRIMARY KEY,
                enabled     INTEGER NOT NULL DEFAULT 1,
                updated_at  TEXT NOT NULL
            )""",
            # V4 table
            f"""CREATE TABLE IF NOT EXISTS {self._t('campaign_exemptions')} (
                exemption_id  INTEGER PRIMARY KEY,
                campaign_id   TEXT NOT NULL,
                entity_type   TEXT NOT NULL DEFAULT 'project',
                entity_key    TEXT NOT NULL,
                reason        TEXT,
                created_at    TEXT NOT NULL,
                UNIQUE(campaign_id, entity_type, entity_key)
            )""",
            # Record schema version (skip if already recorded)
            f"INSERT INTO {self._t('schema_version')} (version, applied_at) "
            f"SELECT {self._TARGET_SCHEMA_VERSION}, {_L(_now_iso())} "
            f"WHERE NOT EXISTS (SELECT 1 FROM {self._t('schema_version')} "
            f"WHERE version = {self._TARGET_SCHEMA_VERSION})",
        ]

    # ------------------------------------------------------------------
    # Table metadata (for debug endpoint)
    # ------------------------------------------------------------------

    def get_table_info(self) -> Dict[str, Any]:
        """Return metadata about the SQL backend tables (for debug endpoint)."""
        self._init_tables()
        executor = self._get_executor()
        info: Dict[str, Any] = {
            'backend': 'sql',
            'connection_name': self._connection_name,
            'table_prefix': self._prefix,
        }
        table_names = [self._t(t) for t in _ALL_TABLES]
        names_sql = ','.join(_L(n) for n in table_names)
        rows = self._read(
            executor,
            f"SELECT table_type, table_name FROM information_schema.tables "
            f"WHERE table_name IN ({names_sql}) ORDER BY table_type, table_name",
        )
        info['objects'] = [{'type': r['table_type'], 'name': r['table_name']} for r in rows]
        for tbl in ['runs', 'issues', 'findings', 'known_users', 'known_projects',
                     'campaign_settings', 'campaign_exemptions']:
            try:
                row = self._read_one(executor, f"SELECT COUNT(*) AS cnt FROM {self._t(tbl)}")
                info[f'count_{tbl}'] = row['cnt'] if row else 0
            except Exception as e:
                info[f'count_{tbl}'] = f'ERROR: {e}'
        try:
            row = self._read_one(executor, f"SELECT MAX(version) AS v FROM {self._t('schema_version')}")
            info['schema_version'] = row['v'] if row else None
        except Exception as e:
            info['schema_version'] = f'ERROR: {e}'
        return info

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
    ) -> int:
        """Ingest a complete run. Returns the new run_id."""
        self._init_tables()
        now = _now_iso()
        executor = self._get_executor()

        # --- Call 1: Upsert instance + INSERT run (with Python-generated ID) ---
        t_inst = self._t('instances')
        run_id = self._next_id(executor, 'runs', 'run_id')
        call1_pre: List[str] = [
            # Update existing instance
            f"UPDATE {t_inst} SET "
            f"instance_url = {_L(instance_url)}, "
            f"install_id = COALESCE({_L(install_id)}, install_id), "
            f"node_id = COALESCE({_L(node_id)}, node_id), "
            f"last_seen_at = {_L(now)} "
            f"WHERE instance_id = {_L(instance_id)}",
            # Insert if not exists
            f"INSERT INTO {t_inst} "
            f"(instance_id, instance_url, install_id, node_id, first_seen_at, last_seen_at) "
            f"SELECT {_L(instance_id)}, {_L(instance_url)}, {_L(install_id)}, {_L(node_id)}, {_L(now)}, {_L(now)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM {t_inst} WHERE instance_id = {_L(instance_id)})",
            # Insert run with explicit ID
            f"INSERT INTO {self._t('runs')} "
            f"(run_id, instance_id, run_at, dss_version, python_version, "
            f"health_score, health_status, user_count, enabled_user_count, "
            f"project_count, code_env_count, plugin_count, connection_count, "
            f"cluster_count, coverage_status) "
            f"VALUES ({run_id}, {_L(instance_id)}, {_L(now)}, "
            f"{_L(run_data.get('dss_version'))}, {_L(run_data.get('python_version'))}, "
            f"{_L(run_data.get('health_score'))}, {_L(run_data.get('health_status'))}, "
            f"{_L(run_data.get('user_count'))}, {_L(run_data.get('enabled_user_count'))}, "
            f"{_L(run_data.get('project_count'))}, {_L(run_data.get('code_env_count'))}, "
            f"{_L(run_data.get('plugin_count'))}, {_L(run_data.get('connection_count'))}, "
            f"{_L(run_data.get('cluster_count'))}, {_L(run_data.get('coverage_status', 'complete'))})",
        ]
        executor.query_to_df("SELECT 1", pre_queries=call1_pre, post_queries=['COMMIT'])

        # --- Call 2: Batch bulk inserts ---
        pre: List[str] = []

        # Health metrics
        if health_metrics:
            hm = health_metrics
            pre.append(
                f"INSERT INTO {self._t('run_health_metrics')} "
                f"(run_id, cpu_cores, memory_total_mb, memory_used_mb, "
                f"memory_available_mb, swap_total_mb, swap_used_mb, "
                f"max_filesystem_pct, max_filesystem_mount, "
                f"backend_heap_mb, jek_heap_mb, fek_heap_mb, "
                f"open_files_limit, "
                f"version_currency_score, system_capacity_score, "
                f"configuration_score, security_isolation_score, "
                f"license_named_users_pct, license_concurrent_users_pct, "
                f"license_projects_pct, license_connections_pct, "
                f"license_expiry_date) "
                f"VALUES ({run_id}, {_int_val(hm.get('cpu_cores'))}, {_int_val(hm.get('memory_total_mb'))}, "
                f"{_int_val(hm.get('memory_used_mb'))}, {_int_val(hm.get('memory_available_mb'))}, "
                f"{_int_val(hm.get('swap_total_mb'))}, {_int_val(hm.get('swap_used_mb'))}, "
                f"{_float_val(hm.get('max_filesystem_pct'))}, {_L(hm.get('max_filesystem_mount'))}, "
                f"{_int_val(hm.get('backend_heap_mb'))}, {_int_val(hm.get('jek_heap_mb'))}, "
                f"{_int_val(hm.get('fek_heap_mb'))}, {_int_val(hm.get('open_files_limit'))}, "
                f"{_float_val(hm.get('version_currency_score'))}, {_float_val(hm.get('system_capacity_score'))}, "
                f"{_float_val(hm.get('configuration_score'))}, {_float_val(hm.get('security_isolation_score'))}, "
                f"{_float_val(hm.get('license_named_users_pct'))}, {_float_val(hm.get('license_concurrent_users_pct'))}, "
                f"{_float_val(hm.get('license_projects_pct'))}, {_float_val(hm.get('license_connections_pct'))}, "
                f"{_L(hm.get('license_expiry_date'))})"
            )

        # Campaign summaries
        if campaign_summaries:
            for cs in campaign_summaries:
                pre.append(
                    f"INSERT INTO {self._t('run_campaign_summaries')} "
                    f"(run_id, campaign_id, finding_count, recipient_count) "
                    f"VALUES ({run_id}, {_L(cs['campaign_id'])}, {_L(cs['finding_count'])}, {_L(cs['recipient_count'])})"
                )

        # Run sections (skip if exists)
        t_sections = self._t('run_sections')
        for section_key, sec_info in sections.items():
            sec_status = sec_info.get('status', 'success')
            is_complete = 1 if sec_status == 'success' else 0
            pre.append(
                f"INSERT INTO {t_sections} "
                f"(run_id, section_key, status, is_complete, error_message) "
                f"SELECT {run_id}, {_L(section_key)}, {_L(sec_status)}, {is_complete}, {_L(sec_info.get('error_message'))} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_sections} WHERE run_id = {run_id} AND section_key = {_L(section_key)})"
            )

        # Known users (upsert: UPDATE existing, INSERT new)
        t_users = self._t('known_users')
        for user in users:
            login = user.get('login')
            if not login:
                continue
            enabled = 1 if user.get('enabled', True) else 0
            display_name = user.get('display_name') or user.get('displayName')
            user_profile = user.get('user_profile') or user.get('userProfile')
            email = user.get('email')
            pre.append(
                f"UPDATE {t_users} SET "
                f"email = COALESCE({_L(email)}, email), "
                f"display_name = COALESCE({_L(display_name)}, display_name), "
                f"user_profile = COALESCE({_L(user_profile)}, user_profile), "
                f"enabled = {enabled}, "
                f"last_seen_run = {run_id} "
                f"WHERE instance_id = {_L(instance_id)} AND login = {_L(login)}"
            )
            pre.append(
                f"INSERT INTO {t_users} "
                f"(instance_id, login, email, display_name, user_profile, enabled, first_seen_run, last_seen_run) "
                f"SELECT {_L(instance_id)}, {_L(login)}, {_L(email)}, "
                f"{_L(display_name)}, {_L(user_profile)}, {enabled}, {run_id}, {run_id} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_users} WHERE instance_id = {_L(instance_id)} AND login = {_L(login)})"
            )

        # Known projects (upsert: UPDATE existing, INSERT new)
        t_projects = self._t('known_projects')
        for proj in projects:
            pkey = proj.get('project_key') or proj.get('projectKey')
            if not pkey:
                continue
            owner = proj.get('owner') or proj.get('owner_login')
            name = proj.get('name')
            pre.append(
                f"UPDATE {t_projects} SET "
                f"name = COALESCE({_L(name)}, name), "
                f"owner_login = COALESCE({_L(owner)}, owner_login), "
                f"last_seen_run = {run_id} "
                f"WHERE instance_id = {_L(instance_id)} AND project_key = {_L(pkey)}"
            )
            pre.append(
                f"INSERT INTO {t_projects} "
                f"(instance_id, project_key, name, owner_login, first_seen_run, last_seen_run) "
                f"SELECT {_L(instance_id)}, {_L(pkey)}, {_L(name)}, "
                f"{_L(owner)}, {run_id}, {run_id} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_projects} WHERE instance_id = {_L(instance_id)} AND project_key = {_L(pkey)})"
            )

        # Findings (skip if exists, with pre-generated IDs)
        finding_keys_this_run: Set[Tuple[str, str, str]] = set()
        entities_this_run: Set[Tuple[str, str]] = set()
        t_findings = self._t('findings')
        valid_findings: List[Dict[str, Any]] = []
        for f in findings:
            campaign_id = f.get('campaign_id', '')
            entity_type = f.get('entity_type', '')
            entity_key = f.get('entity_key', '')
            owner_login = f.get('owner_login', '')
            if not campaign_id or not entity_key or not owner_login:
                continue
            valid_findings.append(f)
            finding_keys_this_run.add((campaign_id, entity_type, entity_key))
            entities_this_run.add((entity_type, entity_key))

        if valid_findings:
            next_fid = self._next_id(executor, 'findings', 'finding_id')
            for i, f in enumerate(valid_findings):
                fid = next_fid + i
                campaign_id = f.get('campaign_id', '')
                entity_type = f.get('entity_type', '')
                entity_key = f.get('entity_key', '')
                owner_login = f.get('owner_login', '')
                metrics = f.get('metrics_json')
                if isinstance(metrics, dict):
                    metrics = json.dumps(metrics)
                pre.append(
                    f"INSERT INTO {t_findings} "
                    f"(finding_id, run_id, campaign_id, entity_type, entity_key, entity_name, owner_login, owner_email, metrics_json) "
                    f"SELECT {fid}, {run_id}, {_L(campaign_id)}, {_L(entity_type)}, {_L(entity_key)}, "
                    f"{_L(f.get('entity_name'))}, {_L(owner_login)}, {_L(f.get('owner_email'))}, {_L(metrics)} "
                    f"WHERE NOT EXISTS (SELECT 1 FROM {t_findings} "
                    f"WHERE run_id = {run_id} AND campaign_id = {_L(campaign_id)} "
                    f"AND entity_type = {_L(entity_type)} AND entity_key = {_L(entity_key)})"
                )

        if pre:
            executor.query_to_df("SELECT 1", pre_queries=pre, post_queries=['COMMIT'])

        # --- Call 3: Issue lifecycle — UPDATE existing + INSERT new ---
        issue_stmts: List[str] = []
        t_issues = self._t('issues')
        if valid_findings:
            next_iid = self._next_id(executor, 'issues', 'issue_id')
            for i, f in enumerate(valid_findings):
                iid = next_iid + i
                campaign_id = f.get('campaign_id', '')
                entity_type = f.get('entity_type', '')
                entity_key = f.get('entity_key', '')
                owner_login = f.get('owner_login', '')
                metrics = f.get('metrics_json')
                if isinstance(metrics, dict):
                    metrics = json.dumps(metrics)
                # Update existing issue
                issue_stmts.append(
                    f"UPDATE {t_issues} SET "
                    f"last_detected_run = {run_id}, "
                    f"last_detected_at = {_L(now)}, "
                    f"status = CASE "
                    f"WHEN status = 'resolved' THEN 'regressed' "
                    f"ELSE status END, "
                    f"times_regressed = CASE "
                    f"WHEN status = 'resolved' THEN times_regressed + 1 "
                    f"ELSE times_regressed END, "
                    f"resolved_run = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_run END, "
                    f"resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END, "
                    f"resolution_reason = CASE WHEN status = 'resolved' THEN NULL ELSE resolution_reason END, "
                    f"owner_login = {_L(owner_login)}, "
                    f"owner_email = {_L(f.get('owner_email'))}, "
                    f"entity_name = {_L(f.get('entity_name'))}, "
                    f"metrics_json = {_L(metrics)} "
                    f"WHERE instance_id = {_L(instance_id)} AND campaign_id = {_L(campaign_id)} "
                    f"AND entity_type = {_L(entity_type)} AND entity_key = {_L(entity_key)}"
                )
                # Insert new issue if not exists
                issue_stmts.append(
                    f"INSERT INTO {t_issues} "
                    f"(issue_id, instance_id, campaign_id, entity_type, entity_key, "
                    f"owner_login, owner_email, status, "
                    f"first_detected_run, first_detected_at, "
                    f"last_detected_run, last_detected_at, "
                    f"entity_name, metrics_json) "
                    f"SELECT {iid}, {_L(instance_id)}, {_L(campaign_id)}, {_L(entity_type)}, {_L(entity_key)}, "
                    f"{_L(owner_login)}, {_L(f.get('owner_email'))}, 'open', "
                    f"{run_id}, {_L(now)}, {run_id}, {_L(now)}, "
                    f"{_L(f.get('entity_name'))}, {_L(metrics)} "
                    f"WHERE NOT EXISTS (SELECT 1 FROM {t_issues} "
                    f"WHERE instance_id = {_L(instance_id)} AND campaign_id = {_L(campaign_id)} "
                    f"AND entity_type = {_L(entity_type)} AND entity_key = {_L(entity_key)})"
                )

        if issue_stmts:
            executor.query_to_df("SELECT 1", pre_queries=issue_stmts, post_queries=['COMMIT'])

        # --- Call 4: Coverage update + auto-resolve ---
        all_statuses = [s.get('status', 'success') for s in sections.values()]
        if all(s == 'success' for s in all_statuses):
            coverage = 'complete'
        elif any(s == 'error' for s in all_statuses):
            coverage = 'failed'
        else:
            coverage = 'partial'

        final_pre: List[str] = [
            f"UPDATE {self._t('runs')} SET coverage_status = {_L(coverage)} WHERE run_id = {run_id}"
        ]

        # Coverage-gated auto-resolve
        complete_sections = set()
        for section_key, sec_info in sections.items():
            if sec_info.get('status') == 'success':
                complete_sections.add(section_key)

        safe_campaigns = set()
        for cid, required in CAMPAIGN_REQUIRED_SECTIONS.items():
            if all(s in complete_sections for s in required):
                safe_campaigns.add(cid)

        if safe_campaigns and finding_keys_this_run:
            campaigns_sql = ','.join(_L(c) for c in sorted(safe_campaigns))
            finding_keys_sql = ','.join(
                f"({_L(c)}, {_L(et)}, {_L(ek)})" for c, et, ek in finding_keys_this_run
            )
            entities_sql = ','.join(
                f"({_L(et)}, {_L(ek)})" for et, ek in entities_this_run
            )
            # condition_cleared: entity seen but finding gone
            final_pre.append(
                f"UPDATE {self._t('issues')} SET status='resolved', resolved_run={run_id}, "
                f"resolved_at={_L(now)}, resolution_reason='condition_cleared' "
                f"WHERE instance_id={_L(instance_id)} AND status IN ('open','regressed') "
                f"AND campaign_id IN ({campaigns_sql}) "
                f"AND (campaign_id, entity_type, entity_key) NOT IN ({finding_keys_sql}) "
                f"AND (entity_type, entity_key) IN ({entities_sql})"
            )
            # entity_deleted: entity not seen at all
            final_pre.append(
                f"UPDATE {self._t('issues')} SET status='resolved', resolved_run={run_id}, "
                f"resolved_at={_L(now)}, resolution_reason='entity_deleted' "
                f"WHERE instance_id={_L(instance_id)} AND status IN ('open','regressed') "
                f"AND campaign_id IN ({campaigns_sql}) "
                f"AND (campaign_id, entity_type, entity_key) NOT IN ({finding_keys_sql}) "
                f"AND (entity_type, entity_key) NOT IN ({entities_sql})"
            )
        elif safe_campaigns and not finding_keys_this_run:
            # No findings this run but campaigns are safe — resolve all open issues for those campaigns
            campaigns_sql = ','.join(_L(c) for c in sorted(safe_campaigns))
            final_pre.append(
                f"UPDATE {self._t('issues')} SET status='resolved', resolved_run={run_id}, "
                f"resolved_at={_L(now)}, resolution_reason='entity_deleted' "
                f"WHERE instance_id={_L(instance_id)} AND status IN ('open','regressed') "
                f"AND campaign_id IN ({campaigns_sql})"
            )

        executor.query_to_df("SELECT 1", pre_queries=final_pre, post_queries=['COMMIT'])
        return run_id

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def list_runs(self, instance_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        self._init_tables()
        executor = self._get_executor()
        if instance_id:
            return self._read(
                executor,
                f"SELECT * FROM {self._t('runs')} WHERE instance_id = {_L(instance_id)} "
                f"ORDER BY run_id DESC LIMIT {_L(limit)} OFFSET {_L(offset)}",
            )
        return self._read(
            executor,
            f"SELECT * FROM {self._t('runs')} ORDER BY run_id DESC LIMIT {_L(limit)} OFFSET {_L(offset)}",
        )

    def get_run(self, run_id: int) -> Optional[Dict[str, Any]]:
        self._init_tables()
        executor = self._get_executor()
        result = self._read_one(
            executor,
            f"SELECT * FROM {self._t('runs')} WHERE run_id = {_L(run_id)}",
        )
        if not result:
            return None
        result['campaign_summaries'] = self._read(
            executor,
            f"SELECT * FROM {self._t('run_campaign_summaries')} WHERE run_id = {_L(run_id)}",
        )
        result['health_metrics'] = self._read_one(
            executor,
            f"SELECT * FROM {self._t('run_health_metrics')} WHERE run_id = {_L(run_id)}",
        )
        result['sections'] = self._read(
            executor,
            f"SELECT * FROM {self._t('run_sections')} WHERE run_id = {_L(run_id)}",
        )
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
        self._init_tables()
        executor = self._get_executor()
        conditions: List[str] = []
        if instance_id:
            conditions.append(f'instance_id = {_L(instance_id)}')
        if status:
            conditions.append(f'status = {_L(status)}')
        if campaign_id:
            conditions.append(f'campaign_id = {_L(campaign_id)}')
        if owner_login:
            conditions.append(f'owner_login = {_L(owner_login)}')

        where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''
        rows = self._read(
            executor,
            f"SELECT * FROM {self._t('issues')}{where} ORDER BY issue_id DESC LIMIT {_L(limit)} OFFSET {_L(offset)}",
        )
        for d in rows:
            if d.get('metrics_json') and isinstance(d['metrics_json'], str):
                try:
                    d['metrics_json'] = json.loads(d['metrics_json'])
                except (json.JSONDecodeError, TypeError):
                    pass
        return rows

    def get_issue(self, issue_id: int) -> Optional[Dict[str, Any]]:
        self._init_tables()
        executor = self._get_executor()
        result = self._read_one(
            executor,
            f"SELECT * FROM {self._t('issues')} WHERE issue_id = {_L(issue_id)}",
        )
        if not result:
            return None
        result['finding_history'] = self._read(
            executor,
            f"SELECT f.* FROM {self._t('findings')} f "
            f"WHERE f.campaign_id = {_L(result['campaign_id'])} "
            f"AND f.entity_type = {_L(result['entity_type'])} "
            f"AND f.entity_key = {_L(result['entity_key'])} "
            f"ORDER BY f.run_id DESC",
        )
        result['email_history'] = self._read(
            executor,
            f"SELECT oe.* FROM {self._t('outreach_emails')} oe "
            f"JOIN {self._t('outreach_email_issues')} oei ON oe.email_id = oei.email_id "
            f"WHERE oei.issue_id = {_L(issue_id)} "
            f"ORDER BY oe.sent_at DESC",
        )
        result['notes'] = self._read(
            executor,
            f"SELECT * FROM {self._t('issue_notes')} WHERE issue_id = {_L(issue_id)} ORDER BY created_at DESC",
        )
        return result

    def list_all_user_compliance(self, instance_id: Optional[str] = None) -> List[Dict[str, Any]]:
        self._init_tables()
        executor = self._get_executor()
        base_query = (
            f"SELECT "
            f"i.owner_login, i.owner_email, i.campaign_id, "
            f"COUNT(CASE WHEN i.status = 'open' THEN 1 END) AS open_issues, "
            f"COUNT(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolved_issues, "
            f"COUNT(CASE WHEN i.status = 'regressed' THEN 1 END) AS regressed_issues, "
            f"SUM(i.times_emailed) AS total_emails_sent, "
            f"MAX(i.last_emailed_at) AS last_emailed, "
            f"MIN(i.first_detected_at) AS earliest_issue "
            f"FROM {self._t('issues')} i"
        )
        if instance_id:
            return self._read(
                executor,
                base_query + f" WHERE i.instance_id = {_L(instance_id)} GROUP BY i.owner_login, i.owner_email, i.campaign_id",
            )
        return self._read(
            executor,
            base_query + " GROUP BY i.owner_login, i.owner_email, i.campaign_id",
        )

    def get_user_compliance(self, login: str) -> List[Dict[str, Any]]:
        self._init_tables()
        executor = self._get_executor()
        return self._read(
            executor,
            f"SELECT "
            f"i.owner_login, i.owner_email, i.campaign_id, "
            f"COUNT(CASE WHEN i.status = 'open' THEN 1 END) AS open_issues, "
            f"COUNT(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolved_issues, "
            f"COUNT(CASE WHEN i.status = 'regressed' THEN 1 END) AS regressed_issues, "
            f"SUM(i.times_emailed) AS total_emails_sent, "
            f"MAX(i.last_emailed_at) AS last_emailed, "
            f"MIN(i.first_detected_at) AS earliest_issue "
            f"FROM {self._t('issues')} i "
            f"WHERE i.owner_login = {_L(login)} "
            f"GROUP BY i.owner_login, i.owner_email, i.campaign_id",
        )

    def add_issue_note(self, issue_id: int, note: str, created_by: Optional[str] = None) -> int:
        self._init_tables()
        executor = self._get_executor()
        now = _now_iso()
        note_id = self._next_id(executor, 'issue_notes', 'note_id')
        executor.query_to_df(
            "SELECT 1",
            pre_queries=[
                f"INSERT INTO {self._t('issue_notes')} (note_id, issue_id, created_at, created_by, note) "
                f"VALUES ({note_id}, {_L(issue_id)}, {_L(now)}, {_L(created_by)}, {_L(note)})"
            ],
            post_queries=['COMMIT'],
        )
        return note_id

    def compare_runs(self, run_id_1: int, run_id_2: int) -> Dict[str, Any]:
        self._init_tables()
        executor = self._get_executor()
        r1 = self._read_one(executor, f"SELECT * FROM {self._t('runs')} WHERE run_id = {_L(run_id_1)}")
        r2 = self._read_one(executor, f"SELECT * FROM {self._t('runs')} WHERE run_id = {_L(run_id_2)}")
        if not r1 or not r2:
            return {'error': 'One or both runs not found'}

        s1 = self._read(
            executor,
            f"SELECT campaign_id, finding_count, recipient_count FROM {self._t('run_campaign_summaries')} WHERE run_id = {_L(run_id_1)}",
        )
        s2 = self._read(
            executor,
            f"SELECT campaign_id, finding_count, recipient_count FROM {self._t('run_campaign_summaries')} WHERE run_id = {_L(run_id_2)}",
        )

        map1 = {r['campaign_id']: r for r in s1}
        map2 = {r['campaign_id']: r for r in s2}
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

        resolved = self._read(
            executor,
            f"SELECT * FROM {self._t('issues')} WHERE resolved_run = {_L(run_id_2)} AND first_detected_run <= {_L(run_id_1)}",
        )
        opened = self._read(
            executor,
            f"SELECT * FROM {self._t('issues')} WHERE first_detected_run = {_L(run_id_2)}",
        )
        regressed = self._read(
            executor,
            f"SELECT * FROM {self._t('issues')} WHERE status = 'regressed' AND last_detected_run = {_L(run_id_2)}",
        )

        return {
            'run1': r1,
            'run2': r2,
            'campaign_deltas': deltas,
            'issues_resolved': resolved,
            'issues_opened': opened,
            'issues_regressed': regressed,
        }

    def get_dashboard(self, instance_id: Optional[str] = None) -> Dict[str, Any]:
        self._init_tables()
        executor = self._get_executor()

        cond = f' WHERE instance_id = {_L(instance_id)}' if instance_id else ''

        total_runs = self._read_one(
            executor, f"SELECT COUNT(*) AS cnt FROM {self._t('runs')}{cond}",
        )['cnt']

        if instance_id:
            issue_cond = f" WHERE instance_id = {_L(instance_id)} AND status IN ('open', 'regressed')"
        else:
            issue_cond = " WHERE status IN ('open', 'regressed')"
        open_issues = self._read_one(
            executor, f"SELECT COUNT(*) AS cnt FROM {self._t('issues')}{issue_cond}",
        )['cnt']

        if instance_id:
            resolved_cond = f" WHERE instance_id = {_L(instance_id)} AND status = 'resolved'"
        else:
            resolved_cond = " WHERE status = 'resolved'"
        resolved_issues = self._read_one(
            executor, f"SELECT COUNT(*) AS cnt FROM {self._t('issues')}{resolved_cond}",
        )['cnt']

        if instance_id:
            email_cond = f" WHERE run_id IN (SELECT run_id FROM {self._t('runs')} WHERE instance_id = {_L(instance_id)})"
        else:
            email_cond = ''
        total_emails = self._read_one(
            executor, f"SELECT COUNT(*) AS cnt FROM {self._t('outreach_emails')}{email_cond}",
        )['cnt']

        campaign_cond = f' WHERE instance_id = {_L(instance_id)}' if instance_id else ''
        campaign_stats = self._read(
            executor,
            f"SELECT campaign_id, "
            f"COUNT(CASE WHEN status IN ('open', 'regressed') THEN 1 END) AS open_count, "
            f"COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS resolved_count, "
            f"COUNT(*) AS total_count "
            f"FROM {self._t('issues')}{campaign_cond} "
            f"GROUP BY campaign_id",
        )

        latest_run = self._read_one(
            executor,
            f"SELECT * FROM {self._t('runs')}{cond} ORDER BY run_id DESC LIMIT 1",
        )

        stale = self._read_one(
            executor,
            f"SELECT COUNT(*) AS cnt FROM {self._t('issues')} "
            f"WHERE status IN ('open', 'regressed') AND times_emailed > 0",
        )['cnt']

        return {
            'total_runs': total_runs,
            'open_issues': open_issues,
            'resolved_issues': resolved_issues,
            'total_emails': total_emails,
            'stale_outreach_count': stale,
            'campaign_stats': campaign_stats,
            'latest_run': latest_run,
        }

    # ------------------------------------------------------------------
    # Campaign settings
    # ------------------------------------------------------------------

    def get_campaign_settings(self) -> Dict[str, bool]:
        self._init_tables()
        executor = self._get_executor()
        rows = self._read(executor, f"SELECT campaign_id, enabled FROM {self._t('campaign_settings')}")
        return {r['campaign_id']: bool(r['enabled']) for r in rows}

    def set_campaign_enabled(self, campaign_id: str, enabled: bool) -> None:
        self._init_tables()
        executor = self._get_executor()
        now = _now_iso()
        t_cs = self._t('campaign_settings')
        enabled_val = 1 if enabled else 0
        executor.query_to_df(
            "SELECT 1",
            pre_queries=[
                f"UPDATE {t_cs} SET enabled = {enabled_val}, updated_at = {_L(now)} "
                f"WHERE campaign_id = {_L(campaign_id)}",
                f"INSERT INTO {t_cs} (campaign_id, enabled, updated_at) "
                f"SELECT {_L(campaign_id)}, {enabled_val}, {_L(now)} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_cs} WHERE campaign_id = {_L(campaign_id)})",
            ],
            post_queries=['COMMIT'],
        )

    def get_disabled_campaigns(self) -> set:
        self._init_tables()
        executor = self._get_executor()
        rows = self._read(
            executor,
            f"SELECT campaign_id FROM {self._t('campaign_settings')} WHERE enabled = 0",
        )
        return {r['campaign_id'] for r in rows}

    # ------------------------------------------------------------------
    # Campaign exemptions
    # ------------------------------------------------------------------

    def get_exemptions(self, campaign_id: str = None) -> list:
        self._init_tables()
        executor = self._get_executor()
        if campaign_id:
            return self._read(
                executor,
                f"SELECT * FROM {self._t('campaign_exemptions')} WHERE campaign_id = {_L(campaign_id)} ORDER BY created_at DESC",
            )
        return self._read(
            executor,
            f"SELECT * FROM {self._t('campaign_exemptions')} ORDER BY created_at DESC",
        )

    def get_exemption_set(self) -> set:
        self._init_tables()
        executor = self._get_executor()
        rows = self._read(
            executor,
            f"SELECT campaign_id, entity_key FROM {self._t('campaign_exemptions')}",
        )
        return {(r['campaign_id'], r['entity_key']) for r in rows}

    def add_exemption(self, campaign_id: str, entity_key: str, reason: str = None) -> dict:
        self._init_tables()
        executor = self._get_executor()
        now = _now_iso()
        t_ce = self._t('campaign_exemptions')
        next_eid = self._next_id(executor, 'campaign_exemptions', 'exemption_id')
        executor.query_to_df(
            "SELECT 1",
            pre_queries=[
                f"UPDATE {t_ce} SET reason = {_L(reason)}, created_at = {_L(now)} "
                f"WHERE campaign_id = {_L(campaign_id)} AND entity_type = 'project' AND entity_key = {_L(entity_key)}",
                f"INSERT INTO {t_ce} (exemption_id, campaign_id, entity_type, entity_key, reason, created_at) "
                f"SELECT {next_eid}, {_L(campaign_id)}, 'project', {_L(entity_key)}, {_L(reason)}, {_L(now)} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_ce} "
                f"WHERE campaign_id = {_L(campaign_id)} AND entity_type = 'project' AND entity_key = {_L(entity_key)})",
            ],
            post_queries=['COMMIT'],
        )
        row = self._read_one(
            executor,
            f"SELECT * FROM {t_ce} "
            f"WHERE campaign_id = {_L(campaign_id)} AND entity_key = {_L(entity_key)}",
        )
        return row if row else {}

    def remove_exemption(self, exemption_id: int) -> bool:
        self._init_tables()
        executor = self._get_executor()
        row = self._read_one(
            executor,
            f"SELECT exemption_id FROM {self._t('campaign_exemptions')} WHERE exemption_id = {_L(exemption_id)}",
        )
        if not row:
            return False
        executor.query_to_df(
            "SELECT 1",
            pre_queries=[
                f"DELETE FROM {self._t('campaign_exemptions')} WHERE exemption_id = {_L(exemption_id)}"
            ],
            post_queries=['COMMIT'],
        )
        return True

    def resolve_issue_ids_for_preview(
        self,
        instance_id: str,
        campaign_id: str,
        entity_keys: List[Tuple[str, str]],
    ) -> List[int]:
        if not entity_keys:
            return []
        self._init_tables()
        executor = self._get_executor()
        # Build a single query with IN clause for all entity keys
        key_conditions = ' OR '.join(
            f"(entity_type = {_L(et)} AND entity_key = {_L(ek)})"
            for et, ek in entity_keys
        )
        rows = self._read(
            executor,
            f"SELECT issue_id FROM {self._t('issues')} "
            f"WHERE instance_id = {_L(instance_id)} AND campaign_id = {_L(campaign_id)} "
            f"AND status IN ('open', 'regressed') "
            f"AND ({key_conditions})",
        )
        return [r['issue_id'] for r in rows]

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
        self._init_tables()
        executor = self._get_executor()
        now = _now_iso()

        # Call 1: insert email with Python-generated ID
        email_id = self._next_id(executor, 'outreach_emails', 'email_id')
        executor.query_to_df(
            "SELECT 1",
            pre_queries=[
                f"INSERT INTO {self._t('outreach_emails')} "
                f"(email_id, run_id, campaign_id, recipient_login, recipient_email, "
                f"sent_at, status, error_message, subject, channel_id, sent_by) "
                f"VALUES ({email_id}, {_L(run_id)}, {_L(campaign_id)}, {_L(recipient_login)}, {_L(recipient_email)}, "
                f"{_L(now)}, {_L(status)}, {_L(error_message)}, {_L(subject)}, {_L(channel_id)}, {_L(sent_by)})"
            ],
            post_queries=['COMMIT'],
        )

        # Call 2: link issues + update counters
        if linked_issue_ids and status == 'sent':
            t_oei = self._t('outreach_email_issues')
            pre = [
                f"INSERT INTO {t_oei} (email_id, issue_id) "
                f"SELECT {email_id}, {_L(iid)} "
                f"WHERE NOT EXISTS (SELECT 1 FROM {t_oei} WHERE email_id = {email_id} AND issue_id = {_L(iid)})"
                for iid in linked_issue_ids
            ]
            ids_sql = ','.join(str(int(iid)) for iid in linked_issue_ids)
            pre.append(
                f"UPDATE {self._t('issues')} SET "
                f"times_emailed = times_emailed + 1, "
                f"last_emailed_at = {_L(now)} "
                f"WHERE issue_id IN ({ids_sql})"
            )
            executor.query_to_df("SELECT 1", pre_queries=pre, post_queries=['COMMIT'])

        return email_id

    # ------------------------------------------------------------------
    # Migration support: bulk read all data from tables
    # ------------------------------------------------------------------

    def get_all_table_data(self, table: str) -> List[Dict[str, Any]]:
        """Read all rows from a table. Used during migration."""
        self._init_tables()
        executor = self._get_executor()
        return self._read(executor, f"SELECT * FROM {self._t(table)}")

    def get_row_counts(self) -> Dict[str, int]:
        """Return row counts for all tracking tables."""
        self._init_tables()
        executor = self._get_executor()
        counts = {}
        for tbl in _ALL_TABLES:
            try:
                row = self._read_one(executor, f"SELECT COUNT(*) AS cnt FROM {self._t(tbl)}")
                counts[tbl] = row['cnt'] if row else 0
            except Exception:
                counts[tbl] = -1
        return counts

    def insert_migration_rows(self, table: str, rows: List[Dict[str, Any]]) -> int:
        """Insert rows during migration. Returns number of rows attempted."""
        if not rows:
            return 0
        self._init_tables()
        executor = self._get_executor()
        cols = list(rows[0].keys())
        col_list = ', '.join(cols)
        pre = []
        for row in rows:
            vals = ', '.join(_L(row.get(c)) for c in cols)
            pre.append(
                f"INSERT INTO {self._t(table)} ({col_list}) VALUES ({vals})"
            )
        executor.query_to_df("SELECT 1", pre_queries=pre, post_queries=['COMMIT'])
        return len(rows)

    def reset_sequences(self):
        """No-op: IDs are now generated in Python via _next_id()."""
        pass
