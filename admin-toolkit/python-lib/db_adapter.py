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


@dataclass(frozen=True)
class DbHealthConfig:
    """Plugin-level configuration for DB Health tool."""
    connection_name: Optional[str] = None
    password: Optional[str] = None


def load_dbhealth_config() -> DbHealthConfig:
    """Read DB Health config from plugin settings."""
    try:
        import dataiku
        client = dataiku.api_client()
        raw = client.get_plugin('admin-toolkit').get_settings().get_raw()
        config = raw.get('config', {}) if isinstance(raw, dict) else {}
        conn = (config.get('dbhealth_connection') or '').strip() or None
        pw = (config.get('dbhealth_password') or '').strip() or None
        return DbHealthConfig(connection_name=conn, password=pw)
    except Exception as exc:
        _log.debug("Could not load dbhealth config: %s", exc)
        return DbHealthConfig()


_PERF_MAP = {
    'perf_parallel_workers_default': ('parallel_workers_default', int),
    'perf_parallel_workers_max': ('parallel_workers_max', int),
    'perf_code_env_detail_workers': ('code_env_detail_workers', int),
    'perf_code_env_timeout_ms': ('code_env_timeout_ms', int),
    'perf_project_footprint_timeout_ms': ('project_footprint_timeout_ms', int),
    'perf_cache_ttl_overview': ('cache_ttl_overview', int),
    'perf_cache_ttl_projects': ('cache_ttl_projects', int),
    'perf_cache_ttl_code_envs': ('cache_ttl_code_envs', int),
    'perf_codenvclean_thread_max': ('codenvclean_thread_max', int),
    'perf_tracking_issue_page_size': ('tracking_issue_page_size', int),
}

_THRESH_MAP = {
    'thresh_inactive_project_days': ('inactiveProjectDays', int),
    'thresh_filesystem_warning_pct': ('filesystemWarningPct', int),
    'thresh_filesystem_critical_pct': ('filesystemCriticalPct', int),
    'thresh_code_env_count_unhealthy': ('codeEnvCountUnhealthy', int),
    'thresh_empty_project_kb': ('emptyProjectBytes', lambda v: int(v) * 1024),
    'thresh_health_warning_below': ('healthWarningBelow', int),
    'thresh_health_critical_below': ('healthCriticalBelow', int),
    'thresh_deprecated_python_prefixes': ('deprecatedPythonPrefixes', str),
}


def _get_plugin_config() -> dict:
    """Read raw plugin config dict. Returns {} on any error."""
    try:
        import dataiku
        client = dataiku.api_client()
        raw = client.get_plugin('admin-toolkit').get_settings().get_raw()
        return raw.get('config', {}) if isinstance(raw, dict) else {}
    except Exception as exc:
        _log.debug("Could not read plugin config: %s", exc)
        return {}


def load_plugin_performance_settings() -> dict:
    """Read perf_* plugin params and return a dict of _BACKEND_SETTINGS keys."""
    config = _get_plugin_config()
    result = {}
    for param_key, (setting_key, cast) in _PERF_MAP.items():
        val = config.get(param_key)
        if val is not None and val != '':
            try:
                result[setting_key] = cast(val)
            except (ValueError, TypeError):
                pass
    return result


def load_plugin_threshold_defaults() -> dict:
    """Read thresh_* plugin params and return a dict of frontend threshold keys."""
    config = _get_plugin_config()
    result = {}
    for param_key, (thresh_key, cast) in _THRESH_MAP.items():
        val = config.get(param_key)
        if val is not None and val != '':
            try:
                result[thresh_key] = cast(val)
            except (ValueError, TypeError):
                pass
    return result


def create_sdk_cache(config: TrackingBackendConfig) -> 'SdkApiCache':
    from sdk_cache import SdkApiCache
    return SdkApiCache(config.connection_name, config.table_prefix)


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
