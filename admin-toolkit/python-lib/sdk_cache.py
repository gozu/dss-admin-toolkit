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
        self._mem: Dict[Tuple[str, str], Tuple[float, Any]] = {}  # (instance_id, key) → (fetched_at, value)
        self._mem_lock = threading.Lock()
        self._stats = {'hits_mem': 0, 'hits_sql': 0, 'misses': 0, 'writes': 0, 'sql_ms': 0.0}
        self._stats_lock = threading.Lock()
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
        t0 = time.time()
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            rows = executor.query_to_df(sql).to_dict('records')
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
            if rows:
                _log.info("[perf:sdk_cache:sql] SELECT key=%s elapsed=%.1fms hit=%s", cache_key, elapsed_ms, True)
                return json.loads(rows[0]['response_json'])
            _log.info("[perf:sdk_cache:sql] SELECT key=%s elapsed=%.1fms hit=%s", cache_key, elapsed_ms, False)
        except Exception as exc:
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
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
        t0 = time.time()
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            executor.query_to_df(del_sql)
            executor.query_to_df(ins_sql)
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
                self._stats['writes'] += 1
            _log.info("[perf:sdk_cache:sql] INSERT key=%s elapsed=%.1fms", cache_key, elapsed_ms)
        except Exception as exc:
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
            _log.warning("[sdk_cache] _sql_set failed for key=%s: %s", cache_key, exc)

    def get_or_fetch(
        self,
        instance_id: str,
        cache_key: str,
        ttl_seconds: int,
        fetch_fn: Callable[[], Any],
        deadline_ts: Optional[float] = None,
    ) -> Any:
        # 0. Check L1 memory cache
        mem_key = (instance_id, cache_key)
        with self._mem_lock:
            entry = self._mem.get(mem_key)
            if entry is not None:
                fetched_at, value = entry
                if (time.time() - fetched_at) < ttl_seconds:
                    with self._stats_lock:
                        self._stats['hits_mem'] += 1
                    return value

        # 1. Check SQL — if fresh row exists, return immediately
        result = self._sql_get(instance_id, cache_key, ttl_seconds)
        if result is not None:
            with self._stats_lock:
                self._stats['hits_sql'] += 1
            with self._mem_lock:
                self._mem[mem_key] = (time.time(), result)
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
            if result is not None:
                with self._mem_lock:
                    self._mem[mem_key] = (time.time(), result)
                return result
            return fetch_fn()  # fallback if owner failed

        # 3. This thread is the owner — make the API call
        try:
            result = fetch_fn()
            self._sql_set(instance_id, cache_key, ttl_seconds, result)
            with self._mem_lock:
                self._mem[mem_key] = (time.time(), result)
            with self._stats_lock:
                self._stats['misses'] += 1
            return result
        finally:
            with _IN_FLIGHT_LOCK:
                _IN_FLIGHT.pop(flight_key, None)
            event.set()  # wake up all waiters

    def set_many(self, instance_id: str, items: Dict[str, Any], ttl_seconds: int) -> None:
        """Batch-write multiple cache entries in one SQL round-trip."""
        if not items:
            return
        now = time.time()
        # Populate L1 only for JSON-serializable values
        serializable: Dict[str, str] = {}
        for k, v in items.items():
            try:
                serializable[k] = json.dumps(v)
            except Exception:
                continue
        with self._mem_lock:
            for k in serializable:
                self._mem[(instance_id, k)] = (now, items[k])
        if not self._conn:
            return
        tbl = _q(self._prefix, 'api_cache')
        now_ms = int(now * 1000)
        keys = list(items.keys())
        t0 = time.time()
        try:
            import dataiku
            executor = dataiku.SQLExecutor2(connection=self._conn)
            key_list = ', '.join(_L(k) for k in keys)
            del_sql = (
                f"DELETE FROM {tbl}"
                f" WHERE instance_id = {_L(instance_id)}"
                f" AND cache_key IN ({key_list})"
            )
            executor.query_to_df(del_sql)
            values = []
            for k, rj in serializable.items():
                values.append(
                    f"({_L(instance_id)}, {_L(k)}, {_L(now_ms)}, {_L(ttl_seconds)}, {_L(rj)})"
                )
            if values:
                ins_sql = (
                    f"INSERT INTO {tbl}"
                    f" (instance_id, cache_key, fetched_at, ttl_seconds, response_json)"
                    f" VALUES {', '.join(values)}"
                )
                executor.query_to_df(ins_sql)
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
                self._stats['writes'] += len(values)
            _log.info("[perf:sdk_cache:sql] BATCH_INSERT keys=%d elapsed=%.1fms", len(values), elapsed_ms)
        except Exception as exc:
            elapsed_ms = (time.time() - t0) * 1000.0
            with self._stats_lock:
                self._stats['sql_ms'] += elapsed_ms
            _log.warning("[sdk_cache] set_many failed: %s", exc)

    def get(self, instance_id: str, cache_key: str, ttl_seconds: int) -> Optional[Any]:
        """Read-only check of L1 + SQL cache. Returns None on miss."""
        mem_key = (instance_id, cache_key)
        with self._mem_lock:
            entry = self._mem.get(mem_key)
            if entry is not None:
                fetched_at, value = entry
                if (time.time() - fetched_at) < ttl_seconds:
                    with self._stats_lock:
                        self._stats['hits_mem'] += 1
                    return value
                del self._mem[mem_key]  # evict expired entry
        result = self._sql_get(instance_id, cache_key, ttl_seconds)
        if result is not None:
            with self._stats_lock:
                self._stats['hits_sql'] += 1
            with self._mem_lock:
                self._mem[mem_key] = (time.time(), result)
        return result

    def get_mem(self, instance_id: str, cache_key: str, ttl_seconds: int) -> Optional[Any]:
        """L1 memory-only cache check. No SQL. Returns None on miss."""
        mem_key = (instance_id, cache_key)
        with self._mem_lock:
            entry = self._mem.get(mem_key)
            if entry is not None:
                fetched_at, value = entry
                if (time.time() - fetched_at) < ttl_seconds:
                    with self._stats_lock:
                        self._stats['hits_mem'] += 1
                    return value
                del self._mem[mem_key]  # evict expired entry
        return None

    def get_stats(self) -> Dict[str, Any]:
        with self._stats_lock:
            stats = dict(self._stats)
        stats['sql_ms'] = round(stats['sql_ms'], 1)
        return stats

    def get_cache_keys(self) -> list:
        now = time.time()
        with self._mem_lock:
            return [
                {'key': f"{iid}:{ck}", 'age_s': round(now - fetched_at, 1)}
                for (iid, ck), (fetched_at, _) in self._mem.items()
            ]

    def invalidate_all(self, instance_id: str) -> None:
        with self._mem_lock:
            to_remove = [k for k in self._mem if k[0] == instance_id]
            for k in to_remove:
                del self._mem[k]
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
