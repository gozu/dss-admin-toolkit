"""
Backend factory for tracking database.

Selects between SQLite (TrackingDB) and SQL connection (SQLTrackingDB)
based on plugin configuration.
"""

import logging
from dataclasses import dataclass
from typing import Optional

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TrackingBackendConfig:
    """Plugin-level configuration for the tracking backend."""
    connection_name: Optional[str] = None
    schema_name: Optional[str] = None


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
        schema = (config.get('tracking_db_schema') or '').strip() or None
        return TrackingBackendConfig(connection_name=conn, schema_name=schema)
    except Exception as exc:
        _log.debug("Could not load plugin config (expected in dev): %s", exc)
        return TrackingBackendConfig()


def create_tracking_backend(config: TrackingBackendConfig, sqlite_path: str):
    """Return the appropriate tracking DB backend.

    If a SQL connection is configured, returns SQLTrackingDB.
    Otherwise returns the SQLite-based TrackingDB.
    """
    if config.connection_name:
        _log.info("Using SQL backend: connection=%s schema=%s",
                   config.connection_name, config.schema_name)
        from sql_tracking import SQLTrackingDB
        return SQLTrackingDB(config.connection_name, config.schema_name)
    else:
        _log.info("Using SQLite backend: %s", sqlite_path)
        from tracking import TrackingDB
        return TrackingDB(sqlite_path)
