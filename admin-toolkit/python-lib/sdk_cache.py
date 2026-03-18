"""SQL-backed API result cache with in-flight deduplication for DSS SDK calls.

Uses Dataiku SQLExecutor2.query_to_df() exclusively — no raw connections,
no cursors.  Database-agnostic: no PostgreSQL-specific syntax.
"""

import json
import logging
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

_log = logging.getLogger(__name__)

_IN_FLIGHT: Dict[Tuple[str, str], threading.Event] = {}
_IN_FLIGHT_LOCK = threading.Lock()


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


def _q(prefix: Optional[str], table: str) -> str:
    """Prefix a table name (e.g. 'adtk' + 'api_cache' → 'adtk_api_cache')."""
    if prefix:
        return f"{prefix}_{table}"
    return table


class SdkApiCache:
    def __init__(self, connection_name: Optional[str], table_prefix: Optional[str] = None):
        self._conn = connection_name
        self._prefix = table_prefix
        self._init_tables()

    def _init_tables(self) -> None:
        if not self._conn:
            return
        tbl = _q(self._prefix, 'api_cache')
        sql = (
            f"CREATE TABLE IF NOT EXISTS {tbl} ("
            f"  instance_id   VARCHAR(255)  NOT NULL,"
            f"  cache_key     VARCHAR(255)  NOT NULL,"
            f"  fetched_at    BIGINT        NOT NULL,"
            f"  ttl_seconds   INT           NOT NULL,"
            f"  response_json TEXT          NOT NULL,"
            f"  PRIMARY KEY (instance_id, cache_key)"
            f")"
        )
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            executor.query_to_df(sql)
        except Exception as exc:
            _log.warning("[sdk_cache] _init_tables failed: %s", exc)

    def _sql_get(self, instance_id: str, cache_key: str, ttl_seconds: int) -> Optional[Any]:
        if not self._conn:
            return None
        tbl = _q(self._prefix, 'api_cache')
        now_ms = int(time.time() * 1000)
        min_fetched_at = now_ms - (ttl_seconds * 1000)
        sql = (
            f"SELECT response_json FROM {tbl}"
            f" WHERE instance_id = {_L(instance_id)}"
            f" AND cache_key = {_L(cache_key)}"
            f" AND fetched_at > {_L(min_fetched_at)}"
        )
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            rows = executor.query_to_df(sql).to_dict('records')
            if rows:
                return json.loads(rows[0]['response_json'])
        except Exception as exc:
            _log.debug("[sdk_cache] _sql_get failed: %s", exc)
        return None

    def _sql_set(self, instance_id: str, cache_key: str, ttl_seconds: int, value: Any) -> None:
        if not self._conn:
            return
        tbl = _q(self._prefix, 'api_cache')
        now_ms = int(time.time() * 1000)
        try:
            response_json = json.dumps(value)
        except Exception as exc:
            _log.debug("[sdk_cache] _sql_set json.dumps failed for key=%s: %s", cache_key, exc)
            return
        del_sql = (
            f"DELETE FROM {tbl}"
            f" WHERE instance_id = {_L(instance_id)}"
            f" AND cache_key = {_L(cache_key)}"
        )
        ins_sql = (
            f"INSERT INTO {tbl}"
            f" (instance_id, cache_key, fetched_at, ttl_seconds, response_json)"
            f" VALUES ({_L(instance_id)}, {_L(cache_key)}, {_L(now_ms)}, {_L(ttl_seconds)}, {_L(response_json)})"
        )
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            executor.query_to_df(del_sql)
            executor.query_to_df(ins_sql)
        except Exception as exc:
            _log.warning("[sdk_cache] _sql_set failed for key=%s: %s", cache_key, exc)

    def get_or_fetch(
        self,
        instance_id: str,
        cache_key: str,
        ttl_seconds: int,
        fetch_fn: Callable[[], Any],
        deadline_ts: Optional[float] = None,
    ) -> Any:
        # 1. Check SQL — if fresh row exists, return immediately
        result = self._sql_get(instance_id, cache_key, ttl_seconds)
        if result is not None:
            return result

        # 2. Check _IN_FLIGHT — if same key already being fetched, wait
        flight_key = (instance_id, cache_key)
        with _IN_FLIGHT_LOCK:
            if flight_key in _IN_FLIGHT:
                event = _IN_FLIGHT[flight_key]
                is_owner = False
            else:
                event = threading.Event()
                _IN_FLIGHT[flight_key] = event
                is_owner = True

        if not is_owner:
            timeout = max(1.0, deadline_ts - time.time()) if deadline_ts else 120.0
            event.wait(timeout=timeout)
            result = self._sql_get(instance_id, cache_key, ttl_seconds)
            return result if result is not None else fetch_fn()  # fallback if owner failed

        # 3. This thread is the owner — make the API call
        try:
            result = fetch_fn()
            self._sql_set(instance_id, cache_key, ttl_seconds, result)
            return result
        finally:
            with _IN_FLIGHT_LOCK:
                _IN_FLIGHT.pop(flight_key, None)
            event.set()  # wake up all waiters

    def invalidate_all(self, instance_id: str) -> None:
        if not self._conn:
            return
        tbl = _q(self._prefix, 'api_cache')
        sql = f"DELETE FROM {tbl} WHERE instance_id = {_L(instance_id)}"
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            executor.query_to_df(sql)
            _log.info("[sdk_cache] invalidated all for instance_id=%s", instance_id)
        except Exception as exc:
            _log.warning("[sdk_cache] invalidate_all failed: %s", exc)
