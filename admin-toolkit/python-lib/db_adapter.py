"""
Backend factory for tracking database.

Selects between SQLite (TrackingDB) and SQL connection (SQLTrackingDB)
based on plugin configuration.
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

_log = logging.getLogger(__name__)

_PREFIX_RE = re.compile(r'^[a-z][a-z0-9_]{0,20}$')


@dataclass(frozen=True)
class TrackingBackendConfig:
    """Plugin-level configuration for the tracking backend."""
    connection_name: Optional[str] = None
    table_prefix: Optional[str] = None


def load_tracking_backend_config() -> TrackingBackendConfig:
    """Read tracking backend config from plugin settings.

    Returns a config with None values if plugin API is unavailable
    (falls back to SQLite).
    """
    try:
        import dataiku
        client = dataiku.api_client()
        raw = client.get_plugin('admin-toolkit').get_settings().get_raw()
        config = raw.get('config', {}) if isinstance(raw, dict) else {}
        conn = (config.get('tracking_db_connection') or '').strip() or None
        raw_prefix = (config.get('tracking_table_prefix') or '').strip().lower()
        if raw_prefix:
            if not _PREFIX_RE.match(raw_prefix):
                _log.warning("Invalid table prefix %r — must match %s. Using default 'adtk'.",
                             raw_prefix, _PREFIX_RE.pattern)
                raw_prefix = 'adtk'
            prefix = raw_prefix
        else:
            prefix = 'adtk'
        return TrackingBackendConfig(connection_name=conn, table_prefix=prefix)
    except Exception as exc:
        _log.debug("Could not load plugin config (expected in dev): %s", exc)
        return TrackingBackendConfig(table_prefix='adtk')


def create_tracking_backend(config: TrackingBackendConfig, sqlite_path: str):
    """Return the appropriate tracking DB backend.

    If a SQL connection is configured, returns SQLTrackingDB.
    Otherwise returns the SQLite-based TrackingDB.
    """
    if config.connection_name:
        _log.info("Using SQL backend: connection=%s table_prefix=%s",
                   config.connection_name, config.table_prefix)
        from sql_tracking import SQLTrackingDB
        return SQLTrackingDB(config.connection_name, config.table_prefix)
    else:
        _log.info("Using SQLite backend: %s", sqlite_path)
        from tracking import TrackingDB
        return TrackingDB(sqlite_path)
