"""
SQL-connection-backed tracking database for diagnostic run persistence,
issue lifecycle management, and outreach audit trail.

Uses a Dataiku SQL connection (Postgres, Snowflake, etc.) instead of local SQLite.
Obtains the underlying DBAPI connection for transactional writes.
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


def _q(schema: Optional[str], table: str) -> str:
    """Qualify a table name with an optional schema prefix."""
    if schema:
        return f"{schema}.{table}"
    return table


class SQLTrackingDB:
    """SQL-connection-backed tracking database with the same public API as TrackingDB."""

    # Current schema version this code expects
    _TARGET_SCHEMA_VERSION = 4

    def __init__(self, connection_name: str, schema_name: Optional[str] = None):
        self._connection_name = connection_name
        self._schema = schema_name
        self._lock = threading.Lock()
        self._initialized = False

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    def _get_connection(self):
        """Get a raw DBAPI2 connection via psycopg2 using Dataiku connection params."""
        import dataiku
        raw = dataiku.api_client().get_connection(self._connection_name).get_settings().get_raw()
        conn_type = raw.get('type', '')
        params = raw.get('params', {})

        if conn_type != 'PostgreSQL':
            raise RuntimeError(f"Unsupported connection type '{conn_type}' — only PostgreSQL is supported")

        import psycopg2
        conn = psycopg2.connect(
            host=params.get('host', 'localhost'),
            port=int(params.get('port', 5432)),
            dbname=params.get('db', ''),
            user=params.get('user', ''),
            password=params.get('password', ''),
        )
        conn.autocommit = False
        return conn

    def _ensure_schema(self, conn):
        """Create schema if it doesn't exist."""
        if self._schema:
            cur = conn.cursor()
            try:
                cur.execute(f"CREATE SCHEMA IF NOT EXISTS {self._schema}")
                conn.commit()
            finally:
                cur.close()

    def _init_tables(self):
        """Create all tables if they don't exist (idempotent)."""
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            conn = self._get_connection()
            try:
                self._ensure_schema(conn)
                cur = conn.cursor()
                try:
                    self._create_tables(cur)
                    self._run_migrations(cur)
                    conn.commit()
                finally:
                    cur.close()
                self._initialized = True
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def _t(self, table: str) -> str:
        """Shortcut: qualify table name."""
        return _q(self._schema, table)

    def _create_tables(self, cur):
        """Create V1 tables using Postgres-compatible DDL."""
        stmts = [
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
                run_id              SERIAL PRIMARY KEY,
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
                finding_id      SERIAL PRIMARY KEY,
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
            f"CREATE INDEX IF NOT EXISTS idx_findings_run_campaign ON {self._t('findings')}(run_id, campaign_id)",
            f"CREATE INDEX IF NOT EXISTS idx_findings_entity ON {self._t('findings')}(campaign_id, entity_type, entity_key)",
            f"CREATE INDEX IF NOT EXISTS idx_findings_owner ON {self._t('findings')}(owner_login)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('issues')} (
                issue_id            SERIAL PRIMARY KEY,
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
            f"CREATE INDEX IF NOT EXISTS idx_issues_status ON {self._t('issues')}(instance_id, status)",
            f"CREATE INDEX IF NOT EXISTS idx_issues_owner ON {self._t('issues')}(owner_login, status)",
            f"CREATE INDEX IF NOT EXISTS idx_issues_campaign ON {self._t('issues')}(instance_id, campaign_id, status)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('outreach_emails')} (
                email_id        SERIAL PRIMARY KEY,
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
            f"CREATE INDEX IF NOT EXISTS idx_emails_recipient ON {self._t('outreach_emails')}(recipient_login, campaign_id)",
            f"CREATE INDEX IF NOT EXISTS idx_emails_run ON {self._t('outreach_emails')}(run_id)",
            f"CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON {self._t('outreach_emails')}(sent_at)",
            f"""CREATE TABLE IF NOT EXISTS {self._t('outreach_email_issues')} (
                email_id    INTEGER NOT NULL REFERENCES {self._t('outreach_emails')}(email_id),
                issue_id    INTEGER NOT NULL REFERENCES {self._t('issues')}(issue_id),
                PRIMARY KEY (email_id, issue_id)
            )""",
            f"CREATE INDEX IF NOT EXISTS idx_email_issues_issue ON {self._t('outreach_email_issues')}(issue_id)",
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
                note_id     SERIAL PRIMARY KEY,
                issue_id    INTEGER NOT NULL REFERENCES {self._t('issues')}(issue_id),
                created_at  TEXT NOT NULL,
                created_by  TEXT,
                note        TEXT NOT NULL
            )""",
            f"CREATE INDEX IF NOT EXISTS idx_notes_issue ON {self._t('issue_notes')}(issue_id)",
            # V3 table
            f"""CREATE TABLE IF NOT EXISTS {self._t('campaign_settings')} (
                campaign_id TEXT PRIMARY KEY,
                enabled     INTEGER NOT NULL DEFAULT 1,
                updated_at  TEXT NOT NULL
            )""",
            # V4 table
            f"""CREATE TABLE IF NOT EXISTS {self._t('campaign_exemptions')} (
                exemption_id  SERIAL PRIMARY KEY,
                campaign_id   TEXT NOT NULL,
                entity_type   TEXT NOT NULL DEFAULT 'project',
                entity_key    TEXT NOT NULL,
                reason        TEXT,
                created_at    TEXT NOT NULL,
                UNIQUE(campaign_id, entity_type, entity_key)
            )""",
        ]
        for stmt in stmts:
            cur.execute(stmt)
        # Record schema version
        cur.execute(
            f"INSERT INTO {self._t('schema_version')} (version, applied_at) VALUES (%s, %s) "
            f"ON CONFLICT (version) DO NOTHING",
            (self._TARGET_SCHEMA_VERSION, _now_iso()),
        )

    def _run_migrations(self, cur):
        """Run any pending migrations. Currently all tables are created at V4."""
        # All tables created in _create_tables already include V2-V4 columns/tables.
        # This method exists for future V5+ migrations.
        pass

    # ------------------------------------------------------------------
    # Helper: execute a query returning rows as list of dicts
    # ------------------------------------------------------------------

    def _query(self, conn, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        cur = conn.cursor()
        try:
            cur.execute(sql, params)
            if cur.description is None:
                return []
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    def _query_one(self, conn, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        rows = self._query(conn, sql, params)
        return rows[0] if rows else None

    def _execute(self, conn, sql: str, params: tuple = ()) -> int:
        """Execute a write statement. Returns rowcount."""
        cur = conn.cursor()
        try:
            cur.execute(sql, params)
            return cur.rowcount
        finally:
            cur.close()

    def _execute_returning(self, conn, sql: str, params: tuple = ()) -> Optional[Any]:
        """Execute INSERT ... RETURNING id. Returns the id value."""
        cur = conn.cursor()
        try:
            cur.execute(sql, params)
            row = cur.fetchone()
            return row[0] if row else None
        finally:
            cur.close()

    # ------------------------------------------------------------------
    # Table metadata (for debug endpoint)
    # ------------------------------------------------------------------

    def get_table_info(self) -> Dict[str, Any]:
        """Return metadata about the SQL backend tables (for debug endpoint)."""
        self._init_tables()
        conn = self._get_connection()
        try:
            info: Dict[str, Any] = {
                'backend': 'sql',
                'connection_name': self._connection_name,
                'schema': self._schema,
            }
            # List tables
            schema_filter = self._schema or 'public'
            rows = self._query(
                conn,
                "SELECT table_type, table_name FROM information_schema.tables "
                "WHERE table_schema = %s ORDER BY table_type, table_name",
                (schema_filter,),
            )
            info['objects'] = [{'type': r['table_type'], 'name': r['table_name']} for r in rows]
            # Row counts
            for tbl in ['runs', 'issues', 'findings', 'known_users', 'known_projects',
                        'campaign_settings', 'campaign_exemptions']:
                try:
                    row = self._query_one(conn, f"SELECT COUNT(*) AS cnt FROM {self._t(tbl)}")
                    info[f'count_{tbl}'] = row['cnt'] if row else 0
                except Exception as e:
                    info[f'count_{tbl}'] = f'ERROR: {e}'
            # Schema version
            try:
                row = self._query_one(conn, f"SELECT MAX(version) AS v FROM {self._t('schema_version')}")
                info['schema_version'] = row['v'] if row else None
            except Exception as e:
                info['schema_version'] = f'ERROR: {e}'
            return info
        finally:
            conn.close()

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

        conn = self._get_connection()
        try:
            # 1. UPSERT instance
            self._execute(
                conn,
                f"""INSERT INTO {self._t('instances')}
                       (instance_id, instance_url, install_id, node_id, first_seen_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (instance_id) DO UPDATE SET
                        instance_url = EXCLUDED.instance_url,
                        install_id = COALESCE(EXCLUDED.install_id, {self._t('instances')}.install_id),
                        node_id = COALESCE(EXCLUDED.node_id, {self._t('instances')}.node_id),
                        last_seen_at = EXCLUDED.last_seen_at""",
                (instance_id, instance_url, install_id, node_id, now, now),
            )

            # 2. INSERT run (RETURNING run_id)
            run_id = self._execute_returning(
                conn,
                f"""INSERT INTO {self._t('runs')}
                       (instance_id, run_at, dss_version, python_version,
                        health_score, health_status, user_count, enabled_user_count,
                        project_count, code_env_count, plugin_count, connection_count,
                        cluster_count, coverage_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING run_id""",
                (
                    instance_id, now,
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

            # 3. INSERT run_health_metrics
            if health_metrics:
                self._execute(
                    conn,
                    f"""INSERT INTO {self._t('run_health_metrics')}
                           (run_id, cpu_cores, memory_total_mb, memory_used_mb,
                            memory_available_mb, swap_total_mb, swap_used_mb,
                            max_filesystem_pct, max_filesystem_mount,
                            backend_heap_mb, jek_heap_mb, fek_heap_mb,
                            open_files_limit,
                            version_currency_score, system_capacity_score,
                            configuration_score, security_isolation_score,
                            license_named_users_pct, license_concurrent_users_pct,
                            license_projects_pct, license_connections_pct,
                            license_expiry_date)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
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
                    self._execute(
                        conn,
                        f"""INSERT INTO {self._t('run_campaign_summaries')}
                               (run_id, campaign_id, finding_count, recipient_count)
                            VALUES (%s, %s, %s, %s)""",
                        (run_id, cs['campaign_id'], cs['finding_count'], cs['recipient_count']),
                    )

            # 5. UPSERT known_users
            for user in users:
                login = user.get('login')
                if not login:
                    continue
                self._execute(
                    conn,
                    f"""INSERT INTO {self._t('known_users')}
                           (instance_id, login, email, display_name, user_profile, enabled, first_seen_run, last_seen_run)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (instance_id, login) DO UPDATE SET
                            email = COALESCE(EXCLUDED.email, {self._t('known_users')}.email),
                            display_name = COALESCE(EXCLUDED.display_name, {self._t('known_users')}.display_name),
                            user_profile = COALESCE(EXCLUDED.user_profile, {self._t('known_users')}.user_profile),
                            enabled = EXCLUDED.enabled,
                            last_seen_run = EXCLUDED.last_seen_run""",
                    (
                        instance_id, login,
                        user.get('email'),
                        user.get('display_name') or user.get('displayName'),
                        user.get('user_profile') or user.get('userProfile'),
                        1 if user.get('enabled', True) else 0,
                        run_id, run_id,
                    ),
                )

            # 6. UPSERT known_projects
            for proj in projects:
                pkey = proj.get('project_key') or proj.get('projectKey')
                if not pkey:
                    continue
                self._execute(
                    conn,
                    f"""INSERT INTO {self._t('known_projects')}
                           (instance_id, project_key, name, owner_login, first_seen_run, last_seen_run)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (instance_id, project_key) DO UPDATE SET
                            name = COALESCE(EXCLUDED.name, {self._t('known_projects')}.name),
                            owner_login = COALESCE(EXCLUDED.owner_login, {self._t('known_projects')}.owner_login),
                            last_seen_run = EXCLUDED.last_seen_run""",
                    (
                        instance_id, pkey,
                        proj.get('name'),
                        proj.get('owner') or proj.get('owner_login'),
                        run_id, run_id,
                    ),
                )

            # 7. INSERT findings + lifecycle issues
            finding_keys_this_run: Set[Tuple[str, str, str]] = set()
            entities_this_run: Set[Tuple[str, str]] = set()
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

                self._execute(
                    conn,
                    f"""INSERT INTO {self._t('findings')}
                           (run_id, campaign_id, entity_type, entity_key, entity_name, owner_login, owner_email, metrics_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (run_id, campaign_id, entity_type, entity_key) DO NOTHING""",
                    (run_id, campaign_id, entity_type, entity_key,
                     f.get('entity_name'), owner_login, f.get('owner_email'), metrics),
                )

                # Issue lifecycle
                row = self._query_one(
                    conn,
                    f"""SELECT issue_id, status FROM {self._t('issues')}
                        WHERE instance_id = %s AND campaign_id = %s AND entity_type = %s AND entity_key = %s""",
                    (instance_id, campaign_id, entity_type, entity_key),
                )

                if row is None:
                    self._execute(
                        conn,
                        f"""INSERT INTO {self._t('issues')}
                               (instance_id, campaign_id, entity_type, entity_key,
                                owner_login, owner_email, status,
                                first_detected_run, first_detected_at,
                                last_detected_run, last_detected_at,
                                entity_name, metrics_json)
                            VALUES (%s, %s, %s, %s, %s, %s, 'open', %s, %s, %s, %s, %s, %s)""",
                        (instance_id, campaign_id, entity_type, entity_key,
                         owner_login, f.get('owner_email'),
                         run_id, now, run_id, now,
                         f.get('entity_name'), metrics),
                    )
                elif row['status'] == 'resolved':
                    self._execute(
                        conn,
                        f"""UPDATE {self._t('issues')} SET
                                status = 'regressed',
                                times_regressed = times_regressed + 1,
                                last_detected_run = %s,
                                last_detected_at = %s,
                                resolved_run = NULL,
                                resolved_at = NULL,
                                resolution_reason = NULL,
                                owner_login = %s,
                                owner_email = %s,
                                entity_name = %s,
                                metrics_json = %s
                            WHERE issue_id = %s""",
                        (run_id, now, owner_login, f.get('owner_email'),
                         f.get('entity_name'), metrics, row['issue_id']),
                    )
                else:
                    self._execute(
                        conn,
                        f"""UPDATE {self._t('issues')} SET
                                last_detected_run = %s,
                                last_detected_at = %s,
                                owner_login = %s,
                                owner_email = %s,
                                entity_name = %s,
                                metrics_json = %s
                            WHERE issue_id = %s""",
                        (run_id, now, owner_login, f.get('owner_email'),
                         f.get('entity_name'), metrics, row['issue_id']),
                    )

            # 8. INSERT run_sections
            for section_key, sec_info in sections.items():
                sec_status = sec_info.get('status', 'success')
                is_complete = 1 if sec_status == 'success' else 0
                self._execute(
                    conn,
                    f"""INSERT INTO {self._t('run_sections')}
                           (run_id, section_key, status, is_complete, error_message)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (run_id, section_key) DO NOTHING""",
                    (run_id, section_key, sec_status, is_complete, sec_info.get('error_message')),
                )

            # Update coverage_status
            all_statuses = [s.get('status', 'success') for s in sections.values()]
            if all(s == 'success' for s in all_statuses):
                coverage = 'complete'
            elif any(s == 'error' for s in all_statuses):
                coverage = 'failed'
            else:
                coverage = 'partial'
            self._execute(
                conn,
                f"UPDATE {self._t('runs')} SET coverage_status = %s WHERE run_id = %s",
                (coverage, run_id),
            )

            # 9. Coverage-gated auto-resolve
            complete_sections = set()
            for section_key, sec_info in sections.items():
                if sec_info.get('status') == 'success':
                    complete_sections.add(section_key)

            safe_campaigns = set()
            for campaign_id, required in CAMPAIGN_REQUIRED_SECTIONS.items():
                if all(s in complete_sections for s in required):
                    safe_campaigns.add(campaign_id)

            if safe_campaigns:
                placeholders = ','.join(['%s'] * len(safe_campaigns))
                open_issues = self._query(
                    conn,
                    f"""SELECT issue_id, campaign_id, entity_type, entity_key
                        FROM {self._t('issues')}
                        WHERE instance_id = %s
                          AND status IN ('open', 'regressed')
                          AND campaign_id IN ({placeholders})""",
                    (instance_id, *sorted(safe_campaigns)),
                )

                for issue in open_issues:
                    key = (issue['campaign_id'], issue['entity_type'], issue['entity_key'])
                    if key in finding_keys_this_run:
                        continue

                    etype = issue['entity_type']
                    ekey = issue['entity_key']
                    if (etype, ekey) in entities_this_run:
                        reason = 'condition_cleared'
                    else:
                        reason = 'entity_deleted'

                    self._execute(
                        conn,
                        f"""UPDATE {self._t('issues')} SET
                                status = 'resolved',
                                resolved_run = %s,
                                resolved_at = %s,
                                resolution_reason = %s
                            WHERE issue_id = %s""",
                        (run_id, now, reason, issue['issue_id']),
                    )

            conn.commit()
            return run_id

        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Query methods
    # ------------------------------------------------------------------

    def list_runs(self, instance_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        self._init_tables()
        conn = self._get_connection()
        try:
            if instance_id:
                rows = self._query(
                    conn,
                    f"SELECT * FROM {self._t('runs')} WHERE instance_id = %s ORDER BY run_id DESC LIMIT %s OFFSET %s",
                    (instance_id, limit, offset),
                )
            else:
                rows = self._query(
                    conn,
                    f"SELECT * FROM {self._t('runs')} ORDER BY run_id DESC LIMIT %s OFFSET %s",
                    (limit, offset),
                )
            return rows
        finally:
            conn.close()

    def get_run(self, run_id: int) -> Optional[Dict[str, Any]]:
        self._init_tables()
        conn = self._get_connection()
        try:
            result = self._query_one(
                conn,
                f"SELECT * FROM {self._t('runs')} WHERE run_id = %s",
                (run_id,),
            )
            if not result:
                return None

            summaries = self._query(
                conn,
                f"SELECT * FROM {self._t('run_campaign_summaries')} WHERE run_id = %s",
                (run_id,),
            )
            result['campaign_summaries'] = summaries

            hm = self._query_one(
                conn,
                f"SELECT * FROM {self._t('run_health_metrics')} WHERE run_id = %s",
                (run_id,),
            )
            result['health_metrics'] = hm

            secs = self._query(
                conn,
                f"SELECT * FROM {self._t('run_sections')} WHERE run_id = %s",
                (run_id,),
            )
            result['sections'] = secs

            return result
        finally:
            conn.close()

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
        conn = self._get_connection()
        try:
            conditions = []
            params: list = []
            if instance_id:
                conditions.append('instance_id = %s')
                params.append(instance_id)
            if status:
                conditions.append('status = %s')
                params.append(status)
            if campaign_id:
                conditions.append('campaign_id = %s')
                params.append(campaign_id)
            if owner_login:
                conditions.append('owner_login = %s')
                params.append(owner_login)

            where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''
            params.extend([limit, offset])
            rows = self._query(
                conn,
                f"SELECT * FROM {self._t('issues')}{where} ORDER BY issue_id DESC LIMIT %s OFFSET %s",
                tuple(params),
            )
            for d in rows:
                if d.get('metrics_json') and isinstance(d['metrics_json'], str):
                    try:
                        d['metrics_json'] = json.loads(d['metrics_json'])
                    except (json.JSONDecodeError, TypeError):
                        pass
            return rows
        finally:
            conn.close()

    def get_issue(self, issue_id: int) -> Optional[Dict[str, Any]]:
        self._init_tables()
        conn = self._get_connection()
        try:
            result = self._query_one(
                conn,
                f"SELECT * FROM {self._t('issues')} WHERE issue_id = %s",
                (issue_id,),
            )
            if not result:
                return None

            findings = self._query(
                conn,
                f"""SELECT f.* FROM {self._t('findings')} f
                    WHERE f.campaign_id = %s AND f.entity_type = %s AND f.entity_key = %s
                    ORDER BY f.run_id DESC""",
                (result['campaign_id'], result['entity_type'], result['entity_key']),
            )
            result['finding_history'] = findings

            emails = self._query(
                conn,
                f"""SELECT oe.* FROM {self._t('outreach_emails')} oe
                    JOIN {self._t('outreach_email_issues')} oei ON oe.email_id = oei.email_id
                    WHERE oei.issue_id = %s
                    ORDER BY oe.sent_at DESC""",
                (issue_id,),
            )
            result['email_history'] = emails

            notes = self._query(
                conn,
                f"SELECT * FROM {self._t('issue_notes')} WHERE issue_id = %s ORDER BY created_at DESC",
                (issue_id,),
            )
            result['notes'] = notes

            return result
        finally:
            conn.close()

    def list_all_user_compliance(self, instance_id: Optional[str] = None) -> List[Dict[str, Any]]:
        self._init_tables()
        conn = self._get_connection()
        try:
            # Inline the v_user_compliance view logic since we can't create views portably
            base_query = f"""
                SELECT
                    i.owner_login,
                    i.owner_email,
                    i.campaign_id,
                    COUNT(CASE WHEN i.status = 'open' THEN 1 END) AS open_issues,
                    COUNT(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolved_issues,
                    COUNT(CASE WHEN i.status = 'regressed' THEN 1 END) AS regressed_issues,
                    SUM(i.times_emailed) AS total_emails_sent,
                    MAX(i.last_emailed_at) AS last_emailed,
                    MIN(i.first_detected_at) AS earliest_issue
                FROM {self._t('issues')} i
            """
            if instance_id:
                rows = self._query(
                    conn,
                    base_query + " WHERE i.instance_id = %s GROUP BY i.owner_login, i.owner_email, i.campaign_id",
                    (instance_id,),
                )
            else:
                rows = self._query(
                    conn,
                    base_query + " GROUP BY i.owner_login, i.owner_email, i.campaign_id",
                )
            return rows
        finally:
            conn.close()

    def get_user_compliance(self, login: str) -> List[Dict[str, Any]]:
        self._init_tables()
        conn = self._get_connection()
        try:
            rows = self._query(
                conn,
                f"""SELECT
                        i.owner_login,
                        i.owner_email,
                        i.campaign_id,
                        COUNT(CASE WHEN i.status = 'open' THEN 1 END) AS open_issues,
                        COUNT(CASE WHEN i.status = 'resolved' THEN 1 END) AS resolved_issues,
                        COUNT(CASE WHEN i.status = 'regressed' THEN 1 END) AS regressed_issues,
                        SUM(i.times_emailed) AS total_emails_sent,
                        MAX(i.last_emailed_at) AS last_emailed,
                        MIN(i.first_detected_at) AS earliest_issue
                    FROM {self._t('issues')} i
                    WHERE i.owner_login = %s
                    GROUP BY i.owner_login, i.owner_email, i.campaign_id""",
                (login,),
            )
            return rows
        finally:
            conn.close()

    def add_issue_note(self, issue_id: int, note: str, created_by: Optional[str] = None) -> int:
        self._init_tables()
        now = _now_iso()
        conn = self._get_connection()
        try:
            note_id = self._execute_returning(
                conn,
                f"""INSERT INTO {self._t('issue_notes')} (issue_id, created_at, created_by, note)
                    VALUES (%s, %s, %s, %s) RETURNING note_id""",
                (issue_id, now, created_by, note),
            )
            conn.commit()
            return note_id
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def compare_runs(self, run_id_1: int, run_id_2: int) -> Dict[str, Any]:
        self._init_tables()
        conn = self._get_connection()
        try:
            r1 = self._query_one(conn, f"SELECT * FROM {self._t('runs')} WHERE run_id = %s", (run_id_1,))
            r2 = self._query_one(conn, f"SELECT * FROM {self._t('runs')} WHERE run_id = %s", (run_id_2,))
            if not r1 or not r2:
                return {'error': 'One or both runs not found'}

            s1 = self._query(
                conn,
                f"SELECT campaign_id, finding_count, recipient_count FROM {self._t('run_campaign_summaries')} WHERE run_id = %s",
                (run_id_1,),
            )
            s2 = self._query(
                conn,
                f"SELECT campaign_id, finding_count, recipient_count FROM {self._t('run_campaign_summaries')} WHERE run_id = %s",
                (run_id_2,),
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

            resolved = self._query(
                conn,
                f"SELECT * FROM {self._t('issues')} WHERE resolved_run = %s AND first_detected_run <= %s",
                (run_id_2, run_id_1),
            )
            opened = self._query(
                conn,
                f"SELECT * FROM {self._t('issues')} WHERE first_detected_run = %s",
                (run_id_2,),
            )
            regressed = self._query(
                conn,
                f"SELECT * FROM {self._t('issues')} WHERE status = 'regressed' AND last_detected_run = %s",
                (run_id_2,),
            )

            return {
                'run1': r1,
                'run2': r2,
                'campaign_deltas': deltas,
                'issues_resolved': resolved,
                'issues_opened': opened,
                'issues_regressed': regressed,
            }
        finally:
            conn.close()

    def get_dashboard(self, instance_id: Optional[str] = None) -> Dict[str, Any]:
        self._init_tables()
        conn = self._get_connection()
        try:
            cond = ' WHERE instance_id = %s' if instance_id else ''
            params: tuple = (instance_id,) if instance_id else ()

            total_runs = self._query_one(
                conn, f"SELECT COUNT(*) AS cnt FROM {self._t('runs')}{cond}", params,
            )['cnt']

            issue_cond = f" WHERE instance_id = %s AND status IN ('open', 'regressed')" if instance_id else " WHERE status IN ('open', 'regressed')"
            open_issues = self._query_one(
                conn, f"SELECT COUNT(*) AS cnt FROM {self._t('issues')}{issue_cond}", params,
            )['cnt']

            resolved_cond = f" WHERE instance_id = %s AND status = 'resolved'" if instance_id else " WHERE status = 'resolved'"
            resolved_issues = self._query_one(
                conn, f"SELECT COUNT(*) AS cnt FROM {self._t('issues')}{resolved_cond}", params,
            )['cnt']

            email_cond = f" WHERE run_id IN (SELECT run_id FROM {self._t('runs')} WHERE instance_id = %s)" if instance_id else ''
            total_emails = self._query_one(
                conn, f"SELECT COUNT(*) AS cnt FROM {self._t('outreach_emails')}{email_cond}", params,
            )['cnt']

            campaign_cond = ' WHERE instance_id = %s' if instance_id else ''
            campaign_stats = self._query(
                conn,
                f"""SELECT campaign_id,
                       COUNT(CASE WHEN status IN ('open', 'regressed') THEN 1 END) AS open_count,
                       COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS resolved_count,
                       COUNT(*) AS total_count
                    FROM {self._t('issues')}{campaign_cond}
                    GROUP BY campaign_id""",
                params,
            )

            latest_run = self._query_one(
                conn,
                f"SELECT * FROM {self._t('runs')}{cond} ORDER BY run_id DESC LIMIT 1",
                params,
            )

            # Stale outreach: issues with status open/regressed, times_emailed > 0
            stale = self._query_one(
                conn,
                f"""SELECT COUNT(*) AS cnt FROM {self._t('issues')}
                    WHERE status IN ('open', 'regressed') AND times_emailed > 0""",
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
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Campaign settings
    # ------------------------------------------------------------------

    def get_campaign_settings(self) -> Dict[str, bool]:
        self._init_tables()
        conn = self._get_connection()
        try:
            rows = self._query(conn, f"SELECT campaign_id, enabled FROM {self._t('campaign_settings')}")
            return {r['campaign_id']: bool(r['enabled']) for r in rows}
        finally:
            conn.close()

    def set_campaign_enabled(self, campaign_id: str, enabled: bool) -> None:
        self._init_tables()
        now = _now_iso()
        conn = self._get_connection()
        try:
            self._execute(
                conn,
                f"""INSERT INTO {self._t('campaign_settings')} (campaign_id, enabled, updated_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (campaign_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at""",
                (campaign_id, 1 if enabled else 0, now),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_disabled_campaigns(self) -> set:
        self._init_tables()
        conn = self._get_connection()
        try:
            rows = self._query(
                conn,
                f"SELECT campaign_id FROM {self._t('campaign_settings')} WHERE enabled = 0",
            )
            return {r['campaign_id'] for r in rows}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Campaign exemptions
    # ------------------------------------------------------------------

    def get_exemptions(self, campaign_id: str = None) -> list:
        self._init_tables()
        conn = self._get_connection()
        try:
            if campaign_id:
                rows = self._query(
                    conn,
                    f"SELECT * FROM {self._t('campaign_exemptions')} WHERE campaign_id = %s ORDER BY created_at DESC",
                    (campaign_id,),
                )
            else:
                rows = self._query(
                    conn,
                    f"SELECT * FROM {self._t('campaign_exemptions')} ORDER BY created_at DESC",
                )
            return rows
        finally:
            conn.close()

    def get_exemption_set(self) -> set:
        self._init_tables()
        conn = self._get_connection()
        try:
            rows = self._query(
                conn,
                f"SELECT campaign_id, entity_key FROM {self._t('campaign_exemptions')}",
            )
            return {(r['campaign_id'], r['entity_key']) for r in rows}
        finally:
            conn.close()

    def add_exemption(self, campaign_id: str, entity_key: str, reason: str = None) -> dict:
        self._init_tables()
        now = _now_iso()
        conn = self._get_connection()
        try:
            self._execute(
                conn,
                f"""INSERT INTO {self._t('campaign_exemptions')}
                       (campaign_id, entity_type, entity_key, reason, created_at)
                    VALUES (%s, 'project', %s, %s, %s)
                    ON CONFLICT (campaign_id, entity_type, entity_key) DO UPDATE SET
                        reason = EXCLUDED.reason,
                        created_at = EXCLUDED.created_at""",
                (campaign_id, entity_key, reason, now),
            )
            conn.commit()
            row = self._query_one(
                conn,
                f"SELECT * FROM {self._t('campaign_exemptions')} WHERE campaign_id = %s AND entity_key = %s",
                (campaign_id, entity_key),
            )
            return row if row else {}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def remove_exemption(self, exemption_id: int) -> bool:
        self._init_tables()
        conn = self._get_connection()
        try:
            cnt = self._execute(
                conn,
                f"DELETE FROM {self._t('campaign_exemptions')} WHERE exemption_id = %s",
                (exemption_id,),
            )
            conn.commit()
            return cnt > 0
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def resolve_issue_ids_for_preview(
        self,
        instance_id: str,
        campaign_id: str,
        entity_keys: List[Tuple[str, str]],
    ) -> List[int]:
        if not entity_keys:
            return []
        self._init_tables()
        conn = self._get_connection()
        try:
            issue_ids = []
            for entity_type, entity_key in entity_keys:
                row = self._query_one(
                    conn,
                    f"""SELECT issue_id FROM {self._t('issues')}
                        WHERE instance_id = %s AND campaign_id = %s
                          AND entity_type = %s AND entity_key = %s
                          AND status IN ('open', 'regressed')""",
                    (instance_id, campaign_id, entity_type, entity_key),
                )
                if row:
                    issue_ids.append(row['issue_id'])
            return issue_ids
        finally:
            conn.close()

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
        now = _now_iso()
        conn = self._get_connection()
        try:
            email_id = self._execute_returning(
                conn,
                f"""INSERT INTO {self._t('outreach_emails')}
                       (run_id, campaign_id, recipient_login, recipient_email,
                        sent_at, status, error_message, subject, channel_id, sent_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING email_id""",
                (run_id, campaign_id, recipient_login, recipient_email,
                 now, status, error_message, subject, channel_id, sent_by),
            )

            if linked_issue_ids and status == 'sent':
                for iid in linked_issue_ids:
                    self._execute(
                        conn,
                        f"""INSERT INTO {self._t('outreach_email_issues')} (email_id, issue_id)
                            VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                        (email_id, iid),
                    )
                placeholders = ','.join(['%s'] * len(linked_issue_ids))
                self._execute(
                    conn,
                    f"""UPDATE {self._t('issues')} SET
                            times_emailed = times_emailed + 1,
                            last_emailed_at = %s
                        WHERE issue_id IN ({placeholders})""",
                    (now, *linked_issue_ids),
                )

            conn.commit()
            return email_id
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Migration support: bulk read all data from tables
    # ------------------------------------------------------------------

    def get_all_table_data(self, table: str) -> List[Dict[str, Any]]:
        """Read all rows from a table. Used during migration."""
        self._init_tables()
        conn = self._get_connection()
        try:
            return self._query(conn, f"SELECT * FROM {self._t(table)}")
        finally:
            conn.close()

    def get_row_counts(self) -> Dict[str, int]:
        """Return row counts for all tracking tables."""
        self._init_tables()
        tables = [
            'schema_version', 'instances', 'runs', 'run_health_metrics',
            'run_campaign_summaries', 'run_sections', 'findings', 'issues',
            'outreach_emails', 'outreach_email_issues', 'known_users',
            'known_projects', 'issue_notes', 'campaign_settings', 'campaign_exemptions',
        ]
        conn = self._get_connection()
        try:
            counts = {}
            for tbl in tables:
                try:
                    row = self._query_one(conn, f"SELECT COUNT(*) AS cnt FROM {self._t(tbl)}")
                    counts[tbl] = row['cnt'] if row else 0
                except Exception:
                    counts[tbl] = -1
            return counts
        finally:
            conn.close()

    def insert_migration_rows(self, table: str, rows: List[Dict[str, Any]]) -> int:
        """Insert rows during migration. Uses explicit column names from the first row.
        Returns number of rows inserted.
        """
        if not rows:
            return 0
        self._init_tables()
        conn = self._get_connection()
        try:
            cols = list(rows[0].keys())
            col_list = ', '.join(cols)
            placeholders = ', '.join(['%s'] * len(cols))
            inserted = 0
            cur = conn.cursor()
            try:
                for row in rows:
                    vals = tuple(row.get(c) for c in cols)
                    cur.execute(
                        f"INSERT INTO {self._t(table)} ({col_list}) VALUES ({placeholders}) "
                        f"ON CONFLICT DO NOTHING",
                        vals,
                    )
                    inserted += cur.rowcount
            finally:
                cur.close()
            conn.commit()
            return inserted
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def reset_sequences(self):
        """Reset Postgres sequences to MAX(id)+1 after migration."""
        self._init_tables()
        seq_tables = [
            ('runs', 'run_id'),
            ('findings', 'finding_id'),
            ('issues', 'issue_id'),
            ('outreach_emails', 'email_id'),
            ('issue_notes', 'note_id'),
            ('campaign_exemptions', 'exemption_id'),
        ]
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            try:
                for table, col in seq_tables:
                    seq_name = f"{self._t(table)}_{col}_seq"
                    cur.execute(
                        f"SELECT setval('{seq_name}', COALESCE((SELECT MAX({col}) FROM {self._t(table)}), 0) + 1, false)"
                    )
            finally:
                cur.close()
            conn.commit()
        except Exception as exc:
            conn.rollback()
            _log.warning("Failed to reset sequences (may not be Postgres): %s", exc)
        finally:
            conn.close()
