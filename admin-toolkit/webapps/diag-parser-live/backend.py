import json
import math
import os
import platform
import re
import subprocess
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import logging

import dataiku
from flask import Flask, Response, jsonify, request

app = Flask(__name__)

# Suppress noisy per-request and per-project scan logging
logging.getLogger('werkzeug').setLevel(logging.WARNING)

_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_LOCK = threading.Lock()
_THREAD_LOCAL = threading.local()
_PROGRESS: Dict[str, Dict[str, Any]] = {}
_PROGRESS_LOCK = threading.Lock()
_PROGRESS_EVENT_LIMIT = 10000
_PROGRESS_RETENTION_SEC = 1800

# ── Tracking database (optional, graceful fallback) ──
try:
    from tracking import TrackingDB, extract_findings_from_outreach_data
    _tracking_available = True
except Exception:
    _tracking_available = False

_tracking_db_instance: Optional[Any] = None
_tracking_db_lock = threading.Lock()


def _get_tracking_db():
    global _tracking_db_instance
    if not _tracking_available:
        return None
    if _tracking_db_instance is not None:
        return _tracking_db_instance
    with _tracking_db_lock:
        if _tracking_db_instance is not None:
            return _tracking_db_instance
        try:
            # Store tracking DB in the webapp's 'initial' dir, which persists across
            # backend restarts (unlike the run dir which changes each restart).
            # Path: .../webappruns/<project>/<webapp>/initial/tracking.db
            db_dir = None
            for p in sys.path:
                if 'webappruns' in p and 'run_' in p:
                    initial_dir = os.path.join(os.path.dirname(p), 'initial')
                    if os.path.isdir(initial_dir) and os.access(initial_dir, os.W_OK):
                        db_dir = initial_dir
                    else:
                        db_dir = p  # fallback to run dir
                    break
            if db_dir is None:
                db_dir = '/tmp'
            db_path = os.path.join(db_dir, 'tracking.db')
            _tracking_db_instance = TrackingDB(db_path)
            _tracking_db_instance._get_conn()  # init schema
            logging.getLogger(__name__).info("[tracking] initialized at %s", db_path)
        except Exception as exc:
            logging.getLogger(__name__).warning("[tracking] init failed: %s", exc)
            _tracking_db_instance = None
    return _tracking_db_instance

# Visual / non-code recipe types that never reference a code environment.
# Skipping these avoids unnecessary per-recipe API calls.
_NON_CODE_RECIPE_TYPES = frozenset({
    'SYNC', 'JOIN', 'VSTACK', 'PIVOT', 'WINDOW', 'GROUP',
    'DISTINCT', 'SORT', 'SPLIT', 'TOPN', 'DOWNLOAD',
    'SAMPLING', 'PREPARE', 'SHAKER', 'MERGE', 'CONTINUOUS_SYNC',
})


@app.route('/__ping')
def ping():
    return jsonify({'status': 'ok'})




def _cache_get(key: str, ttl: int, loader):
    now = time.time()
    entry = _CACHE.get(key)
    if entry and now - entry['ts'] < ttl:
        return entry['value']
    value = loader()
    _CACHE[key] = {'ts': now, 'value': value}
    return value


def _cleanup_progress_locked(now_ts: float) -> None:
    stale: List[str] = []
    for endpoint, state in _PROGRESS.items():
        updated_ts = float(state.get('updatedTs') or state.get('startedTs') or now_ts)
        if (now_ts - updated_ts) > _PROGRESS_RETENTION_SEC:
            stale.append(endpoint)
    for endpoint in stale:
        _PROGRESS.pop(endpoint, None)


def _start_progress(endpoint: str) -> str:
    now_ts = time.time()
    run_id = f"{endpoint}-{int(now_ts * 1000)}-{threading.get_ident()}"
    with _PROGRESS_LOCK:
        _cleanup_progress_locked(now_ts)
        _PROGRESS[endpoint] = {
            'runId': run_id,
            'status': 'running',
            'startedTs': now_ts,
            'updatedTs': now_ts,
            'events': [],
            'nextIndex': 0,
            'droppedUntil': 0,
            'summary': None,
            'error': None,
            'partialRows': [],
            'partialRowsNext': 0,
        }
    return run_id


def _append_progress_event(endpoint: str, run_id: str, event: Dict[str, Any]) -> None:
    with _PROGRESS_LOCK:
        state = _PROGRESS.get(endpoint)
        if not isinstance(state, dict):
            return
        if str(state.get('runId') or '') != str(run_id or ''):
            return

        next_index = int(state.get('nextIndex') or 0)
        entry = dict(event)
        entry['idx'] = next_index
        events = state.get('events')
        if not isinstance(events, list):
            events = []
            state['events'] = events
        events.append(entry)
        state['nextIndex'] = next_index + 1

        if len(events) > _PROGRESS_EVENT_LIMIT:
            drop_count = len(events) - _PROGRESS_EVENT_LIMIT
            first_kept_idx = int(events[drop_count].get('idx') or (next_index + 1))
            state['droppedUntil'] = first_kept_idx
            del events[:drop_count]

        state['updatedTs'] = time.time()


def _append_progress_partial_row(endpoint: str, run_id: str, row: Dict[str, Any]) -> None:
    with _PROGRESS_LOCK:
        state = _PROGRESS.get(endpoint)
        if not isinstance(state, dict):
            return
        if str(state.get('runId') or '') != str(run_id or ''):
            return
        partial_rows = state.get('partialRows')
        if not isinstance(partial_rows, list):
            partial_rows = []
            state['partialRows'] = partial_rows
        partial_rows.append(row)
        state['partialRowsNext'] = len(partial_rows)
        state['updatedTs'] = time.time()


def _finish_progress(endpoint: str, run_id: str, status: str, summary: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    with _PROGRESS_LOCK:
        state = _PROGRESS.get(endpoint)
        if not isinstance(state, dict):
            return
        if str(state.get('runId') or '') != str(run_id or ''):
            return
        state['status'] = status
        state['summary'] = summary if isinstance(summary, dict) else None
        state['error'] = str(error or '') if error else None
        state['updatedTs'] = time.time()


def _set_progress_summary(endpoint: str, run_id: str, summary: Optional[Dict[str, Any]] = None) -> None:
    if not isinstance(summary, dict):
        return
    with _PROGRESS_LOCK:
        state = _PROGRESS.get(endpoint)
        if not isinstance(state, dict):
            return
        if str(state.get('runId') or '') != str(run_id or ''):
            return
        state['summary'] = dict(summary)
        state['updatedTs'] = time.time()


def _read_progress(endpoint: str, since: int = 0, run_id: Optional[str] = None, rows_since: int = 0) -> Dict[str, Any]:
    with _PROGRESS_LOCK:
        now_ts = time.time()
        _cleanup_progress_locked(now_ts)
        state = _PROGRESS.get(endpoint)
        if not isinstance(state, dict):
            return {
                'status': 'idle',
                'events': [],
                'next': max(0, int(since)),
            }

        current_run_id = str(state.get('runId') or '')
        dropped_until = int(state.get('droppedUntil') or 0)
        if run_id and str(run_id) != current_run_id:
            return {
                'runId': current_run_id,
                'status': 'replaced',
                'droppedUntil': dropped_until,
                'events': [],
                'next': int(state.get('nextIndex') or dropped_until),
            }

        cursor = max(int(since), dropped_until)
        events_raw = state.get('events')
        events = [dict(item) for item in events_raw if isinstance(item, dict) and int(item.get('idx', -1)) >= cursor] if isinstance(events_raw, list) else []

        partial_rows_all = state.get('partialRows')
        rows_cursor = max(0, int(rows_since))
        if isinstance(partial_rows_all, list) and rows_cursor < len(partial_rows_all):
            partial_rows = list(partial_rows_all[rows_cursor:])
        else:
            partial_rows = []
        partial_rows_next = int(state.get('partialRowsNext') or 0)

        return {
            'runId': current_run_id,
            'status': str(state.get('status') or 'idle'),
            'error': state.get('error'),
            'droppedUntil': dropped_until,
            'events': events,
            'next': int(state.get('nextIndex') or cursor),
            'summary': state.get('summary') if isinstance(state.get('summary'), dict) else None,
            'partialRows': partial_rows,
            'partialRowsNext': partial_rows_next,
        }


def _dip_home() -> str:
    dip_home = os.environ.get('DIP_HOME') or os.environ.get('DSS_HOME') or '/data/dataiku/dss_data'
    if not dip_home.endswith('/'):
        dip_home += '/'
    return dip_home


def _safe_read_text(path: str) -> Optional[str]:
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as handle:
            return handle.read()
    except Exception:
        return None


def _safe_read_json(path: str) -> Optional[Dict[str, Any]]:
    text = _safe_read_text(path)
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _coerce_log_text(payload: Any) -> Optional[str]:
    def collect(value: Any, depth: int = 0) -> List[str]:
        if depth > 6 or value is None:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, bytes):
            return [value.decode('utf-8', errors='replace')]
        if isinstance(value, list):
            out: List[str] = []
            for item in value:
                out.extend(collect(item, depth + 1))
            return out
        if isinstance(value, dict):
            ordered_keys = ['line', 'message', 'text', 'content', 'log', 'data', 'result', 'value', 'records', 'entries', 'lines']
            out: List[str] = []
            for key in ordered_keys:
                if key in value:
                    out.extend(collect(value.get(key), depth + 1))
            if out:
                return out
            for child in value.values():
                out.extend(collect(child, depth + 1))
            return out
        return [str(value)]

    lines = [line for line in collect(payload) if isinstance(line, str) and line.strip()]
    if not lines:
        return None
    return '\n'.join(lines)


def _run_command(cmd: List[str]) -> Optional[str]:
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        return output.decode('utf-8', errors='replace')
    except Exception:
        return None


def _format_size_kb(value: int) -> str:
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} GB"
    if value >= 1024:
        return f"{value / 1024:.2f} MB"
    return f"{value} KB"


def _format_size_bytes(value: int) -> str:
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} MB"
    if value >= 1024:
        return f"{value / 1024:.2f} KB"
    return f"{value} bytes"


def _format_size_human(value: int) -> str:
    if value <= 0:
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    size = float(value)
    unit_idx = 0
    while size >= 1024 and unit_idx < len(units) - 1:
        size /= 1024
        unit_idx += 1
    return f"{size:.2f} {units[unit_idx]}"


_PSEUDO_FS_TYPES = {
    'autofs',
    'bpf',
    'cgroup',
    'cgroup2',
    'configfs',
    'debugfs',
    'devpts',
    'devtmpfs',
    'efivarfs',
    'fusectl',
    'hugetlbfs',
    'mqueue',
    'nsfs',
    'proc',
    'pstore',
    'ramfs',
    'rpc_pipefs',
    'securityfs',
    'sysfs',
    'tmpfs',
    'tracefs',
}


def _read_df_mount_usage() -> List[Dict[str, Any]]:
    output = _run_command(['df', '-B1', '-PT'])
    if not output:
        return []
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) < 2:
        return []

    mounts: List[Dict[str, Any]] = []
    for line in lines[1:]:
        parts = re.split(r"\s+", line, maxsplit=6)
        if len(parts) < 7:
            continue
        filesystem, fs_type, blocks, used, available, _capacity, mount_path = parts
        try:
            mounts.append({
                'filesystem': filesystem,
                'fsType': fs_type.lower(),
                'blocks': int(blocks),
                'used': int(used),
                'available': int(available),
                'path': os.path.abspath(mount_path),
            })
        except Exception:
            continue
    return mounts


def _is_virtual_mount(mount: Dict[str, Any]) -> bool:
    fs_type = str(mount.get('fsType') or '').lower()
    mount_path = str(mount.get('path') or '')
    if fs_type in _PSEUDO_FS_TYPES:
        return True
    for prefix in ('/proc', '/sys', '/dev', '/run'):
        if mount_path == prefix or mount_path.startswith(prefix + '/'):
            return True
    return False


def _summarize_df_mounts() -> Dict[str, Any]:
    mounts = _read_df_mount_usage()
    included: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []
    for mount in mounts:
        if _is_virtual_mount(mount):
            excluded.append(mount)
        else:
            included.append(mount)

    by_path: Dict[str, int] = {}
    root_used = 0
    mounted_used = 0
    top_buckets: Dict[str, Dict[str, Any]] = {}
    for mount in included:
        mount_path = str(mount.get('path') or '/')
        used = int(mount.get('used') or 0)
        by_path[mount_path] = by_path.get(mount_path, 0) + used
        if mount_path == '/':
            root_used += used
            continue
        mounted_used += used
        top = '/' + mount_path.strip('/').split('/')[0]
        bucket = top_buckets.setdefault(top, {'size': 0, 'mounts': []})
        bucket['size'] = int(bucket.get('size') or 0) + used
        bucket['mounts'].append(mount_path)

    return {
        'included': included,
        'excluded': excluded,
        'byPath': by_path,
        'rootUsed': int(root_used),
        'mountedUsed': int(mounted_used),
        'totalUsed': int(root_used + mounted_used),
        'topBuckets': top_buckets,
    }


def _make_unscanned_usage_node(parent_path: str, depth: int, size: int, label: str) -> Dict[str, Any]:
    clean_parent = parent_path.rstrip('/') or '/'
    virtual_path = '/.unscanned' if clean_parent == '/' else f"{clean_parent}/.unscanned"
    return {
        'name': label,
        'path': virtual_path,
        'size': int(max(0, size)),
        'ownSize': int(max(0, size)),
        'isDirectory': False,
        'children': [],
        'fileCount': 0,
        'depth': depth,
        'hasHiddenChildren': False,
    }


def _overlay_mount_usage_on_node(
    node: Dict[str, Any],
    node_path: str,
    depth: int,
    mount_summary: Dict[str, Any],
    debug_state: Dict[str, Any],
) -> None:
    mount_by_path = mount_summary.get('byPath') or {}
    target_used = 0
    for mount_path, used in mount_by_path.items():
        if mount_path == node_path or mount_path.startswith(node_path.rstrip('/') + '/'):
            target_used += int(used or 0)
    if target_used <= 0:
        return

    scanned = int(node.get('size') or 0)
    if target_used <= scanned:
        return

    delta = target_used - scanned
    unknown = _make_unscanned_usage_node(node_path, depth + 1, delta, '[unscanned usage]')
    if node.get('isDirectory'):
        children = list(node.get('children') or [])
        children.append(unknown)
        children.sort(key=lambda child: int(child.get('size') or 0), reverse=True)
        node['children'] = children
        node['hasHiddenChildren'] = True
    node['size'] = target_used
    debug_state['overlayUnknownBytes'] = int(debug_state.get('overlayUnknownBytes') or 0) + int(delta)


def _apply_df_overlay_to_root_tree(root_node: Dict[str, Any], debug_state: Dict[str, Any]) -> Dict[str, Any]:
    mount_summary = _summarize_df_mounts()
    included = mount_summary.get('included') or []
    excluded = mount_summary.get('excluded') or []
    top_buckets = mount_summary.get('topBuckets') or {}

    children = list(root_node.get('children') or [])
    child_by_path: Dict[str, Dict[str, Any]] = {}
    for child in children:
        child_path = str(child.get('path') or '')
        if child_path:
            child_by_path[child_path] = child

    for top_path, bucket in top_buckets.items():
        bucket_size = int((bucket or {}).get('size') or 0)
        bucket_mounts = list((bucket or {}).get('mounts') or [])
        child = child_by_path.get(top_path)
        if child is None:
            child = {
                'name': os.path.basename(top_path) or top_path,
                'path': top_path,
                'size': 0,
                'ownSize': 0,
                'isDirectory': True,
                'children': [],
                'fileCount': 0,
                'depth': 1,
                'hasHiddenChildren': True,
            }
            children.append(child)
            child_by_path[top_path] = child

        scanned_size = int(child.get('size') or 0)
        if bucket_size > scanned_size:
            delta = bucket_size - scanned_size
            unknown = _make_unscanned_usage_node(top_path, int(child.get('depth') or 1) + 1, delta, '[unscanned usage]')
            child_children = list(child.get('children') or [])
            child_children.append(unknown)
            child_children.sort(key=lambda entry: int(entry.get('size') or 0), reverse=True)
            child['children'] = child_children
            child['size'] = bucket_size
            child['hasHiddenChildren'] = True
            debug_state['overlayUnknownBytes'] = int(debug_state.get('overlayUnknownBytes') or 0) + int(delta)
        child['mountPaths'] = sorted(set(bucket_mounts))

    root_used = int(mount_summary.get('rootUsed') or 0)
    mounted_used = int(mount_summary.get('mountedUsed') or 0)
    total_used = int(mount_summary.get('totalUsed') or 0)
    mounted_top_paths = set(top_buckets.keys())
    scanned_root_used = sum(
        int(child.get('size') or 0)
        for child in children
        if str(child.get('path') or '') not in mounted_top_paths
    )
    if root_used > scanned_root_used:
        delta = root_used - scanned_root_used
        children.append(_make_unscanned_usage_node('/', 1, delta, '[unscanned rootfs usage]'))
        debug_state['overlayUnknownBytes'] = int(debug_state.get('overlayUnknownBytes') or 0) + int(delta)

    children.sort(key=lambda child: int(child.get('size') or 0), reverse=True)
    root_node['children'] = children
    if total_used > 0:
        root_node['size'] = total_used

    debug_state['dfRootUsed'] = root_used
    debug_state['dfMountedUsed'] = mounted_used
    debug_state['dfTotalUsed'] = total_used
    debug_state['dfMountsIncluded'] = [
        {
            'path': str(mount.get('path') or ''),
            'size': int(mount.get('used') or 0),
            'humanSize': _format_size_human(int(mount.get('used') or 0)),
            'fsType': str(mount.get('fsType') or ''),
        }
        for mount in sorted(included, key=lambda item: int(item.get('used') or 0), reverse=True)[:24]
    ]
    debug_state['dfMountsExcluded'] = [
        {
            'path': str(mount.get('path') or ''),
            'size': int(mount.get('used') or 0),
            'humanSize': _format_size_human(int(mount.get('used') or 0)),
            'fsType': str(mount.get('fsType') or ''),
        }
        for mount in sorted(excluded, key=lambda item: int(item.get('used') or 0), reverse=True)[:12]
    ]
    debug_state['dfTopMountBuckets'] = [
        {
            'path': path,
            'size': int(bucket.get('size') or 0),
            'humanSize': _format_size_human(int(bucket.get('size') or 0)),
            'mounts': sorted(bucket.get('mounts') or []),
        }
        for path, bucket in sorted(top_buckets.items(), key=lambda item: int((item[1] or {}).get('size') or 0), reverse=True)[:12]
    ]
    return mount_summary


def _parse_memory_info(free_output: Optional[str]) -> Dict[str, str]:
    if not free_output:
        return {}
    lines = [line.strip() for line in free_output.strip().split('\n') if line.strip()]
    if len(lines) < 2:
        return {}

    headers = re.split(r"\s+", lines[0])
    mem_values = re.split(r"\s+", lines[1])
    start_index = 1 if mem_values and mem_values[0].lower().startswith('mem') else 0

    memory_info: Dict[str, str] = {}
    for idx, header in enumerate(headers):
        value_index = idx + start_index
        if value_index >= len(mem_values):
            continue
        try:
            mb_value = int(mem_values[value_index])
        except Exception:
            continue
        if mb_value >= 1024:
            memory_info[header] = f"{round(mb_value / 1024)} GB"
        else:
            memory_info[header] = f"{mb_value:,} MB"

    if len(lines) >= 3:
        swap_values = re.split(r"\s+", lines[2])
        if len(swap_values) > 3:
            try:
                swap_total = int(swap_values[1])
                swap_used = int(swap_values[2])
                swap_free = int(swap_values[3])
            except Exception:
                swap_total = 0
                swap_used = 0
                swap_free = 0
            if swap_total > 0:
                def fmt(v: int) -> str:
                    return f"{v / 1024:.2f} GB" if v >= 1024 else f"{v:,} MB"
                memory_info['Swap total'] = fmt(swap_total)
                memory_info['Swap used'] = fmt(swap_used)
                memory_info['Swap free'] = fmt(swap_free)
            else:
                memory_info['Swap'] = 'Not configured'

    order = [
        'total', 'used', 'free', 'available', 'shared', 'buff/cache',
        'Swap', 'Swap total', 'Swap used', 'Swap free'
    ]
    ordered: Dict[str, str] = {}
    for key in order:
        if key in memory_info:
            ordered[key] = memory_info[key]
    for key, value in memory_info.items():
        if key not in ordered:
            ordered[key] = value
    return ordered


def _parse_system_limits(ulimit_output: Optional[str]) -> Dict[str, str]:
    if not ulimit_output:
        return {}
    lines = [line.strip() for line in ulimit_output.strip().split('\n') if line.strip()]
    temp_limits: Dict[str, str] = {}

    for line in lines:
        match = re.match(r"^([^()]+)\s+\(([^)]+)\)\s+(.+)$", line)
        if not match:
            continue
        name = match.group(1).strip()
        details = match.group(2).strip()
        value = match.group(3).strip()

        if value == 'unlimited':
            temp_limits[name] = 'Unlimited'
            continue
        try:
            num_value = int(value)
            if 'kbytes' in details:
                temp_limits[name] = _format_size_kb(num_value)
            elif 'bytes' in details:
                temp_limits[name] = _format_size_bytes(num_value)
            else:
                temp_limits[name] = f"{num_value:,}"
        except Exception:
            temp_limits[name] = value

    priority = [
        'open files',
        'max user processes',
        'max memory size',
        'stack size',
        'max locked memory',
        'pending signals',
    ]
    ordered: Dict[str, str] = {}
    for key in priority:
        if key in temp_limits:
            ordered[key] = temp_limits.pop(key)
    ordered.update(temp_limits)
    return ordered


def _parse_filesystem_info(df_output: Optional[str]) -> List[Dict[str, str]]:
    if not df_output:
        return []
    lines = [line.rstrip() for line in df_output.strip().split('\n') if line.strip()]
    if len(lines) < 2:
        return []

    entries: List[Dict[str, str]] = []
    i = 1
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        parts = re.split(r"\s+", line)
        has_percentage = any(re.match(r"^\d{1,3}%$", p) for p in parts)

        if not has_percentage and i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if next_line:
                line = parts[0] + ' ' + next_line
                i += 1
        final_parts = re.split(r"\s+", line)
        percent_idx = next((idx for idx, p in enumerate(final_parts) if re.match(r"^\d{1,3}%$", p)), -1)
        if percent_idx >= 4:
            entries.append({
                'Filesystem': ' '.join(final_parts[:percent_idx - 3]),
                'Size': final_parts[percent_idx - 3],
                'Used': final_parts[percent_idx - 2],
                'Available': final_parts[percent_idx - 1],
                'Use%': final_parts[percent_idx],
                'Mounted on': ' '.join(final_parts[percent_idx + 1:]),
            })
        elif len(final_parts) >= 6 and re.match(r"^\d{1,3}%$", final_parts[4]):
            entries.append({
                'Filesystem': final_parts[0],
                'Size': final_parts[1],
                'Used': final_parts[2],
                'Available': final_parts[3],
                'Use%': final_parts[4],
                'Mounted on': ' '.join(final_parts[5:]),
            })
        i += 1

    return entries


def _get_cpu_cores() -> str:
    """Read /proc/cpuinfo to compute cores and threads, matching the parent webapp's format."""
    try:
        cpuinfo = _safe_read_text('/proc/cpuinfo')
        if not cpuinfo:
            return str(os.cpu_count() or '??')
        threads = len(re.findall(r'^processor\s*:', cpuinfo, re.MULTILINE))
        cores_match = re.search(r'^cpu cores\s*:\s*(\d+)', cpuinfo, re.MULTILINE)
        if not threads or not cores_match:
            return str(os.cpu_count() or '??')
        cores_per_socket = int(cores_match.group(1))
        physical_ids = re.findall(r'^physical id\s*:\s*(\d+)', cpuinfo, re.MULTILINE)
        sockets = len(set(physical_ids)) if physical_ids else 1
        total_cores = sockets * cores_per_socket
        if threads > total_cores:
            return f"{total_cores} Cores / {threads} Threads"
        return str(total_cores)
    except Exception:
        return str(os.cpu_count() or '??')


def _get_os_info() -> str:
    os_release = _safe_read_text('/etc/os-release')
    if os_release:
        for line in os_release.split('\n'):
            if line.startswith('PRETTY_NAME='):
                value = line.split('=', 1)[1].strip().strip('"')
                if value:
                    return value
    return platform.platform()


def _parse_supervisord_restart(log_content: Any) -> Optional[str]:
    text = _coerce_log_text(log_content)
    if not text:
        return None
    lines = text.split('\n')
    target_line = None
    for line in reversed(lines):
        if 'success: backend entered RUNNING state' in line:
            target_line = line
            break
    if not target_line:
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2},\d{3})", target_line)
    if not match:
        return None
    timestamp_str = match.group(1).replace(',', '.')
    try:
        dt = datetime.fromisoformat(timestamp_str)
        return dt.strftime('%b %d, %Y, %I:%M %p')
    except Exception:
        return None


def _find_spark_version(settings: Any) -> Optional[str]:
    if isinstance(settings, dict):
        for key, value in settings.items():
            if isinstance(key, str) and key.lower() in ('spark.version', 'sparkversion'):
                return str(value)
            found = _find_spark_version(value)
            if found:
                return found
    elif isinstance(settings, list):
        for item in settings:
            found = _find_spark_version(item)
            if found:
                return found
    return None


def _format_camel_case(value: str) -> str:
    value = value.replace('.', ' ')
    parts = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value).split()
    return ' '.join(part.capitalize() for part in parts)


def _format_date_string(value: str) -> str:
    if not value:
        return value
    if len(value) == 8 and value.isdigit():
        try:
            dt = datetime.strptime(value, '%Y%m%d')
            return dt.strftime('%b %d, %Y')
        except Exception:
            return value
    return value


def _parse_license(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        'license': data or {},
        'licenseInfo': data or {},
        'company': None,
        'licenseProperties': {},
        'hasLicenseUsage': False,
    }
    if not data:
        return result

    content = data.get('content') if isinstance(data.get('content'), dict) else data
    licensee = content.get('licensee') or {}
    if isinstance(licensee, dict):
        result['company'] = licensee.get('company')

    properties = content.get('properties') or {}
    for key, value in properties.items():
        formatted_key = _format_camel_case(str(key))
        if key == 'emittedOn' and isinstance(value, str):
            formatted_value = _format_date_string(value)
        else:
            formatted_value = str(value)
        result['licenseProperties'][formatted_key] = formatted_value

    if content.get('expiresOn'):
        result['licenseProperties']['Expires On'] = _format_date_string(content['expiresOn'])

    usage = content.get('usage') or {}

    def usage_value(current: Any, limit: Any) -> Optional[str]:
        try:
            current_f = float(current)
            limit_f = float(limit)
        except Exception:
            return None
        if limit_f <= 0:
            return None
        return f"{current} / {limit} ({round((current_f / limit_f) * 100)}%)"

    if usage:
        result['hasLicenseUsage'] = True
        if usage.get('namedUsers'):
            current = usage['namedUsers'].get('current')
            limit = usage['namedUsers'].get('limit')
            value = usage_value(current, limit)
            if value:
                result['licenseProperties']['Named Users'] = value
        if usage.get('concurrentUsers'):
            current = usage['concurrentUsers'].get('current')
            limit = usage['concurrentUsers'].get('limit')
            value = usage_value(current, limit)
            if value:
                result['licenseProperties']['Concurrent Users'] = value
        if usage.get('connections'):
            current = usage['connections'].get('current')
            limit = usage['connections'].get('limit')
            value = usage_value(current, limit)
            if value:
                result['licenseProperties']['Connections'] = value
        if usage.get('projects'):
            current = usage['projects'].get('current')
            limit = usage['projects'].get('limit')
            value = usage_value(current, limit)
            if value:
                result['licenseProperties']['Projects'] = value
        if usage.get('features'):
            for feature in usage['features']:
                name = feature.get('name')
                current = feature.get('current')
                limit = feature.get('limit')
                if name:
                    value = usage_value(current, limit)
                    if value:
                        result['licenseProperties'][_format_camel_case(name)] = value

    return result


def _parse_log_errors(content: Any) -> Dict[str, Any]:
    text = _coerce_log_text(content)
    if not text:
        return {
            'formattedLogErrors': 'No log errors found',
            'rawLogErrors': [],
            'logStats': {
                'Total Lines': 0,
                'Unique Errors': 0,
                'Displayed Errors': 0,
            }
        }

    lines = text.split('\n')
    lines_before = 10
    lines_after = 100
    time_threshold = 5
    max_errors = 5
    log_levels = [r"\[ERROR\]", r"\[FATAL\]", r"\[SEVERE\]", r"\bERROR\b", r"\bFATAL\b", r"\bSEVERE\b"]
    log_level_regex = re.compile(r"(" + '|'.join(log_levels) + r")")
    timestamp_regex = re.compile(r"\[(\d{4}/\d{2}/\d{2}-\d{2}:\d{2}:\d{2}\.\d{3})\]")
    leading_timestamp_regex = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:,\d{3})?)")

    def parse_ts(line: str) -> Optional[float]:
        match = timestamp_regex.search(line)
        if match:
            try:
                dt = datetime.strptime(match.group(1), '%Y/%m/%d-%H:%M:%S.%f')
                return dt.timestamp()
            except Exception:
                pass
        alt = leading_timestamp_regex.search(line)
        if alt:
            value = alt.group(1).replace(',', '.')
            try:
                dt = datetime.fromisoformat(value)
                return dt.timestamp()
            except Exception:
                return None
        return None

    line_count = 0
    error_count = 0
    recent_errors = []
    error_signatures = set()
    before_buffer: List[str] = []
    collecting_after = 0
    after_buffer: List[str] = []
    last_error_timestamp: Optional[float] = None
    last_error_had_real_timestamp = False
    error_line = 0
    error_timestamp_str = ''

    for line in lines:
        line_count += 1

        if collecting_after > 0:
            after_buffer.append(line)
            collecting_after -= 1
            if collecting_after == 0:
                header = "\n" + '=' * 40 + f"\nERROR FOUND AT LINE {error_line} (TIMESTAMP: {error_timestamp_str}):\n" + '=' * 40 + "\n\n\n\n"
                current_error = [header] + before_buffer + after_buffer
                recent_errors.append({'timestamp': error_timestamp_str, 'data': current_error})
                if len(recent_errors) > max_errors:
                    recent_errors.pop(0)
                after_buffer = []
                before_buffer = []
                continue

        before_buffer.append(line)
        if len(before_buffer) > lines_before:
            before_buffer.pop(0)

        if not log_level_regex.search(line):
            continue

        current_ts = parse_ts(line)
        had_real_timestamp = current_ts is not None
        if current_ts is None:
            # Keep parsing stacktraces and non-standard logs that do not carry timestamps.
            current_ts = float(line_count)

        timestamp_str = datetime.fromtimestamp(current_ts).strftime('%Y-%m-%d-%H:%M:%S')
        signature = line[-60:].strip() if len(line) > 60 else line.strip()
        if signature in error_signatures:
            error_signatures.remove(signature)

        if last_error_timestamp is not None and had_real_timestamp and last_error_had_real_timestamp:
            if current_ts - last_error_timestamp < time_threshold:
                if collecting_after > 0:
                    collecting_after = max(collecting_after, lines_after)
                    after_buffer.append(line)
                    collecting_after -= 1
                continue

        error_count += 1
        error_line = line_count
        error_timestamp_str = timestamp_str
        last_error_timestamp = current_ts
        last_error_had_real_timestamp = had_real_timestamp
        error_signatures.add(signature)

        collecting_after = lines_after
        after_buffer = [line]
        collecting_after -= 1

    if collecting_after > 0:
        header = "\n" + '=' * 40 + f"\nERROR FOUND AT LINE {error_line} (TIMESTAMP: {error_timestamp_str}):\n" + '=' * 40 + "\n\n\n\n"
        current_error = [header] + before_buffer + after_buffer
        recent_errors.append({'timestamp': error_timestamp_str, 'data': current_error})
        if len(recent_errors) > max_errors:
            recent_errors.pop(0)

    formatted = _format_log_errors(recent_errors)
    return {
        'formattedLogErrors': formatted,
        'rawLogErrors': recent_errors,
        'logStats': {
            'Total Lines': line_count,
            'Unique Errors': error_count,
            'Displayed Errors': len(recent_errors),
        }
    }


def _format_log_errors(errors: List[Dict[str, Any]]) -> str:
    if not errors:
        return 'No log errors found'

    output = ''
    for error in errors:
        output += '<div class="log-error-block">'
        for line in error['data']:
            if 'ERROR FOUND AT LINE' in line:
                header = line.replace('=' * 40, '=' * 20)
                header_parts = header.split('\n')
                formatted_header = ''
                for part in header_parts:
                    formatted_header += '<br>' if part.strip() == '' else part + '<br>'
                formatted_header += '<br>'
                output += f'<div class="log-entry log-header">{formatted_header}</div>'
                continue

            class_name = 'log-entry'
            if '[INFO]' in line or re.search(r"\bINFO\b", line):
                class_name += ' log-info'
            elif '[WARN]' in line or re.search(r"\bWARN\b", line):
                class_name += ' log-warn'
            elif '[ERROR]' in line or re.search(r"\bERROR\b", line):
                class_name += ' log-error'
            elif '[FATAL]' in line or re.search(r"\bFATAL\b", line):
                class_name += ' log-fatal'
            elif '[SEVERE]' in line or re.search(r"\bSEVERE\b", line):
                class_name += ' log-severe'
            elif '[DEBUG]' in line or re.search(r"\bDEBUG\b", line):
                class_name += ' log-debug'
            elif '[TRACE]' in line or re.search(r"\bTRACE\b", line):
                class_name += ' log-trace'

            formatted_line = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            ts_match = re.search(r"\[(\d{4}/\d{2}/\d{2}-\d{2}:\d{2}:\d{2}\.\d{3})\]", formatted_line)
            if ts_match:
                formatted_line = formatted_line.replace(ts_match.group(0), f'<span class="log-timestamp">{ts_match.group(0)}</span>')
            else:
                start_ts_match = re.search(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:,\d{3})?)", formatted_line)
                if start_ts_match:
                    formatted_line = formatted_line.replace(start_ts_match.group(1), f'<span class="log-timestamp">{start_ts_match.group(1)}</span>')

            level_match = re.search(r"\[(INFO|WARN|ERROR|FATAL|SEVERE|DEBUG|TRACE)\]", formatted_line)
            if level_match:
                formatted_line = formatted_line.replace(level_match.group(0), f'<span class="log-level">{level_match.group(0)}</span>')

            formatted_line = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", '<span class="hljs-number">\\g<0></span>', formatted_line)
            formatted_line = re.sub(r"\[ct: \d+\]", '<span class="hljs-number">\\g<0></span>', formatted_line)
            formatted_line = re.sub(
                r"\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9.\/-]+:[a-z0-9.\/-]+",
                '<span class="hljs-string">\\g<0></span>',
                formatted_line,
            )
            formatted_line = re.sub(
                r"\b(pod|deployment|service|node|configmap|secret|namespace|replicaset|daemonset)s?\b",
                '<span class="hljs-title">\\g<0></span>',
                formatted_line,
                flags=re.IGNORECASE,
            )
            formatted_line = re.sub(
                r"Process [a-z]+ done \(return code \d+\)|Running [a-z]+ \([^)]+\)",
                '<span class="hljs-comment">\\g<0></span>',
                formatted_line,
            )

            output += f'<div class="{class_name}">{formatted_line}</div>'
        output += '</div>'
    return output


def _build_dir_tree(
    root_path: str,
    max_depth: int,
    target_path: Optional[str] = None,
    approximate_limit: bool = False,
) -> Dict[str, Any]:
    root_path = os.path.abspath(root_path)
    target = os.path.abspath(target_path) if target_path else root_path
    if not target.startswith(root_path):
        target = root_path
    max_depth = max(1, int(max_depth or 1))

    exclude_virtual_mounts = root_path == '/'
    excluded_prefixes = ('/proc', '/sys', '/dev', '/run') if exclude_virtual_mounts else tuple()
    skip_symlink_entries = exclude_virtual_mounts

    def should_skip_path(path: str) -> bool:
        normalized = os.path.abspath(path)
        for prefix in excluded_prefixes:
            if normalized == prefix or normalized.startswith(prefix + os.sep):
                return True
        return False

    debug_state: Dict[str, Any] = {
        'rootPath': root_path,
        'targetPath': target,
        'maxDepth': max_depth,
        'approximateLimit': bool(approximate_limit),
        'excludedPrefixes': list(excluded_prefixes),
        'nodesVisited': 0,
        'dirsVisited': 0,
        'filesVisited': 0,
        'entriesScanned': 0,
        'symlinksSeen': 0,
        'skippedSymlinks': 0,
        'skippedEntries': 0,
        'statErrors': 0,
        'scanErrors': 0,
        'largeLeafs': [],
        'errors': [],
        'permissionDeniedPaths': [],
        'overlayUnknownBytes': 0,
        'topChildren': [],
        'specialMountTotals': [],
    }

    def record_error(kind: str, path: str, exc: Exception) -> None:
        if isinstance(exc, PermissionError):
            denied = debug_state['permissionDeniedPaths']
            if path not in denied and len(denied) < 16:
                denied.append(path)
        if len(debug_state['errors']) >= 12:
            return
        debug_state['errors'].append({
            'kind': kind,
            'path': path,
            'error': str(exc),
        })

    def record_large_leaf(path: str, size: int, reason: str) -> None:
        if size <= 0:
            return
        # Keep a short list to avoid bloating responses.
        items: List[Dict[str, Any]] = debug_state['largeLeafs']
        items.append({
            'path': path,
            'size': size,
            'humanSize': _format_size_human(size),
            'reason': reason,
        })
        items.sort(key=lambda item: int(item.get('size') or 0), reverse=True)
        del items[12:]

    def depth_for(path: str) -> int:
        if path == root_path:
            return 0
        relative = os.path.relpath(path, root_path)
        if relative in ('.', ''):
            return 0
        return relative.count(os.sep) + 1

    def make_node(
        path: str,
        is_directory: bool,
        size: int,
        own_size: int,
        file_count: int,
        depth: int,
        has_hidden_children: bool,
        children: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        return {
            'name': os.path.basename(path) or path,
            'path': path,
            'size': int(max(0, size)),
            'ownSize': int(max(0, own_size)),
            'isDirectory': bool(is_directory),
            'children': children or [],
            'fileCount': int(max(0, file_count)),
            'depth': int(max(0, depth)),
            'hasHiddenChildren': bool(has_hidden_children),
        }

    def summarize_directory(path: str, own_size: int) -> Dict[str, Any]:
        total_size = int(max(0, own_size))
        total_files = 0
        has_children = False

        if approximate_limit:
            def on_walk_error(exc: OSError) -> None:
                debug_state['scanErrors'] += 1
                record_error('walk', getattr(exc, 'filename', path) or path, exc)

            for walk_root, dirs, files in os.walk(path, topdown=True, followlinks=False, onerror=on_walk_error):
                filtered_dirs: List[str] = []
                for dir_name in list(dirs):
                    dir_path = os.path.join(walk_root, dir_name)
                    debug_state['entriesScanned'] += 1
                    if should_skip_path(dir_path):
                        debug_state['skippedEntries'] += 1
                        continue
                    if os.path.islink(dir_path):
                        debug_state['symlinksSeen'] += 1
                        if skip_symlink_entries:
                            debug_state['skippedSymlinks'] += 1
                            continue
                    filtered_dirs.append(dir_name)
                    has_children = True
                dirs[:] = filtered_dirs

                for file_name in files:
                    file_path = os.path.join(walk_root, file_name)
                    debug_state['entriesScanned'] += 1
                    if should_skip_path(file_path):
                        debug_state['skippedEntries'] += 1
                        continue
                    if os.path.islink(file_path):
                        debug_state['symlinksSeen'] += 1
                        if skip_symlink_entries:
                            debug_state['skippedSymlinks'] += 1
                            continue
                    has_children = True
                    try:
                        file_stat = os.lstat(file_path)
                        file_size = int(max(0, file_stat.st_size))
                        total_size += file_size
                        total_files += 1
                        debug_state['filesVisited'] += 1
                        if file_size >= 100 * 1024 ** 3:
                            record_large_leaf(file_path, file_size, 'walk-depth-limit')
                    except Exception as exc:
                        debug_state['statErrors'] += 1
                        record_error('stat', file_path, exc)
        else:
            try:
                with os.scandir(path) as it:
                    for entry in it:
                        debug_state['entriesScanned'] += 1
                        entry_path = entry.path
                        if should_skip_path(entry_path):
                            debug_state['skippedEntries'] += 1
                            continue
                        if entry.is_symlink():
                            debug_state['symlinksSeen'] += 1
                            if skip_symlink_entries:
                                debug_state['skippedSymlinks'] += 1
                                continue
                        has_children = True
                        if entry.is_file(follow_symlinks=False):
                            try:
                                entry_stat = entry.stat(follow_symlinks=False)
                                file_size = int(max(0, entry_stat.st_size))
                                total_size += file_size
                                total_files += 1
                                debug_state['filesVisited'] += 1
                            except Exception as exc:
                                debug_state['statErrors'] += 1
                                record_error('stat', entry_path, exc)
            except Exception as exc:
                debug_state['scanErrors'] += 1
                record_error('scandir', path, exc)
        return {
            'totalSize': int(max(0, total_size)),
            'totalFiles': int(max(0, total_files)),
            'hasChildren': bool(has_children),
        }

    def scan_node(path: str) -> Dict[str, Any]:
        debug_state['nodesVisited'] += 1
        node_depth = depth_for(path)

        if path != root_path and should_skip_path(path):
            debug_state['skippedEntries'] += 1
            return make_node(path, True, 0, 0, 0, node_depth, False)

        try:
            node_stat = os.lstat(path)
        except Exception as exc:
            debug_state['statErrors'] += 1
            record_error('stat', path, exc)
            return make_node(path, False, 0, 0, 0, node_depth, False)

        if os.path.islink(path):
            debug_state['symlinksSeen'] += 1
            if skip_symlink_entries and path != root_path:
                debug_state['skippedSymlinks'] += 1
                return make_node(path, False, 0, 0, 0, node_depth, False)

        is_directory = os.path.isdir(path)
        own_size = int(max(0, node_stat.st_size))
        if not is_directory:
            debug_state['filesVisited'] += 1
            if own_size >= 100 * 1024 ** 3:
                record_large_leaf(path, own_size, 'leaf-size')
            return make_node(path, False, own_size, own_size, 1, node_depth, False)

        debug_state['dirsVisited'] += 1

        if node_depth >= max_depth:
            summary = summarize_directory(path, own_size)
            return make_node(
                path,
                True,
                int(summary['totalSize']),
                own_size,
                int(summary['totalFiles']),
                node_depth,
                bool(summary['hasChildren']),
            )

        children: List[Dict[str, Any]] = []
        total_size = own_size
        total_files = 0
        has_hidden_children = False
        try:
            with os.scandir(path) as it:
                for entry in it:
                    debug_state['entriesScanned'] += 1
                    entry_path = entry.path
                    if should_skip_path(entry_path):
                        debug_state['skippedEntries'] += 1
                        continue
                    if entry.is_symlink():
                        debug_state['symlinksSeen'] += 1
                        if skip_symlink_entries:
                            debug_state['skippedSymlinks'] += 1
                            continue
                    child = scan_node(entry_path)
                    children.append(child)
                    total_size += int(child.get('size') or 0)
                    total_files += int(child.get('fileCount') or 0)
                    if child.get('hasHiddenChildren'):
                        has_hidden_children = True
        except Exception as exc:
            debug_state['scanErrors'] += 1
            record_error('scandir', path, exc)
            has_hidden_children = True

        children.sort(key=lambda child: int(child.get('size') or 0), reverse=True)
        return make_node(
            path,
            True,
            int(max(0, total_size)),
            own_size,
            int(max(0, total_files)),
            node_depth,
            has_hidden_children,
            children,
        )

    root_node = scan_node(target)
    mount_summary: Optional[Dict[str, Any]] = None
    if root_path == '/' and isinstance(root_node, dict):
        if target == root_path:
            mount_summary = _apply_df_overlay_to_root_tree(root_node, debug_state)
        else:
            mount_summary = _summarize_df_mounts()
            _overlay_mount_usage_on_node(root_node, target, depth_for(target), mount_summary, debug_state)
            if mount_summary:
                debug_state['dfRootUsed'] = int(mount_summary.get('rootUsed') or 0)
                debug_state['dfMountedUsed'] = int(mount_summary.get('mountedUsed') or 0)
                debug_state['dfTotalUsed'] = int(mount_summary.get('totalUsed') or 0)

    if isinstance(root_node, dict):
        debug_state['totalSize'] = int(root_node.get('size', 0) or 0)
        debug_state['totalFiles'] = int(root_node.get('fileCount', 0) or 0)
        top_children = (root_node.get('children') or [])[:8]
        debug_state['topChildren'] = [
            {
                'path': str(child.get('path') or ''),
                'size': int(child.get('size') or 0),
                'humanSize': _format_size_human(int(child.get('size') or 0)),
                'fileCount': int(child.get('fileCount') or 0),
            }
            for child in top_children
        ]

        if root_path == '/':
            special_totals: Dict[str, int] = {}
            for child in (root_node.get('children') or []):
                child_path = str(child.get('path') or '')
                child_size = int(child.get('size') or 0)
                for prefix in ('/proc', '/sys', '/dev', '/run'):
                    if child_path == prefix or child_path.startswith(prefix + '/'):
                        special_totals[prefix] = special_totals.get(prefix, 0) + child_size
                        break
            debug_state['specialMountTotals'] = [
                {
                    'path': key,
                    'size': value,
                    'humanSize': _format_size_human(value),
                }
                for key, value in sorted(special_totals.items(), key=lambda item: item[1], reverse=True)
            ]

    app.logger.info(
        "[dir-tree] root=%s target=%s total=%s files=%s nodes=%s dirs=%s filesVisited=%s scanned=%s symlinks=%s skippedSymlinks=%s skippedEntries=%s statErrors=%s scanErrors=%s",
        root_path,
        target,
        _format_size_human(int(debug_state.get('totalSize') or 0)),
        int(debug_state.get('totalFiles') or 0),
        int(debug_state.get('nodesVisited') or 0),
        int(debug_state.get('dirsVisited') or 0),
        int(debug_state.get('filesVisited') or 0),
        int(debug_state.get('entriesScanned') or 0),
        int(debug_state.get('symlinksSeen') or 0),
        int(debug_state.get('skippedSymlinks') or 0),
        int(debug_state.get('skippedEntries') or 0),
        int(debug_state.get('statErrors') or 0),
        int(debug_state.get('scanErrors') or 0),
    )
    if int(debug_state.get('dfTotalUsed') or 0) > 0:
        app.logger.info(
            "[dir-tree] df-overlay total=%s rootfs=%s mounted=%s included=%s excluded=%s",
            _format_size_human(int(debug_state.get('dfTotalUsed') or 0)),
            _format_size_human(int(debug_state.get('dfRootUsed') or 0)),
            _format_size_human(int(debug_state.get('dfMountedUsed') or 0)),
            len((mount_summary or {}).get('included') or debug_state.get('dfMountsIncluded') or []),
            len((mount_summary or {}).get('excluded') or debug_state.get('dfMountsExcluded') or []),
        )
    if int(debug_state.get('overlayUnknownBytes') or 0) > 0:
        app.logger.warning(
            "[dir-tree] unscanned usage overlaid: %s",
            _format_size_human(int(debug_state.get('overlayUnknownBytes') or 0)),
        )
    if debug_state.get('specialMountTotals'):
        app.logger.warning("[dir-tree] special mounts included in totals: %s", debug_state.get('specialMountTotals'))
    if debug_state.get('largeLeafs'):
        app.logger.warning("[dir-tree] large leaf entries detected: %s", debug_state.get('largeLeafs'))

    if target != root_path:
        return {'node': root_node, 'debug': debug_state}

    return {
        'root': root_node,
        'totalSize': root_node['size'],
        'totalFiles': root_node['fileCount'],
        'rootPath': root_node['path'],
        'debug': debug_state,
    }


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _parallel_workers(default: int = 8) -> int:
    raw = os.environ.get('DIAG_PARSER_MAX_WORKERS')
    if raw:
        try:
            return max(1, min(32, int(raw)))
        except Exception:
            pass
    return max(1, min(32, default))


def _record_benchmark_operation(name: str, elapsed_ms: float, calls: int = 1) -> None:
    recorder = getattr(_THREAD_LOCAL, 'bench_record_op', None)
    if not callable(recorder):
        return
    try:
        recorder(name, elapsed_ms, calls)
    except Exception:
        pass


def _bench_call(name: str, fn, *args, **kwargs):
    started = time.time()
    try:
        return fn(*args, **kwargs)
    finally:
        _record_benchmark_operation(name, (time.time() - started) * 1000.0, 1)


def _notify_progress(
    callback: Optional[Callable[..., None]],
    step: str,
    message: str,
    level: str = 'info',
    project_key: Optional[str] = None,
    elapsed_ms: Optional[float] = None,
) -> None:
    if not callable(callback):
        return
    try:
        callback(
            step=step,
            message=message,
            level=level,
            project_key=project_key,
            elapsed_ms=elapsed_ms,
        )
    except Exception:
        pass


def _thread_client() -> Any:
    client = getattr(_THREAD_LOCAL, 'dss_client', None)
    if client is None:
        client = dataiku.api_client()
        setattr(_THREAD_LOCAL, 'dss_client', client)
    return client


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    return str(value)


def _client_perform_json(client: Any, method: str, path: str) -> Optional[Any]:
    if not hasattr(client, '_perform_json'):
        return None

    # Different DSS client variants expose different signatures.
    for attempt in (
        lambda: client._perform_json(method, path),
        lambda: client._perform_json(path),
    ):
        try:
            response = attempt()
            if isinstance(response, (dict, list)):
                return response
        except Exception:
            continue
    return None


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'y', 'on')


def _unwrap_footprint_payload(value: Any) -> Any:
    current = value
    seen = 0
    while isinstance(current, dict) and seen < 8:
        seen += 1
        nested = current.get('result')
        if not isinstance(nested, dict):
            break
        current = nested
    return current


def _wrap_project_footprint_payload(payload: Any, project_key: Optional[str]) -> Any:
    if not isinstance(payload, dict):
        return payload
    projects = payload.get('projects')
    if not isinstance(projects, dict):
        return payload
    items = projects.get('items')
    if not isinstance(items, list):
        return payload
    if project_key:
        for item in items:
            if isinstance(item, dict) and item.get('projectKey') == project_key:
                return item
    if items:
        first = items[0]
        if isinstance(first, dict):
            return first
    return payload


def _compute_footprint_payload(
    client: Any,
    scope: str,
    project_key: Optional[str],
) -> Optional[Any]:
    op_name = 'compute_all_dss_footprint'
    if scope == 'global':
        op_name = 'compute_global_footprint'
    elif scope == 'project' and project_key:
        op_name = 'compute_project_footprint'

    if hasattr(client, 'get_data_directories_footprint'):
        try:
            footprint_api = _bench_call('get_data_directories_footprint', client.get_data_directories_footprint)
            if scope == 'global':
                return _bench_call(op_name, lambda: _unwrap_footprint_payload(footprint_api.compute_global_only_footprint(wait=True)))
            if scope == 'project' and project_key:
                return _bench_call(op_name, lambda: _unwrap_footprint_payload(footprint_api.compute_project_footprint(project_key, wait=True)))
            return _bench_call(op_name, lambda: _unwrap_footprint_payload(footprint_api.compute_all_dss_footprint(wait=True)))
        except Exception:
            pass

    rest_path = '/directories-footprint/all-dss?summaryOnly=false'
    if scope == 'global':
        rest_path = '/directories-footprint/global?summaryOnly=false'
    elif scope == 'project' and project_key:
        rest_path = f'/directories-footprint/projects/{project_key}?summaryOnly=false'

    response = _bench_call(op_name, _client_perform_json, client, 'GET', rest_path)
    if not isinstance(response, dict):
        return None

    unwrapped = _unwrap_footprint_payload(response)
    if scope == 'project':
        return _wrap_project_footprint_payload(unwrapped, project_key)
    return unwrapped


def _footprint_item_name(item: Any, idx: int) -> str:
    if isinstance(item, dict):
        if item.get('projectKey'):
            return str(item.get('projectKey'))
        if item.get('path'):
            return str(item.get('path'))
        if item.get('name') and item.get('language'):
            return f"{item.get('name')} ({item.get('language')})"
        if item.get('name') and item.get('type'):
            return f"{item.get('name')} ({item.get('type')})"
        if item.get('name'):
            return str(item.get('name'))
    else:
        for attr in ('projectKey', 'path', 'name'):
            if hasattr(item, attr):
                value = getattr(item, attr)
                if value:
                    return str(value)
    return f'entry-{idx}'


def _scope_root(scope: str, project_key: Optional[str]) -> Dict[str, str]:
    if scope == 'all':
        return {'name': '/', 'path': '/'}
    if scope == 'global':
        return {'name': 'global', 'path': '/dss-data/global'}
    if scope == 'project' and project_key:
        return {'name': project_key, 'path': f'/dss-data/projects/{project_key}'}
    return {'name': 'dss_data', 'path': '/dss-data'}


def _read_license_via_client_api(client: Any) -> Optional[Dict[str, Any]]:
    candidate_methods = [
        'get_license',
        'get_license_info',
        'get_licensing',
        'get_licensing_info',
    ]
    for method_name in candidate_methods:
        if not hasattr(client, method_name):
            continue
        try:
            raw = getattr(client, method_name)()
            if hasattr(raw, 'get_raw'):
                raw = raw.get_raw()
            if isinstance(raw, dict):
                return raw
        except Exception:
            continue

    for path in ('/admin/license', '/admin/license-info', '/public/api/admin/license'):
        response = _client_perform_json(client, 'GET', path)
        if isinstance(response, dict):
            return response

    return None


def _footprint_attr(footprint: Any, *keys: str) -> Any:
    if isinstance(footprint, dict):
        for key in keys:
            if key in footprint:
                return footprint.get(key)
        return None
    for key in keys:
        if hasattr(footprint, key):
            return getattr(footprint, key)
    return None


def _footprint_details_map(footprint: Any) -> Dict[str, Any]:
    raw_details = None
    try:
        raw_details = _footprint_attr(footprint, 'details', 'children')
    except Exception:
        raw_details = None

    if isinstance(raw_details, dict):
        return raw_details
    if isinstance(raw_details, list):
        out: Dict[str, Any] = {}
        for idx, item in enumerate(raw_details):
            name = _footprint_item_name(item, idx)
            out[name] = item
        return out

    if isinstance(footprint, dict):
        items = footprint.get('items')
        if isinstance(items, list):
            out = {}
            for idx, item in enumerate(items):
                out[_footprint_item_name(item, idx)] = item
            return out
        out = {}
        for key, value in footprint.items():
            if isinstance(value, dict):
                out[str(key)] = value
        return out

    return {}


def _footprint_size(footprint: Any) -> int:
    size = _coerce_int(_footprint_attr(footprint, 'size', 'totalSize', 'bytes'), 0)
    if size > 0:
        return size
    details = _footprint_details_map(footprint)
    if not details:
        return 0
    return sum(_footprint_size(child) for child in details.values())


def _normalize_bucket_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', str(name or '').lower())


def _collect_bucket_size_by_name(footprint: Any, matcher) -> int:
    details = _footprint_details_map(footprint)
    if not details:
        return 0
    total = 0
    for name, child in details.items():
        normalized = _normalize_bucket_name(name)
        if matcher(normalized):
            total += _footprint_size(child)
            continue
        total += _collect_bucket_size_by_name(child, matcher)
    return total


def _collect_bucket_file_count_by_name(footprint: Any, matcher) -> int:
    details = _footprint_details_map(footprint)
    if not details:
        return 0
    total = 0
    for name, child in details.items():
        normalized = _normalize_bucket_name(name)
        if matcher(normalized):
            total += _coerce_int(_footprint_attr(child, 'nbFiles', 'nb_files', 'fileCount'), 0)
            continue
        total += _collect_bucket_file_count_by_name(child, matcher)
    return total


def _project_size_index(total_gb: float, avg_gb: float) -> float:
    safe_total = max(0.0, total_gb)
    if safe_total >= 40.0:
        return 1.0
    abs_norm = math.log1p(min(safe_total, 40.0)) / math.log1p(40.0)
    ratio = safe_total / max(avg_gb, 0.1)
    rel_norm = math.log1p(min(max(ratio, 0.0), 4.0)) / math.log1p(4.0)
    return max(0.0, min(1.0, (0.6 * abs_norm) + (0.4 * rel_norm)))


def _project_size_health(total_gb: float, size_index: float) -> str:
    if total_gb >= 40.0:
        return 'angry-red'
    if size_index >= 0.85:
        return 'angry-red'
    if size_index >= 0.60:
        return 'red'
    if size_index >= 0.35:
        return 'orange'
    return 'green'


def _code_env_health(code_env_count: int) -> str:
    if code_env_count >= 5:
        return 'angry-red'
    if code_env_count == 4:
        return 'red'
    if code_env_count == 3:
        return 'orange'
    if code_env_count == 2:
        return 'yellow'
    return 'green'


def _code_env_risk(code_env_count: int) -> float:
    if code_env_count <= 1:
        return 0.0
    if code_env_count == 2:
        return 0.45
    if code_env_count == 3:
        return 0.75
    return 1.0


def _usage_to_dict(usage: Any) -> Dict[str, Any]:
    if isinstance(usage, dict):
        return usage
    if hasattr(usage, 'to_dict'):
        try:
            raw = usage.to_dict()
            if isinstance(raw, dict):
                return raw
        except Exception:
            pass
    if hasattr(usage, 'get_raw'):
        try:
            raw = usage.get_raw()
            if isinstance(raw, dict):
                return raw
        except Exception:
            pass
    out: Dict[str, Any] = {}
    for attr in (
        'projectKey',
        'project',
        'projectId',
        'projectSummary',
        'usageType',
        'type',
        'objectType',
        'objectId',
        'objectSmartId',
        'envName',
        'envLang',
    ):
        if hasattr(usage, attr):
            out[attr] = getattr(usage, attr)
    return out


def _extract_usage_project_key(usage: Dict[str, Any]) -> Optional[str]:
    for key in ('projectKey', 'projectId', 'project_key'):
        value = usage.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    nested_project = usage.get('project')
    if isinstance(nested_project, dict):
        for key in ('projectKey', 'key', 'id'):
            value = nested_project.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    elif isinstance(nested_project, str) and nested_project.strip():
        return nested_project.strip()

    summary = usage.get('projectSummary')
    if isinstance(summary, dict):
        for key in ('projectKey', 'key', 'id'):
            value = summary.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_usage_type(usage: Dict[str, Any]) -> str:
    for key in ('usageType', 'envUsage', 'type', 'objectType'):
        value = usage.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().upper()
    return 'UNKNOWN'


def _normalize_language(lang_raw: Any) -> str:
    if isinstance(lang_raw, str) and lang_raw.strip().lower().startswith('r'):
        return 'r'
    return 'python'


def _safe_get_raw(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    if hasattr(obj, 'get_raw'):
        try:
            raw = obj.get_raw()
            if isinstance(raw, dict):
                return raw
        except Exception:
            pass
    return {}


_SENTINEL = object()


def _resolve_nested_path(payload: dict, path: str) -> Any:
    current: Any = payload
    for part in path.split('.'):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return _SENTINEL
    return current


def _extract_nested_text(payload: Any, *paths: str) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for path in paths:
        value = _resolve_nested_path(payload, path)
        if value is _SENTINEL:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_nested_int(payload: Any, *paths: str) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    for path in paths:
        value = _resolve_nested_path(payload, path)
        if value is _SENTINEL:
            continue
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            if text.isdigit():
                return int(text)
    return None


def _normalize_project_permissions(perms_raw: Any) -> List[Dict[str, Any]]:
    raw = perms_raw
    if hasattr(raw, 'get_raw'):
        try:
            raw = raw.get_raw()
        except Exception:
            pass

    entries: List[Any] = []
    if isinstance(raw, list):
        entries = raw
    elif isinstance(raw, dict):
        nested = raw.get('permissions')
        if isinstance(nested, list):
            entries = nested
        elif raw.get('group') or raw.get('user'):
            entries = [raw]

    normalized: List[Dict[str, Any]] = []
    for perm in entries:
        if not isinstance(perm, dict):
            continue
        name = perm.get('group') or perm.get('user') or 'Unknown'
        entry = {
            'type': 'Group' if perm.get('group') else 'User',
            'name': name,
            'permissions': {},
        }
        for perm_key, perm_val in perm.items():
            if perm_key in ('group', 'user'):
                continue
            entry['permissions'][perm_key] = perm_val
        normalized.append(entry)
    return normalized


def _extract_project_version_number(listing: Dict[str, Any], summary: Dict[str, Any], settings: Dict[str, Any]) -> int:
    candidates = (
        _extract_nested_int(summary, 'versionTag.versionNumber'),
        _extract_nested_int(listing, 'versionTag.versionNumber'),
        _extract_nested_int(settings, 'versionTag.versionNumber'),
        _extract_nested_int(settings, 'settings.versionTag.versionNumber'),
        _extract_nested_int(settings, 'settings.dkuProperties.versionNumber'),
        _extract_nested_int(settings, 'dkuProperties.versionNumber'),
    )
    for value in candidates:
        if value is not None:
            return value
    return 0


def _extract_code_env_owner(env_listing: Dict[str, Any], settings_raw: Optional[Dict[str, Any]]) -> str:
    owner = _extract_nested_text(
        settings_raw or {},
        'owner',
        'desc.owner',
        'spec.owner',
        'meta.owner',
    )
    if owner:
        return owner

    for key in ('owner', 'createdBy', 'creator'):
        value = env_listing.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return 'Unknown'


def _extract_usage_object_type(usage: Dict[str, Any]) -> str:
    value = _extract_nested_text(
        usage,
        'objectType',
        'targetType',
        'projectObjectType',
        'object.type',
    )
    if value:
        return value.upper()
    return _extract_usage_type(usage)


def _extract_usage_object_id(usage: Dict[str, Any]) -> str:
    value = _extract_nested_text(
        usage,
        'objectId',
        'targetId',
        'id',
        'object.id',
        'objectSmartId',
    )
    if value:
        return value
    return ''


def _extract_usage_object_name(usage: Dict[str, Any]) -> str:
    value = _extract_nested_text(
        usage,
        'objectName',
        'targetName',
        'name',
        'displayName',
        'object.name',
        'object.displayName',
    )
    if value:
        return value
    fallback = _extract_usage_object_id(usage)
    if fallback:
        return fallback
    return _extract_usage_object_type(usage)


def _normalize_usage_entry(
    usage: Dict[str, Any],
    project_names: Dict[str, Dict[str, str]],
) -> Dict[str, Any]:
    project_key = _extract_usage_project_key(usage) or ''
    project_meta = project_names.get(project_key) or {}
    project_name = (
        _extract_nested_text(usage, 'projectSummary.name', 'project.name', 'projectName')
        or project_meta.get('name')
        or project_key
    )

    object_type = _extract_usage_object_type(usage)
    object_id = _extract_usage_object_id(usage)
    object_name = _extract_usage_object_name(usage)

    return {
        'projectKey': project_key,
        'projectName': project_name,
        'usageType': _extract_usage_type(usage),
        'objectType': object_type,
        'objectId': object_id,
        'objectName': object_name,
    }


def _usage_signature(usage: Dict[str, Any]) -> str:
    return '|'.join(
        [
            str(usage.get('projectKey') or ''),
            str(usage.get('usageType') or ''),
            str(usage.get('objectType') or ''),
            str(usage.get('objectId') or ''),
            str(usage.get('objectName') or ''),
            str(usage.get('codeEnvKey') or ''),
        ]
    )


def _dedupe_usage_entries(usages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for usage in usages:
        sig = _usage_signature(usage)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(usage)
    return out


def _usage_to_email_line(usage: Dict[str, Any]) -> str:
    object_type = usage.get('objectType') or usage.get('usageType') or 'OBJECT'
    object_name = usage.get('objectName') or usage.get('objectId') or 'unknown'
    project_key = usage.get('projectKey') or '?'
    code_env_name = usage.get('codeEnvName') or '?'
    return f"- [{object_type}] {object_name} (project={project_key}, code env={code_env_name})"


def _email_object_type_label(object_type: Any, usage_type: Any) -> str:
    raw = str(object_type or usage_type or 'OBJECT').strip().upper()
    if raw.startswith('RECIPE'):
        return 'Recipe'
    if raw.startswith('NOTEBOOK'):
        return 'Notebook'
    if raw.startswith('WEBAPP'):
        return 'Webapp Backend'
    if raw.startswith('SCENARIO_STEP'):
        return 'Scenario Step'
    if raw.startswith('SCENARIO'):
        return 'Scenario'
    if raw.startswith('CODE_STUDIO'):
        return 'Code Studio'
    if raw.startswith('PROJECT'):
        return 'Project'
    return raw.replace('_', ' ').title()


def _usage_lines_grouped_by_code_env(usages: List[Dict[str, Any]]) -> List[str]:
    grouped: Dict[str, List[str]] = {}
    seen = set()

    for usage in usages:
        if not isinstance(usage, dict):
            continue
        usage_type = str(usage.get('usageType') or '').strip().upper()
        if usage_type == 'PROJECT':
            # Project-level defaults are too generic for outreach emails.
            continue

        code_env = str(usage.get('codeEnvName') or usage.get('codeEnvKey') or 'Unknown').strip() or 'Unknown'
        project_key = str(usage.get('projectKey') or '?').strip() or '?'
        object_label = _email_object_type_label(usage.get('objectType'), usage_type)
        object_name = str(usage.get('objectName') or usage.get('objectId') or 'unknown').strip() or 'unknown'

        signature = (
            code_env.lower(),
            project_key,
            object_label.lower(),
            object_name,
        )
        if signature in seen:
            continue
        seen.add(signature)

        grouped.setdefault(code_env, []).append(
            f"- {object_label}: {object_name} (project={project_key})"
        )

    if not grouped:
        return ['- No concrete object usage details found']

    out: List[str] = []
    env_names = sorted(grouped.keys(), key=lambda name: name.lower())
    for idx, env_name in enumerate(env_names):
        out.append(f"Code Environment: {env_name}")
        env_lines = sorted(grouped[env_name], key=lambda line: line.lower())
        out.extend([f"  {line}" for line in env_lines])
        if idx < len(env_names) - 1:
            out.append('')
    return out


def _usage_lines_grouped_by_project(usages: List[Dict[str, Any]]) -> List[str]:
    grouped: Dict[str, Dict[str, List[str]]] = {}
    seen = set()

    for usage in usages:
        if not isinstance(usage, dict):
            continue
        usage_type = str(usage.get('usageType') or '').strip().upper()
        if usage_type == 'PROJECT':
            continue

        code_env = str(usage.get('codeEnvName') or usage.get('codeEnvKey') or 'Unknown').strip() or 'Unknown'
        project_key = str(usage.get('projectKey') or '?').strip() or '?'
        object_label = _email_object_type_label(usage.get('objectType'), usage_type)
        object_name = str(usage.get('objectName') or usage.get('objectId') or 'unknown').strip() or 'unknown'

        signature = (project_key, code_env.lower(), object_label.lower(), object_name)
        if signature in seen:
            continue
        seen.add(signature)

        grouped.setdefault(project_key, {}).setdefault(code_env, []).append(
            f"    - {object_label}: {object_name}"
        )

    if not grouped:
        return ['- No concrete object usage details found']

    out: List[str] = []
    project_keys = sorted(grouped.keys(), key=lambda k: k.lower())
    for idx, pkey in enumerate(project_keys):
        out.append(f"Project: {pkey}")
        envs = sorted(grouped[pkey].keys(), key=lambda e: e.lower())
        for env_name in envs:
            out.append(f"  - Code Env: {env_name}")
            obj_lines = sorted(grouped[pkey][env_name], key=lambda l: l.lower())
            out.extend(obj_lines)
        if idx < len(project_keys) - 1:
            out.append('')
    return out


def _wrap_html_email(body_html: str) -> str:
    year = __import__('datetime').datetime.now().year
    return (
        '<!-- html:true -->\n'
        '<html lang="en">\n'
        '<head>\n'
        '    <meta charset="utf-8">\n'
        '    <meta name="viewport" content="width=device-width">\n'
        '    <meta http-equiv="X-UA-Compatible" content="IE=edge">\n'
        '    <title>DSS Health</title>\n'
        '    <style>\n'
        "        @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap');\n"
        '    </style>\n'
        '    <style type="text/css">\n'
        '        body, #bodyTable {\n'
        '            height: 100% !important; width: 100% !important;\n'
        '            margin: 0; padding: 0;\n'
        '            font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;\n'
        '            background-color: #f4f5f7;\n'
        '        }\n'
        '        body, table, td, p, a, li, blockquote {\n'
        '            -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;\n'
        '        }\n'
        '        table { border-spacing: 0; }\n'
        '        table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }\n'
        '        img { -ms-interpolation-mode: bicubic; }\n'
        '        img, a img { border: 0; outline: none; text-decoration: none; }\n'
        '        .yshortcuts a { border-bottom: none !important; }\n'
        '        @media only screen and (min-width: 900px) {\n'
        '            .email-container { width: 880px !important; }\n'
        '        }\n'
        '        a { color: #00897b; }\n'
        '        .logo-header { text-align: left; margin-bottom: 16px; }\n'
        '        .logo { max-width: 120px; margin-bottom: 4px; }\n'
        '        .banner { width: 100%; max-width: 580px; margin: 4px auto 8px auto; display: block; }\n'
        '        .container {\n'
        '            background-color: #ffffff;\n'
        '            padding: 28px 36px 32px 36px;\n'
        '            border: 1px solid #e5eaf0;\n'
        '            border-radius: 12px;\n'
        '        }\n'
        '        .content {\n'
        '            color: #3a3f47;\n'
        '            font-size: 15px;\n'
        '            line-height: 1.6;\n'
        '        }\n'
        '        .content p { margin: 10px 0; color: #3a3f47; }\n'
        '        .content h3 { color: #1a1a2e; font-size: 16px; font-weight: 600; margin: 20px 0 8px 0; }\n'
        '        .content ul { padding-left: 20px; margin: 6px 0; line-height: 1.7; }\n'
        '        .content li { margin: 4px 0; color: #4a5568; }\n'
        '        .button {\n'
        '            display: inline-block; margin-top: 4px; margin-bottom: 12px;\n'
        '            padding: 12px 20px; text-decoration: none;\n'
        '            border-radius: 32px; font-weight: 500;\n'
        '        }\n'
        '        .btn-primary { background-color: #00897b; color: #ffffff; }\n'
        '        .btn-secondary { background-color: #ffffff; color: #00897b; border: 1px solid #00897b; }\n'
        '        .footer { text-align: center; color: #8895a7; font-size: 12px; padding: 32px 0; }\n'
        '    </style>\n'
        '</head>\n'
        '<table id="bodyTable" border="0" cellpadding="0" cellspacing="0" width="100%">\n'
        '    <tr>\n'
        '        <td align="center" valign="top">\n'
        '            <table align="center" border="0" cellpadding="0" cellspacing="0" class="email-container"\n'
        '                   style="max-width: 720px;">\n'
        '                <tr>\n'
        '                    <td height="20" style="font-size: 0; line-height: 0;">&nbsp;</td>\n'
        '                </tr>\n'
        '                <tr>\n'
        '                    <td>\n'
        '                        <div class="logo-header">\n'
        '                            <a href="https://www.dataiku.com">\n'
        '                                <img src="https://dku-assets.s3.amazonaws.com/img/emailing/DataikuLogoTeal_2025.png" alt="Dataiku Logo" class="logo">\n'
        '                            </a>\n'
        '                        </div>\n'
        '                    </td>\n'
        '                </tr>\n'
        '                <tr>\n'
        '                    <td>\n'
        '                        <div class="container">\n'
        '                            <div class="content">\n'
        '                                <img src="https://dku-assets.s3.amazonaws.com/img/emailing/EmailBanner.png" class="banner" alt="Banner">\n'
        + body_html +
        '\n                            </div>\n'
        '                        </div>\n'
        '                    </td>\n'
        '                </tr>\n'
        '                <tr>\n'
        '                    <td class="footer">\n'
        f'                        &copy; {year} Dataiku | All rights reserved.<br>\n'
        '                        <br>\n'
        '                        <a href="mailto:{{admin_email}}" class="button btn-primary" style="color:#ffffff;font-size:13px;padding:8px 18px;background-color:#00897b;text-decoration:none;border-radius:32px;display:inline-block;">Contact your DSS Admin</a>\n'
        '                        &nbsp;\n'
        '                        <a href="{{chat_channel_url}}" class="button btn-secondary" style="color:#00897b;font-size:13px;padding:8px 18px;background-color:#ffffff;text-decoration:none;border:1px solid #00897b;border-radius:32px;display:inline-block;">Join the DSS Channel</a>\n'
        '                    </td>\n'
        '                </tr>\n'
        '            </table>\n'
        '        </td>\n'
        '    </tr>\n'
        '</table>\n'
        '</html>\n'
    )


def _text_body_to_html(rendered_text: str) -> str:
    import html as _html
    lines = rendered_text.split('\n')
    fragments: List[str] = []
    in_list = False
    in_sub_list = False

    _p_style = 'style="margin:10px 0;color:#3a3f47;font-size:15px;line-height:1.6;"'
    _h3_style = 'style="color:#1a1a2e;font-size:15px;font-weight:600;margin:20px 0 6px 0;padding:0;"'
    _ul_style = 'style="padding-left:20px;margin:6px 0;"'
    _li_style = 'style="margin:4px 0;color:#3a3f47;font-size:14px;line-height:1.5;"'
    _li_sub_style = 'style="margin:3px 0;color:#4a5568;font-size:13px;line-height:1.5;"'

    def _close_sub_list():
        nonlocal in_sub_list
        if in_sub_list:
            fragments.append('</ul></li>')
            in_sub_list = False

    def _close_list():
        nonlocal in_list
        _close_sub_list()
        if in_list:
            fragments.append('</ul>')
            in_list = False

    for line in lines:
        stripped = line.rstrip()

        # Section headers
        if stripped.startswith('Project:') or stripped.startswith('Code Environment:'):
            _close_list()
            fragments.append(f'<h3 {_h3_style}>' + _html.escape(stripped) + '</h3>')
            continue

        # Deeply indented list item (4+ spaces then "- ")
        if stripped.startswith('    - ') or stripped.startswith('\t\t- '):
            content = stripped.lstrip().lstrip('- ').strip()
            if not in_list:
                fragments.append(f'<ul {_ul_style}>')
                in_list = True
            if not in_sub_list:
                fragments.append(f'<li {_li_style}><ul {_ul_style}>')
                in_sub_list = True
            fragments.append(f'<li {_li_sub_style}>' + _html.escape(content) + '</li>')
            continue

        # Indented list item (2 spaces then "- ")
        if stripped.startswith('  - ') or stripped.startswith('\t- '):
            _close_sub_list()
            content = stripped.lstrip().lstrip('- ').strip()
            if not in_list:
                fragments.append(f'<ul {_ul_style}>')
                in_list = True
            fragments.append(f'<li {_li_style}>' + _html.escape(content) + '</li>')
            continue

        # Top-level list item ("- ")
        if stripped.startswith('- '):
            _close_sub_list()
            content = stripped[2:].strip()
            if not in_list:
                fragments.append(f'<ul {_ul_style}>')
                in_list = True
            fragments.append(f'<li {_li_style}>' + _html.escape(content) + '</li>')
            continue

        # Empty line = paragraph break
        if not stripped:
            _close_list()
            continue

        # Regular text line
        _close_list()
        fragments.append(f'<p {_p_style}>' + _html.escape(stripped) + '</p>')

    _close_list()
    return _wrap_html_email('\n'.join(fragments))


_PROJECT_ENV_MARKER = '__PEL_HTML__'


def _build_project_env_html(projects_data: list, _pel_grouped: dict) -> str:
    """Build rich HTML cards for the project -> code env -> objects hierarchy."""
    import html as _html
    cards: List[str] = []

    for proj in projects_data:
        if not isinstance(proj, dict):
            continue
        pkey = str(proj.get('projectKey') or '')
        pname = str(proj.get('name') or pkey)
        ce_count = _coerce_int(proj.get('codeEnvCount'), 0)

        parts: List[str] = []
        parts.append(
            '<table cellpadding="0" cellspacing="0" width="100%" style="'
            'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
            'margin:14px 0;font-family:inherit;">'
        )

        # ── Header row ──
        name_html = _html.escape(pname)
        if pname != pkey and pkey:
            name_html += (
                f' <span style="color:#8895a7;font-weight:400;font-size:13px;">'
                f'({_html.escape(pkey)})</span>'
            )
        badge = ''
        if ce_count:
            badge = (
                f' <span style="display:inline-block;background:#e0f2f1;color:#00897b;'
                f'font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;'
                f'margin-left:6px;vertical-align:middle;letter-spacing:0.3px;">'
                f'{ce_count} code env{"s" if ce_count != 1 else ""}</span>'
            )
        parts.append(
            f'<tr><td style="padding:14px 20px 10px 20px;font-weight:600;font-size:15px;'
            f'color:#1a1a2e;border-bottom:1px solid #eef0f4;">'
            f'{name_html}{badge}</td></tr>'
        )

        # ── Code env entries ──
        env_data = _pel_grouped.get(pkey, {})
        env_names = sorted(env_data.keys(), key=lambda e: e.lower()) if env_data else []
        if not env_names:
            env_names = sorted(set(
                str(n) for n in (proj.get('codeEnvNames') or []) if str(n).strip()
            ))

        for idx, env_name in enumerate(env_names):
            obj_lines = env_data.get(env_name, []) if env_data else []
            is_last = idx == len(env_names) - 1

            inner = (
                f'<div style="margin:0 0 2px 0;">'
                f'<span style="display:inline-block;color:#00897b;font-weight:600;'
                f'font-size:13px;">&#9679;&nbsp; {_html.escape(env_name)}</span></div>'
            )

            if obj_lines:
                tags = []
                for obj_line in sorted(obj_lines, key=lambda l: l.lower()):
                    obj_stripped = obj_line.strip()
                    if ':' in obj_stripped:
                        obj_type, obj_name = obj_stripped.split(':', 1)
                        tags.append(
                            f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                            f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                            f'line-height:1.4;">'
                            f'<span style="color:#8895a7;font-weight:500;">'
                            f'{_html.escape(obj_type.strip())}</span>'
                            f' {_html.escape(obj_name.strip())}</span>'
                        )
                    else:
                        tags.append(
                            f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                            f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                            f'line-height:1.4;">{_html.escape(obj_stripped)}</span>'
                        )
                inner += f'<div style="margin:4px 0 0 18px;">{"".join(tags)}</div>'

            bottom_pad = '12px' if is_last else '6px'
            sep = '' if is_last else 'border-bottom:1px solid #f2f4f6;'
            parts.append(
                f'<tr><td style="padding:10px 20px {bottom_pad} 20px;{sep}">'
                f'{inner}</td></tr>'
            )

        parts.append('</table>')
        cards.append('\n'.join(parts))

    if not cards:
        return (
            '<p style="color:#8895a7;font-size:14px;font-style:italic;">'
            'No code environment details available.</p>'
        )
    return '\n'.join(cards)


# ── Markers for rich-HTML injection (all email list variables) ──
_PROJECT_LIST_MARKER = '__PLIST_HTML__'
_CODE_ENV_LIST_MARKER = '__CELIST_HTML__'
_OBJECTS_LIST_MARKER = '__OLIST_HTML__'
_CODE_STUDIO_LIST_MARKER = '__CSLIST_HTML__'
_SCENARIO_LIST_MARKER = '__SCLIST_HTML__'
_INACTIVE_LIST_MARKER = '__IPLIST_HTML__'


def _build_items_html(items: List[str], accent: str = '#3a3f47') -> str:
    """Render a flat list of items as styled inline tags."""
    import html as _html
    if not items:
        return '<span style="color:#8895a7;font-size:13px;font-style:italic;">none</span>'
    tags = []
    for item in items:
        tags.append(
            f'<span style="display:inline-block;background:#f0f2f5;color:{accent};'
            f'font-size:13px;font-weight:500;padding:5px 14px;border-radius:6px;'
            f'margin:3px 4px 3px 0;line-height:1.4;">{_html.escape(item)}</span>'
        )
    return f'<div style="margin:8px 0 4px 0;">{"".join(tags)}</div>'


def _build_code_studio_html(projects_data: list) -> str:
    """Render code studio counts per project as a styled card."""
    import html as _html
    rows: List[str] = []
    valid = [p for p in projects_data if isinstance(p, dict)]
    for idx, proj in enumerate(valid):
        pkey = str(proj.get('projectKey') or '')
        pname = str(proj.get('name') or pkey)
        cs_count = _coerce_int(proj.get('codeStudioCount'), 0)
        is_last = idx == len(valid) - 1
        sep = '' if is_last else 'border-bottom:1px solid #f2f4f6;'

        name_html = _html.escape(pname)
        if pname != pkey and pkey:
            name_html += (
                f' <span style="color:#8895a7;font-weight:400;font-size:13px;">'
                f'({_html.escape(pkey)})</span>'
            )
        badge = (
            f' <span style="display:inline-block;background:#fff3e0;color:#e65100;'
            f'font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;'
            f'margin-left:6px;vertical-align:middle;">'
            f'{cs_count} code studio{"s" if cs_count != 1 else ""}</span>'
        )
        rows.append(
            f'<tr><td style="padding:12px 20px;{sep}font-weight:600;font-size:14px;color:#1a1a2e;">'
            f'{name_html}{badge}</td></tr>'
        )
    if not rows:
        return '<span style="color:#8895a7;font-size:13px;font-style:italic;">none</span>'
    return (
        '<table cellpadding="0" cellspacing="0" width="100%" style="'
        'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
        'margin:14px 0;font-family:inherit;">'
        + ''.join(rows) + '</table>'
    )


def _build_scenario_html(projects_data: list) -> str:
    """Render scenario details per project as styled cards."""
    import html as _html
    cards: List[str] = []
    for proj in projects_data:
        if not isinstance(proj, dict):
            continue
        auto_scenarios = proj.get('autoScenarios') or []
        if not auto_scenarios:
            continue
        pkey = str(proj.get('projectKey') or '')
        pname = str(proj.get('name') or pkey)

        parts: List[str] = []
        parts.append(
            '<table cellpadding="0" cellspacing="0" width="100%" style="'
            'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
            'margin:14px 0;font-family:inherit;">'
        )

        # Header
        name_html = _html.escape(pname)
        if pname != pkey and pkey:
            name_html += (
                f' <span style="color:#8895a7;font-weight:400;font-size:13px;">'
                f'({_html.escape(pkey)})</span>'
            )
        valid_sc = [s for s in auto_scenarios if isinstance(s, dict)]
        badge = (
            f' <span style="display:inline-block;background:#e8eaf6;color:#3949ab;'
            f'font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;'
            f'margin-left:6px;vertical-align:middle;">'
            f'{len(valid_sc)} scenario{"s" if len(valid_sc) != 1 else ""}</span>'
        )
        parts.append(
            f'<tr><td style="padding:14px 20px 10px 20px;font-weight:600;font-size:15px;'
            f'color:#1a1a2e;border-bottom:1px solid #eef0f4;">'
            f'{name_html}{badge}</td></tr>'
        )

        # Scenario rows
        for sidx, sc in enumerate(valid_sc):
            sc_name = str(sc.get('name') or sc.get('id') or 'Unknown')
            sc_type = str(sc.get('type') or 'unknown')
            trigger_count = _coerce_int(sc.get('triggerCount'), 0)
            is_last = sidx == len(valid_sc) - 1

            inner = (
                f'<div style="margin:0 0 2px 0;">'
                f'<span style="display:inline-block;color:#3949ab;font-weight:600;'
                f'font-size:13px;">&#9679;&nbsp; {_html.escape(sc_name)}</span></div>'
            )
            meta_tags = (
                f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                f'line-height:1.4;">'
                f'<span style="color:#8895a7;font-weight:500;">type</span>'
                f' {_html.escape(sc_type)}</span>'
                f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                f'line-height:1.4;">'
                f'<span style="color:#8895a7;font-weight:500;">triggers</span>'
                f' {trigger_count}</span>'
            )
            inner += f'<div style="margin:4px 0 0 18px;">{meta_tags}</div>'

            bottom_pad = '12px' if is_last else '6px'
            sep = '' if is_last else 'border-bottom:1px solid #f2f4f6;'
            parts.append(
                f'<tr><td style="padding:10px 20px {bottom_pad} 20px;{sep}">'
                f'{inner}</td></tr>'
            )

        parts.append('</table>')
        cards.append('\n'.join(parts))
    if not cards:
        return '<span style="color:#8895a7;font-size:13px;font-style:italic;">none</span>'
    return '\n'.join(cards)


def _build_inactive_projects_html(projects_data: list) -> str:
    """Render inactive projects as a styled card with duration badges."""
    import html as _html
    rows: List[str] = []
    valid = [p for p in projects_data if isinstance(p, dict)]
    for idx, proj in enumerate(valid):
        pkey = str(proj.get('projectKey') or '')
        pname = str(proj.get('name') or pkey)
        days_inactive = _coerce_int(proj.get('daysInactive'), 0)
        is_last = idx == len(valid) - 1
        sep = '' if is_last else 'border-bottom:1px solid #f2f4f6;'

        name_html = _html.escape(pname)
        if pname != pkey and pkey:
            name_html += (
                f' <span style="color:#8895a7;font-weight:400;font-size:13px;">'
                f'({_html.escape(pkey)})</span>'
            )
        badge = ''
        if days_inactive > 0:
            badge = (
                f' <span style="display:inline-block;background:#fff3e0;color:#e65100;'
                f'font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;'
                f'margin-left:6px;vertical-align:middle;">'
                f'inactive {days_inactive} days</span>'
            )
        rows.append(
            f'<tr><td style="padding:12px 20px;{sep}font-weight:600;font-size:14px;color:#1a1a2e;">'
            f'{name_html}{badge}</td></tr>'
        )
    if not rows:
        return '<span style="color:#8895a7;font-size:13px;font-style:italic;">none</span>'
    return (
        '<table cellpadding="0" cellspacing="0" width="100%" style="'
        'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
        'margin:14px 0;font-family:inherit;">'
        + ''.join(rows) + '</table>'
    )


def _build_objects_html(usage_details: list, group_by_project: bool = False) -> str:
    """Render usage objects as styled cards, grouped by code env or project."""
    import html as _html

    if group_by_project:
        # Group by project → code env → objects
        grouped: Dict[str, Dict[str, List[tuple]]] = {}
        seen: set = set()
        for u in usage_details:
            if not isinstance(u, dict):
                continue
            usage_type = str(u.get('usageType') or '').strip().upper()
            if usage_type == 'PROJECT':
                continue
            ce = str(u.get('codeEnvName') or u.get('codeEnvKey') or 'Unknown').strip() or 'Unknown'
            pk = str(u.get('projectKey') or '?').strip() or '?'
            obj_label = _email_object_type_label(u.get('objectType'), usage_type)
            obj_name = str(u.get('objectName') or u.get('objectId') or 'unknown').strip() or 'unknown'
            sig = (pk, ce.lower(), obj_label.lower(), obj_name)
            if sig in seen:
                continue
            seen.add(sig)
            grouped.setdefault(pk, {}).setdefault(ce, []).append((obj_label, obj_name))

        if not grouped:
            return '<span style="color:#8895a7;font-size:13px;font-style:italic;">No object usage details found</span>'

        cards: List[str] = []
        for pkey in sorted(grouped.keys(), key=lambda k: k.lower()):
            parts: List[str] = []
            parts.append(
                '<table cellpadding="0" cellspacing="0" width="100%" style="'
                'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
                'margin:14px 0;font-family:inherit;">'
            )
            parts.append(
                f'<tr><td style="padding:14px 20px 10px 20px;font-weight:600;font-size:15px;'
                f'color:#1a1a2e;border-bottom:1px solid #eef0f4;">'
                f'{_html.escape(pkey)}</td></tr>'
            )
            envs = sorted(grouped[pkey].keys(), key=lambda e: e.lower())
            for eidx, env_name in enumerate(envs):
                objs = grouped[pkey][env_name]
                is_last = eidx == len(envs) - 1
                inner = (
                    f'<div style="margin:0 0 2px 0;">'
                    f'<span style="display:inline-block;color:#00897b;font-weight:600;'
                    f'font-size:13px;">&#9679;&nbsp; {_html.escape(env_name)}</span></div>'
                )
                if objs:
                    tags = []
                    for obj_label, obj_name in sorted(objs, key=lambda x: x[1].lower()):
                        tags.append(
                            f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                            f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                            f'line-height:1.4;">'
                            f'<span style="color:#8895a7;font-weight:500;">'
                            f'{_html.escape(obj_label)}</span>'
                            f' {_html.escape(obj_name)}</span>'
                        )
                    inner += f'<div style="margin:4px 0 0 18px;">{"".join(tags)}</div>'
                bottom_pad = '12px' if is_last else '6px'
                sep = '' if is_last else 'border-bottom:1px solid #f2f4f6;'
                parts.append(
                    f'<tr><td style="padding:10px 20px {bottom_pad} 20px;{sep}">'
                    f'{inner}</td></tr>'
                )
            parts.append('</table>')
            cards.append('\n'.join(parts))
        return '\n'.join(cards)

    # Group by code env → objects (with project context)
    grouped_by_env: Dict[str, List[tuple]] = {}
    seen2: set = set()
    for u in usage_details:
        if not isinstance(u, dict):
            continue
        usage_type = str(u.get('usageType') or '').strip().upper()
        if usage_type == 'PROJECT':
            continue
        ce = str(u.get('codeEnvName') or u.get('codeEnvKey') or 'Unknown').strip() or 'Unknown'
        pk = str(u.get('projectKey') or '?').strip() or '?'
        obj_label = _email_object_type_label(u.get('objectType'), usage_type)
        obj_name = str(u.get('objectName') or u.get('objectId') or 'unknown').strip() or 'unknown'
        sig = (ce.lower(), pk, obj_label.lower(), obj_name)
        if sig in seen2:
            continue
        seen2.add(sig)
        grouped_by_env.setdefault(ce, []).append((obj_label, obj_name, pk))

    if not grouped_by_env:
        return '<span style="color:#8895a7;font-size:13px;font-style:italic;">No object usage details found</span>'

    cards2: List[str] = []
    for env_name in sorted(grouped_by_env.keys(), key=lambda n: n.lower()):
        objs = grouped_by_env[env_name]
        parts2: List[str] = []
        parts2.append(
            '<table cellpadding="0" cellspacing="0" width="100%" style="'
            'background:#fafbfc;border:1px solid #e5eaf0;border-radius:8px;'
            'margin:14px 0;font-family:inherit;">'
        )
        parts2.append(
            f'<tr><td style="padding:14px 20px 10px 20px;font-weight:600;font-size:15px;'
            f'color:#00897b;border-bottom:1px solid #eef0f4;">'
            f'&#9679;&nbsp; {_html.escape(env_name)}</td></tr>'
        )
        tags = []
        for obj_label, obj_name, pk in sorted(objs, key=lambda x: (x[2].lower(), x[1].lower())):
            tags.append(
                f'<span style="display:inline-block;background:#eef0f5;color:#4a5568;'
                f'font-size:12px;padding:3px 10px;border-radius:4px;margin:2px 3px 2px 0;'
                f'line-height:1.4;">'
                f'<span style="color:#8895a7;font-weight:500;">'
                f'{_html.escape(obj_label)}</span>'
                f' {_html.escape(obj_name)}'
                f' <span style="color:#b0b8c4;font-size:11px;">({_html.escape(pk)})</span>'
                f'</span>'
            )
        parts2.append(
            f'<tr><td style="padding:10px 20px 12px 20px;">'
            f'<div style="margin:4px 0 0 0;">{"".join(tags)}</div>'
            f'</td></tr>'
        )
        parts2.append('</table>')
        cards2.append('\n'.join(parts2))
    return '\n'.join(cards2)


def _default_email_template(campaign: str) -> Dict[str, str]:
    if campaign == 'code_env':
        return {
            'subject': '[DSS Health] Code environment ownership mismatch in your projects',
            'body': (
                "Hi {{owner}},\n\n"
                "DSS health checks flagged code environments in your projects that are owned by other users.\n"
                "Project owners should own their project code environments (ideally one per project) so changes do not break other projects.\n\n"
                "Impacted projects:\n{{project_list}}\n\n"
                "Code environments not owned by you:\n{{code_env_list}}\n\n"
                "Detected objects:\n{{objects_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'code_studio':
        return {
            'subject': '[DSS Health] Too many Code Studios in your projects',
            'body': (
                "Hi {{owner}},\n\n"
                "DSS health checks flagged that some of your projects have too many Code Studios.\n"
                "Please consolidate or remove unused Code Studios to reduce resource consumption.\n\n"
                "Projects with excessive Code Studios:\n{{code_studio_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'auto_scenario':
        return {
            'subject': '[DSS Health] Review auto-start scenarios in your projects',
            'body': (
                "Hi {{owner}},\n\n"
                "DSS health checks found scenarios set to automatically start in your projects.\n"
                "Please review these scenarios to ensure they are still needed and properly configured.\n\n"
                "Projects and auto-start scenarios:\n{{scenario_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'disabled_user':
        return {
            'subject': '[DSS Health] Projects owned by disabled users need reassignment',
            'body': (
                "Hi admin,\n\n"
                "The following projects are owned by disabled user accounts.\n"
                "Please reassign ownership to active users.\n\n"
                "Projects owned by disabled users:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'deprecated_code_env':
        return {
            'subject': '[DSS Health] Deprecated Python versions in your code environments',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your code environments use deprecated Python versions (2.x, 3.6, or 3.7).\n"
                "Please upgrade to a supported Python version.\n\n"
                "Code environments:\n{{code_env_list}}\n\n"
                "Impacted projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'default_code_env':
        return {
            'subject': '[DSS Health] Projects missing default code environment',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects use code environments but have no default Python code environment configured.\n"
                "Setting a default code environment prevents unexpected version conflicts.\n\n"
                "Projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'overshared_project':
        return {
            'subject': '[DSS Health] Projects with excessive permissions',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects have a large number of permission entries.\n"
                "Please review and consolidate permissions using groups where possible.\n\n"
                "Projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'scenario_frequency':
        return {
            'subject': '[DSS Health] High-frequency scenarios in your projects',
            'body': (
                "Hi {{owner}},\n\n"
                "Some scenarios in your projects run very frequently (under 30 minutes).\n"
                "Please review whether this frequency is necessary.\n\n"
                "Projects and scenarios:\n{{scenario_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'empty_project':
        return {
            'subject': '[DSS Health] Empty projects that may need cleanup',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects appear to be empty or unused.\n"
                "Please archive or delete projects that are no longer needed.\n\n"
                "Projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'large_flow':
        return {
            'subject': '[DSS Health] Projects with large flows',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects have very large flows with many objects.\n"
                "Consider splitting large flows into smaller, focused projects.\n\n"
                "Projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'orphan_notebooks':
        return {
            'subject': '[DSS Health] Projects with many notebooks but few recipes',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects have many notebooks but few recipes.\n"
                "Consider converting mature notebooks into recipes for production use.\n\n"
                "Projects:\n{{project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'scenario_failing':
        return {
            'subject': '[DSS Health] Failing scenarios in your projects',
            'body': (
                "Hi {{owner}},\n\n"
                "Some scenarios in your projects have failed in their last run.\n"
                "Please investigate and fix the failing scenarios.\n\n"
                "Projects and failing scenarios:\n{{scenario_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'inactive_project':
        return {
            'subject': '[DSS Health] Inactive projects that may need cleanup',
            'body': (
                "Hi {{owner}},\n\n"
                "Some of your projects have been inactive for a long time.\n"
                "A project is considered inactive when it has no recent modifications, "
                "no active scenarios, and no deployed bundles.\n\n"
                "Please delete or archive projects that are no longer needed to keep the instance clean.\n\n"
                "Inactive projects:\n{{inactive_project_list}}\n\n"
                "Thanks."
            ),
        }
    if campaign == 'unused_code_env':
        return {
            'subject': '[DSS Health] Unused code environments you own',
            'body': (
                "Hi {{owner}},\n\n"
                "Some code environments you own have zero usages across all projects.\n"
                "Please delete code environments that are no longer needed to free up resources.\n\n"
                "Unused code environments:\n{{code_env_list}}\n\n"
                "Thanks."
            ),
        }
    return {
        'subject': '[DSS Health] Please reduce code environments in your projects',
        'body': (
            "Hi {{owner}},\n\n"
            "DSS health checks flagged that some of your projects use too many code environments.\n"
            "Please keep one code environment per project unless absolutely necessary.\n\n"
            "{{project_env_list}}\n\n"
            "Thanks."
        ),
    }


def _render_template_text(template: str, variables: Dict[str, str]) -> str:
    out = template or ''
    for key, value in variables.items():
        out = out.replace(f'{{{{{key}}}}}', value)
    return out


def _list_mail_channels(client: Any, diagnostics: Optional[List[str]] = None) -> List[Dict[str, str]]:
    diag = diagnostics if diagnostics is not None else []
    channels: List[Dict[str, str]] = []
    raw_items: List[Any] = []

    has_method = hasattr(client, 'list_messaging_channels')
    diag.append(f"has_list_messaging_channels={has_method}")

    if has_method:
        for idx, attempt in enumerate((
            lambda: client.list_messaging_channels(as_type='objects', channel_family='mail'),
            lambda: client.list_messaging_channels(channel_family='mail'),
            lambda: client.list_messaging_channels(),
        )):
            try:
                result = attempt()
                rtype = type(result).__name__
                rlen = len(result) if isinstance(result, (list, tuple)) else '?'
                diag.append(f"python_attempt[{idx}] type={rtype} len={rlen}")
                if isinstance(result, list):
                    raw_items.extend(result)
            except Exception as exc:
                diag.append(f"python_attempt[{idx}] error={exc!r}")
                continue

    diag.append(f"raw_items_after_python_client={len(raw_items)}")

    # If Python client method didn't yield results, try internal HTTP API
    if not raw_items:
        for api_path in ('/admin/messaging-channels/', '/public/api/admin/messaging-channels/'):
            try:
                result = _client_perform_json(client, 'GET', api_path)
                rtype = type(result).__name__ if result is not None else 'None'
                rlen = len(result) if isinstance(result, (list, dict)) else '?'
                diag.append(f"http_fallback path={api_path} type={rtype} len={rlen}")
                if isinstance(result, list):
                    raw_items.extend(result)
                    break
                # Some endpoints wrap in {"channels": [...]}
                if isinstance(result, dict):
                    items = result.get('channels') or result.get('items') or []
                    if isinstance(items, list) and items:
                        raw_items.extend(items)
                        diag.append(f"http_fallback unwrapped keys={list(result.keys())[:5]} items={len(items)}")
                        break
            except Exception as exc:
                diag.append(f"http_fallback path={api_path} error={exc!r}")
                continue

    # Log first few item shapes for diagnostics
    for i, item in enumerate(raw_items[:3]):
        if isinstance(item, dict):
            diag.append(f"item[{i}] type=dict keys={sorted(item.keys())[:8]}")
        else:
            diag.append(f"item[{i}] type={type(item).__name__} attrs={[a for a in dir(item) if not a.startswith('_')][:8]}")

    for item in raw_items:
        channel_id = None
        label = None
        family = ''
        channel_type = ''

        if isinstance(item, dict):
            family = str(item.get('channelFamily') or item.get('family') or '').lower()
            channel_type = str(item.get('type') or '').lower()
            channel_id = (
                item.get('id')
                or item.get('name')
                or item.get('identifier')
            )
            label = item.get('label') or item.get('name') or channel_id
        else:
            if hasattr(item, 'get_id'):
                try:
                    channel_id = item.get_id()
                except Exception:
                    channel_id = None
            if hasattr(item, 'id') and not channel_id:
                try:
                    channel_id = getattr(item, 'id')
                except Exception:
                    channel_id = None
            if hasattr(item, 'family') and not family:
                try:
                    family = str(getattr(item, 'family') or '').lower()
                except Exception:
                    family = ''
            if hasattr(item, 'type'):
                try:
                    channel_type = str(getattr(item, 'type') or '').lower()
                except Exception:
                    channel_type = ''
            if hasattr(item, 'get_raw'):
                try:
                    raw = item.get_raw()
                    if isinstance(raw, dict):
                        family = str(raw.get('channelFamily') or raw.get('family') or family).lower()
                        channel_type = str(raw.get('type') or channel_type).lower()
                        if not channel_id:
                            channel_id = raw.get('id') or raw.get('name')
                        label = raw.get('label') or raw.get('name')
                except Exception:
                    pass
            if hasattr(item, 'name') and not label:
                label = getattr(item, 'name')

        if family and family != 'mail':
            continue
        if not family and channel_type and channel_type not in ('smtp', 'mail'):
            continue

        if not channel_id:
            continue
        channels.append({
            'id': str(channel_id),
            'label': str(label or channel_id),
        })

    unique: Dict[str, Dict[str, str]] = {}
    for channel in channels:
        unique[channel['id']] = channel

    result = list(unique.values())
    diag.append(f"raw_items={len(raw_items)} filtered={len(channels)} deduped={len(result)}")
    if not result:
        app.logger.warning(
            "[tools] _list_mail_channels: no mail channels found — diag: %s",
            "; ".join(diag),
        )
    return result


def _get_mail_channel(client: Any, requested_id: Optional[str]) -> Any:
    channels = _list_mail_channels(client)
    if not channels:
        return None

    selected = channels[0]
    if requested_id:
        for channel in channels:
            if channel['id'] == requested_id:
                selected = channel
                break

    channel_id = selected['id']
    if not hasattr(client, 'get_messaging_channel'):
        channel = None
    else:
        try:
            channel = client.get_messaging_channel(channel_id)
            if channel is not None:
                return channel
        except Exception:
            channel = None

    if hasattr(client, 'list_messaging_channels'):
        for attempt in (
            lambda: client.list_messaging_channels(as_type='objects', channel_family='mail'),
            lambda: client.list_messaging_channels(as_type='objects'),
        ):
            try:
                items = attempt()
            except Exception:
                continue
            if not isinstance(items, list):
                continue
            for item in items:
                item_id = None
                if hasattr(item, 'id'):
                    try:
                        item_id = str(getattr(item, 'id'))
                    except Exception:
                        item_id = None
                if not item_id and hasattr(item, 'get_id'):
                    try:
                        item_id = str(item.get_id())
                    except Exception:
                        item_id = None
                if item_id and item_id == channel_id:
                    return item
    return None


_PYTHON_WEBAPP_TYPES = {'DASH', 'STANDARD', 'BOKEH'}


def _list_projects_catalog(client: Any) -> List[Dict[str, str]]:
    projects = _bench_call('list_projects', client.list_projects) or []
    out: List[Dict[str, str]] = []
    for project in projects:
        if not isinstance(project, dict):
            continue
        key = str(project.get('projectKey') or project.get('key') or project.get('id') or '').strip()
        if not key:
            continue
        entry: Dict[str, Any] = {
            'key': key,
            'name': str(project.get('name') or key),
            'owner': str(project.get('ownerLogin') or project.get('owner') or project.get('ownerName') or 'Unknown'),
        }
        version_tag = project.get('versionTag') or {}
        if isinstance(version_tag, dict):
            last_modified = version_tag.get('lastModifiedOn')
            if last_modified is not None:
                entry['lastModifiedOn'] = last_modified
        out.append(entry)
    out.sort(key=lambda item: item.get('key') or '')
    return out


def _build_project_info(client: Any, limit: int, include_settings: bool = True) -> Dict[str, Dict[str, str]]:
    project_info: Dict[str, Dict[str, str]] = {}
    projects = _list_projects_catalog(client)
    if limit > 0:
        projects = projects[:limit]

    # Pre-populate from catalog data (no API calls)
    catalog_by_key: Dict[str, Dict[str, str]] = {}
    project_keys: List[str] = []
    for project in projects:
        key = project.get('key')
        if not key:
            continue
        cat_entry: Dict[str, Any] = {
            'owner': str(project.get('owner') or 'Unknown'),
            'name': str(project.get('name') or key),
        }
        if project.get('lastModifiedOn') is not None:
            cat_entry['lastModifiedOn'] = project['lastModifiedOn']
        catalog_by_key[key] = cat_entry
        project_keys.append(key)

    if not include_settings:
        for key in project_keys:
            entry: Dict[str, Any] = {
                'name': catalog_by_key[key]['name'],
                'owner': catalog_by_key[key]['owner'],
            }
            if catalog_by_key[key].get('lastModifiedOn') is not None:
                entry['lastModifiedOn'] = catalog_by_key[key]['lastModifiedOn']
            project_info[key] = entry
        return project_info

    def _fetch_project_settings(key: str) -> Tuple[str, Dict[str, str]]:
        local_client = _thread_client()
        info: Dict[str, Any] = {
            'name': catalog_by_key[key]['name'],
            'owner': catalog_by_key[key]['owner'],
        }
        if catalog_by_key[key].get('lastModifiedOn') is not None:
            info['lastModifiedOn'] = catalog_by_key[key]['lastModifiedOn']
        try:
            project_obj = _bench_call('get_project', local_client.get_project, key)
            settings = project_obj.get_settings().get_raw()
            if isinstance(settings, dict):
                if settings.get('owner'):
                    info['owner'] = str(settings.get('owner'))
                if settings.get('name'):
                    info['name'] = str(settings.get('name'))
                default_python_env = _extract_nested_text(
                    settings,
                    'settings.codeEnvs.python.envName',
                    'codeEnvs.python.envName',
                )
                if default_python_env:
                    info['defaultPythonEnv'] = default_python_env
        except Exception:
            pass
        return (key, info)

    workers = min(_parallel_workers(8), len(project_keys))
    if workers <= 1:
        for key in project_keys:
            _, info = _fetch_project_settings(key)
            project_info[key] = info
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_fetch_project_settings, key): key for key in project_keys}
            for future in as_completed(futures):
                try:
                    key, info = future.result()
                    project_info[key] = info
                except Exception:
                    fkey = futures[future]
                    project_info[fkey] = {
                        'name': catalog_by_key[fkey]['name'],
                        'owner': catalog_by_key[fkey]['owner'],
                    }

    return project_info


def _get_code_env_size_map(client: Any) -> Dict[str, int]:
    size_by_env: Dict[str, int] = {}
    global_footprint = _compute_footprint_payload(client, 'global', None)
    if isinstance(global_footprint, dict):
        code_envs_section = global_footprint.get('codeEnvs')
        if isinstance(code_envs_section, dict):
            items = code_envs_section.get('items')
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    name = item.get('name')
                    language = str(item.get('language') or '').strip().lower()
                    if not name or not language:
                        continue
                    size_by_env[f"{language}:{name}"] = _coerce_int(item.get('size'), 0)
    return size_by_env


def _extract_project_footprint_map_from_all_dss(payload: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not isinstance(payload, dict):
        return out
    projects = payload.get('projects')
    if not isinstance(projects, dict):
        return out
    items = projects.get('items')
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get('projectKey') or '').strip()
        if not key:
            continue
        out[key] = item
    return out


def _fetch_project_footprint(project_key: str) -> Dict[str, Any]:
    project_key = str(project_key or '').strip()
    if not project_key:
        return {'projectKey': '', 'payload': None}
    client = _thread_client()
    payload = _compute_footprint_payload(client, 'project', project_key)
    return {'projectKey': project_key, 'payload': payload}


def _build_project_footprint_map(client: Any, project_keys: List[str]) -> Dict[str, Any]:
    return _build_project_footprint_map_with_deadline(client, project_keys, None, None)


def _build_project_footprint_map_with_deadline(
    client: Any,
    project_keys: List[str],
    deadline_ts: Optional[float] = None,
    progress_cb: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    wanted_keys = [str(key) for key in project_keys if str(key).strip()]
    footprint_map: Dict[str, Any] = {}

    started = time.time()
    if not wanted_keys:
        return footprint_map

    # Run direct per-project footprint calls with a fixed parallelism budget.
    max_workers = min(5, len(wanted_keys))
    app.logger.info("[footprint-map] mode=per-project wanted=%s workers=%s", len(wanted_keys), max_workers)
    _notify_progress(
        progress_cb,
        'project_footprint_fetch_pool_start',
        f"project footprint fetch started projects={len(wanted_keys)} workers={max_workers}",
    )
    if max_workers <= 1:
        for key in wanted_keys:
            if deadline_ts is not None and time.time() >= deadline_ts:
                _notify_progress(progress_cb, 'project_footprint_fetch_timeout', 'deadline reached before serial fetch', 'warn', key)
                break
            fetch_started = time.time()
            _notify_progress(progress_cb, 'project_footprint_fetch_start', 'fetch project footprint', 'info', key)
            result = _fetch_project_footprint(key)
            payload = result.get('payload')
            if payload is not None:
                footprint_map[key] = payload
                _notify_progress(
                    progress_cb,
                    'project_footprint_fetch_ok',
                    'project footprint loaded',
                    'info',
                    key,
                    elapsed_ms=(time.time() - fetch_started) * 1000.0,
                )
            else:
                _notify_progress(
                    progress_cb,
                    'project_footprint_fetch_error',
                    'project footprint payload missing',
                    'warn',
                    key,
                    elapsed_ms=(time.time() - fetch_started) * 1000.0,
                )
        app.logger.info("[footprint-map] serial rows=%s elapsed=%.2fs", len(footprint_map), time.time() - started)
        _notify_progress(
            progress_cb,
            'project_footprint_fetch_pool_done',
            f"project footprint fetch completed rows={len(footprint_map)}",
            'info',
            elapsed_ms=(time.time() - started) * 1000.0,
        )
        return footprint_map

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_key: Dict[Any, str] = {}
        future_started_at: Dict[str, float] = {}
        for key in wanted_keys:
            if deadline_ts is not None and time.time() >= deadline_ts:
                _notify_progress(progress_cb, 'project_footprint_fetch_timeout', 'deadline reached while submitting fetch jobs', 'warn', key)
                break
            _notify_progress(progress_cb, 'project_footprint_fetch_start', 'fetch project footprint', 'info', key)
            future_started_at[key] = time.time()
            future = pool.submit(_fetch_project_footprint, key)
            future_to_key[future] = key

        timed_out = False
        if future_to_key:
            timeout_seconds: Optional[float] = None
            if deadline_ts is not None:
                timeout_seconds = max(0.0, deadline_ts - time.time())
            try:
                future_iter = as_completed(list(future_to_key.keys()), timeout=timeout_seconds)
                for future in future_iter:
                    key = future_to_key.get(future, '')
                    if deadline_ts is not None and time.time() >= deadline_ts:
                        timed_out = True
                        _notify_progress(progress_cb, 'project_footprint_fetch_timeout', 'deadline reached while collecting results', 'warn', key or None)
                        break
                    try:
                        result = future.result()
                    except Exception as exc:
                        _notify_progress(progress_cb, 'project_footprint_fetch_error', f"fetch error: {exc}", 'warn', key or None)
                        continue
                    key = str(result.get('projectKey') or key or '')
                    payload = result.get('payload')
                    if key and payload is not None:
                        footprint_map[key] = payload
                        started_at = future_started_at.get(key, started)
                        _notify_progress(
                            progress_cb,
                            'project_footprint_fetch_ok',
                            'project footprint loaded',
                            'info',
                            key,
                            elapsed_ms=(time.time() - started_at) * 1000.0,
                        )
                    elif key:
                        started_at = future_started_at.get(key, started)
                        _notify_progress(
                            progress_cb,
                            'project_footprint_fetch_error',
                            'project footprint payload missing',
                            'warn',
                            key,
                            elapsed_ms=(time.time() - started_at) * 1000.0,
                        )
            except FuturesTimeoutError:
                timed_out = True
                _notify_progress(progress_cb, 'project_footprint_fetch_timeout', 'deadline reached while waiting for project footprint futures', 'warn')

        if timed_out or (deadline_ts is not None and time.time() >= deadline_ts):
            for future, key in future_to_key.items():
                if future.done():
                    continue
                future.cancel()
                started_at = future_started_at.get(key, started)
                _notify_progress(
                    progress_cb,
                    'project_footprint_fetch_timeout',
                    'project footprint fetch cancelled on deadline',
                    'warn',
                    key,
                    elapsed_ms=(time.time() - started_at) * 1000.0,
                )

    app.logger.info("[footprint-map] final rows=%s elapsed=%.2fs", len(footprint_map), time.time() - started)
    _notify_progress(
        progress_cb,
        'project_footprint_fetch_pool_done',
        f"project footprint fetch completed rows={len(footprint_map)}",
        'info',
        elapsed_ms=(time.time() - started) * 1000.0,
    )
    return footprint_map


def _load_code_env_catalog_entry(env_listing: Dict[str, Any], size_by_env: Dict[str, int]) -> Optional[Dict[str, Any]]:
    if not isinstance(env_listing, dict):
        return None
    env_name = env_listing.get('envName') or env_listing.get('name') or env_listing.get('id')
    env_lang_raw = env_listing.get('envLang') or env_listing.get('language') or env_listing.get('type') or 'PYTHON'
    if not env_name:
        return None
    language = _normalize_language(env_lang_raw)
    env_key = f"{language}:{env_name}"
    owner = _extract_code_env_owner(env_listing, {})
    return {
        'envKey': env_key,
        'name': str(env_name),
        'language': language,
        'owner': owner,
        'sizeBytes': _coerce_int(size_by_env.get(env_key), 0),
        'pythonVersion': str(env_listing.get('pythonVersion') or env_listing.get('pythonInterpreter') or ''),
    }


def _fetch_code_env_details(
    client: Any, lang_upper: str, env_name: str,
    fetch_settings: bool = True, fetch_usages: bool = True,
) -> Tuple[Dict[str, Any], List[Any]]:
    """Fetch code env settings and usages. Returns (settings_raw, usages)."""
    settings_raw: Dict[str, Any] = {}
    usages: List[Any] = []
    env_obj = None
    if fetch_settings and hasattr(client, 'get_code_env'):
        try:
            env_obj = _bench_call('get_code_env', client.get_code_env, lang_upper, env_name)
        except Exception:
            env_obj = None
    if env_obj is not None:
        try:
            settings_raw = _safe_get_raw(env_obj.get_settings())
        except Exception:
            settings_raw = {}
        if fetch_usages:
            try:
                if hasattr(env_obj, 'list_usages'):
                    usages = _bench_call('list_code_env_usages', env_obj.list_usages) or []
            except Exception:
                usages = []
    return settings_raw, usages


def _load_code_env_usage_payload(
    env_listing: Dict[str, Any],
    project_info: Dict[str, Dict[str, str]],
    size_by_env: Dict[str, int],
) -> Optional[Dict[str, Any]]:
    if not isinstance(env_listing, dict):
        return None

    env_name = env_listing.get('envName') or env_listing.get('name') or env_listing.get('id')
    env_lang_raw = env_listing.get('envLang') or env_listing.get('language') or env_listing.get('type') or 'PYTHON'
    if not env_name:
        return None

    normalized_lang = _normalize_language(env_lang_raw)
    env_key = f"{normalized_lang}:{env_name}"

    client = _thread_client()
    settings_raw, usages = _fetch_code_env_details(client, normalized_lang.upper(), env_name)

    owner = _extract_code_env_owner(env_listing, settings_raw)
    normalized_usages: List[Dict[str, Any]] = []
    for raw_usage in usages:
        usage = _usage_to_dict(raw_usage)
        project_key = _extract_usage_project_key(usage)
        if not project_key or project_key not in project_info:
            continue
        normalized = _normalize_usage_entry(usage, project_info)
        normalized_usages.append({
            'projectKey': project_key,
            'usageType': str(normalized.get('usageType') or 'UNKNOWN'),
            'objectType': str(normalized.get('objectType') or normalized.get('usageType') or 'UNKNOWN'),
            'objectId': str(normalized.get('objectId') or ''),
            'objectName': str(normalized.get('objectName') or normalized.get('objectId') or ''),
            'source': 'code_env_usage_api',
        })

    return {
        'envKey': env_key,
        'name': str(env_name),
        'language': normalized_lang,
        'owner': owner,
        'sizeBytes': _coerce_int(size_by_env.get(env_key), 0),
        'pythonVersion': str(env_listing.get('pythonVersion') or env_listing.get('pythonInterpreter') or ''),
        'deploymentMode': str(env_listing.get('deploymentMode') or ''),
        'usages': normalized_usages,
    }


def _load_code_env_full_details(
    env_listing: Dict[str, Any],
    project_info: Dict[str, Dict[str, str]],
    size_by_env: Dict[str, int],
    include_usages: bool = True,
) -> Optional[Dict[str, Any]]:
    if not isinstance(env_listing, dict):
        return None

    name = env_listing.get('envName') or env_listing.get('name') or env_listing.get('id')
    lang = env_listing.get('envLang') or env_listing.get('language') or env_listing.get('type')
    version = env_listing.get('pythonVersion') or env_listing.get('rVersion') or env_listing.get('version')
    if not name:
        return None

    language = _normalize_language(lang)

    size_key = f"{language}:{name}"
    size_bytes = _coerce_int(size_by_env.get(size_key), 0)
    owner = _extract_code_env_owner(env_listing, {})

    # Fast path for large instances: avoid fetching settings/usages unless needed.
    should_fetch = include_usages or (not version) or owner == 'Unknown'
    client = _thread_client()
    settings_raw, usages = _fetch_code_env_details(
        client, language.upper(), name,
        fetch_settings=should_fetch, fetch_usages=include_usages,
    )
    if settings_raw:
        owner = _extract_code_env_owner(env_listing, settings_raw)
    normalized_usages: List[Dict[str, Any]] = []
    usage_counts: Dict[str, int] = {}
    project_keys: set = set()
    for raw_usage in usages:
        usage = _usage_to_dict(raw_usage)
        normalized = _normalize_usage_entry(usage, project_info)
        normalized.update({
            'codeEnvName': name,
            'codeEnvLanguage': language,
            'codeEnvOwner': owner,
            'codeEnvKey': size_key,
        })
        usage_type = str(normalized.get('usageType') or 'UNKNOWN')
        usage_counts[usage_type] = usage_counts.get(usage_type, 0) + 1
        project_key = str(normalized.get('projectKey') or '')
        if project_key:
            project_keys.add(project_key)
        normalized_usages.append(normalized)

    if language == 'r':
        version_label = str(version or 'R')
    else:
        detail_version = (
            _extract_nested_text(
                settings_raw,
                'desc.pythonInterpreter',
                'pythonInterpreter',
                'spec.pythonInterpreter',
            )
            or env_listing.get('pythonInterpreter')
            or version
        )
        if not detail_version and include_usages:
            detail = _bench_call('code_env_detail_lookup', _client_perform_json, client, 'GET', f"/admin/code-envs/PYTHON/{name}")
            if isinstance(detail, dict):
                detail_version = _extract_nested_text(detail, 'desc.pythonInterpreter', 'pythonInterpreter')

        raw_version_text = str(detail_version or 'Unknown')
        match = re.search(r'PYTHON(\d)(\d+)', raw_version_text, flags=re.IGNORECASE)
        if match:
            version_label = f"{int(match.group(1))}.{int(match.group(2))}"
        else:
            dotted = re.search(r'(\d+)\.(\d+)', raw_version_text)
            version_label = f"{dotted.group(1)}.{dotted.group(2)}" if dotted else raw_version_text

    return {
        'language': language,
        'versionLabel': version_label,
        'row': {
            'name': name,
            'version': version_label,
            'language': language,
            'sizeBytes': size_bytes,
            'owner': owner,
            'usageCount': len(normalized_usages),
            'usageSummary': usage_counts,
            'projectCount': len(project_keys),
            'projectKeys': sorted(project_keys),
            'usageDetails': _dedupe_usage_entries(normalized_usages),
        },
    }


def _collect_project_python_objects(
    project_obj: Any,
    project_key: str,
    progress_cb: Optional[Callable[..., None]] = None,
    deadline_ts: Optional[float] = None,
) -> Dict[str, Any]:
    objects: List[Dict[str, Any]] = []
    started = time.time()
    metrics: Dict[str, Any] = {
        'recipesListed': 0,
        'recipeObjects': 0,
        'webappsListed': 0,
        'webappObjects': 0,
        'notebooksListed': 0,
        'notebookObjects': 0,
        'scenariosListed': 0,
        'scenarioObjects': 0,
        'objectsFound': 0,
    }

    def _deadline_reached(step_name: str) -> bool:
        if deadline_ts is None:
            return False
        if time.time() < deadline_ts:
            return False
        _notify_progress(progress_cb, step_name, 'deadline reached during project object scan', 'warn', project_key)
        return True

    _notify_progress(progress_cb, 'project_objects_scan_start', 'project object scan started', 'info', project_key)

    # As requested, this follows the same collection pattern used in:
    # /data/projects/pythonaudit/.../project_standards_check_spec.py
    recipe_step_started = time.time()
    recipe_objects = 0
    recipes: List[Any] = []
    try:
        recipes = _bench_call('list_project_recipes', project_obj.list_recipes) or []
    except Exception as exc:
        _notify_progress(progress_cb, 'project_scan_recipes_error', f"failed to list recipes: {exc}", 'warn', project_key)
    metrics['recipesListed'] = len(recipes)
    for recipe in recipes:
        if _deadline_reached('project_scan_recipes_timeout'):
            break
        recipe_name = recipe.get('name')
        if not recipe_name:
            continue
        recipe_type = str(recipe.get('type') or 'recipe').strip().upper()
        if recipe_type in _NON_CODE_RECIPE_TYPES:
            continue

        # Try to extract env info directly from listing data (avoids per-recipe API calls).
        listing_params = recipe.get('params') if isinstance(recipe, dict) else None
        if isinstance(listing_params, dict) and isinstance(listing_params.get('envSelection'), dict):
            payload: Dict[str, Any] = {'rawParams': listing_params}
            objects.append({
                'projectKey': project_key,
                'usageType': 'RECIPE',
                'objectType': f"RECIPE_{recipe_type}",
                'objectId': str(recipe_name),
                'objectName': str(recipe_name),
                'payload': payload,
                'source': 'project_object_scan',
            })
            recipe_objects += 1
            continue

        # Fallback: per-recipe API call when listing data lacks params.
        try:
            recipe_obj = _bench_call('get_recipe', project_obj.get_recipe, recipe_name)
            settings = _bench_call('get_recipe_settings', recipe_obj.get_settings)
            payload: Dict[str, Any] = {}
            if hasattr(settings, 'get_code_env_settings'):
                try:
                    env_settings = settings.get_code_env_settings()
                    if isinstance(env_settings, dict):
                        payload['codeEnvSettings'] = env_settings
                except Exception:
                    pass
            if hasattr(settings, 'get_recipe_raw_definition'):
                try:
                    raw_def = settings.get_recipe_raw_definition()
                    if isinstance(raw_def, dict):
                        payload['recipeRawDefinition'] = raw_def
                except Exception:
                    pass
            raw_params = getattr(settings, 'raw_params', None)
            if isinstance(raw_params, dict):
                payload['rawParams'] = raw_params
            objects.append({
                'projectKey': project_key,
                'usageType': 'RECIPE',
                'objectType': f"RECIPE_{recipe_type}",
                'objectId': str(recipe_name),
                'objectName': str(recipe_name),
                'payload': payload,
                'source': 'project_object_scan',
            })
            recipe_objects += 1
        except Exception:
            continue
    metrics['recipeObjects'] = recipe_objects
    _notify_progress(
        progress_cb,
        'project_scan_recipes_listed',
        f"recipes listed={metrics['recipesListed']} objects={recipe_objects}",
        'info',
        project_key,
        elapsed_ms=(time.time() - recipe_step_started) * 1000.0,
    )

    webapp_step_started = time.time()
    webapp_objects = 0
    webapps: List[Any] = []
    try:
        webapps = _bench_call('list_project_webapps', project_obj.list_webapps) or []
    except Exception as exc:
        _notify_progress(progress_cb, 'project_scan_webapps_error', f"failed to list webapps: {exc}", 'warn', project_key)
    metrics['webappsListed'] = len(webapps)

    # Bulk-fetch webapp details via REST listing endpoint to avoid per-webapp API calls.
    webapp_details_by_id: Dict[str, Dict[str, Any]] = {}
    try:
        bulk_webapps = _client_perform_json(_thread_client(), 'GET', f'/projects/{project_key}/webapps/')
        if isinstance(bulk_webapps, list):
            for wd in bulk_webapps:
                if isinstance(wd, dict) and wd.get('id'):
                    webapp_details_by_id[str(wd['id'])] = wd
    except Exception:
        pass

    for webapp in webapps:
        if _deadline_reached('project_scan_webapps_timeout'):
            break
        webapp_id = webapp.get('id')
        if not webapp_id:
            continue

        # Use pre-fetched data when available; fall back to per-object calls otherwise.
        bulk_detail = webapp_details_by_id.get(str(webapp_id))
        if isinstance(bulk_detail, dict) and bulk_detail:
            objects.append({
                'projectKey': project_key,
                'usageType': 'WEBAPP_BACKEND',
                'objectType': 'WEBAPP_BACKEND',
                'objectId': str(webapp_id),
                'objectName': str(webapp_id),
                'payload': bulk_detail,
                'source': 'project_object_scan',
            })
            webapp_objects += 1
            continue

        try:
            webapp_obj = _bench_call('get_webapp', project_obj.get_webapp, webapp_id)
            settings_raw = _bench_call('get_webapp_settings_raw', lambda: webapp_obj.get_settings().get_raw())
            objects.append({
                'projectKey': project_key,
                'usageType': 'WEBAPP_BACKEND',
                'objectType': 'WEBAPP_BACKEND',
                'objectId': str(webapp_id),
                'objectName': str(webapp_id),
                'payload': settings_raw if isinstance(settings_raw, dict) else {},
                'source': 'project_object_scan',
            })
            webapp_objects += 1
        except Exception:
            continue
    metrics['webappObjects'] = webapp_objects
    _notify_progress(
        progress_cb,
        'project_scan_webapps_listed',
        f"webapps listed={metrics['webappsListed']} objects={webapp_objects}",
        'info',
        project_key,
        elapsed_ms=(time.time() - webapp_step_started) * 1000.0,
    )

    notebook_step_started = time.time()
    notebook_objects = 0
    notebooks: List[Any] = []
    try:
        notebooks = _bench_call('list_project_notebooks', project_obj.list_jupyter_notebooks) or []
    except Exception as exc:
        _notify_progress(progress_cb, 'project_scan_notebooks_error', f"failed to list notebooks: {exc}", 'warn', project_key)
    metrics['notebooksListed'] = len(notebooks)
    for notebook in notebooks:
        if _deadline_reached('project_scan_notebooks_timeout'):
            break
        notebook_name = getattr(notebook, 'notebook_name', None) or getattr(notebook, 'name', None)
        notebook_name = str(notebook_name or '').strip()
        if not notebook_name:
            continue
        payload: Dict[str, Any] = {}
        try:
            content = _bench_call('get_notebook_content_raw', lambda: notebook.get_content().get_raw())
            if isinstance(content, dict):
                metadata = content.get('metadata')
                if isinstance(metadata, dict):
                    payload['metadata'] = metadata
        except Exception:
            pass
        try:
            settings = _bench_call('get_notebook_settings', notebook.get_settings)
            if hasattr(settings, 'get_raw'):
                settings_raw = _bench_call('get_notebook_settings_raw', settings.get_raw)
                if isinstance(settings_raw, dict):
                    payload['settings'] = settings_raw
        except Exception:
            pass
        objects.append({
            'projectKey': project_key,
            'usageType': 'NOTEBOOK',
            'objectType': 'NOTEBOOK',
            'objectId': notebook_name,
            'objectName': notebook_name,
            'payload': payload,
            'source': 'project_object_scan',
        })
        notebook_objects += 1
    metrics['notebookObjects'] = notebook_objects
    _notify_progress(
        progress_cb,
        'project_scan_notebooks_listed',
        f"notebooks listed={metrics['notebooksListed']} objects={notebook_objects}",
        'info',
        project_key,
        elapsed_ms=(time.time() - notebook_step_started) * 1000.0,
    )

    scenario_step_started = time.time()
    scenario_objects = 0
    scenarios: List[Any] = []
    try:
        scenarios = _bench_call('list_project_scenarios', project_obj.list_scenarios) or []
    except Exception as exc:
        _notify_progress(progress_cb, 'project_scan_scenarios_error', f"failed to list scenarios: {exc}", 'warn', project_key)
    metrics['scenariosListed'] = len(scenarios)

    # Bulk-fetch scenario details via REST listing endpoint to avoid per-scenario API calls.
    scenario_details_by_id: Dict[str, Dict[str, Any]] = {}
    try:
        bulk_scenarios = _client_perform_json(_thread_client(), 'GET', f'/projects/{project_key}/scenarios/')
        if isinstance(bulk_scenarios, list):
            for sd in bulk_scenarios:
                if isinstance(sd, dict) and sd.get('id'):
                    scenario_details_by_id[str(sd['id'])] = sd
    except Exception:
        pass

    for scenario_info in scenarios:
        if _deadline_reached('project_scan_scenarios_timeout'):
            break
        scenario_id = scenario_info.get('id')
        if not scenario_id:
            continue

        scenario_type = str(scenario_info.get('type') or '').strip().lower()
        bulk_detail = scenario_details_by_id.get(str(scenario_id))

        # Try bulk data first for custom_python scenarios.
        if scenario_type == 'custom_python' and isinstance(bulk_detail, dict) and bulk_detail:
            objects.append({
                'projectKey': project_key,
                'usageType': 'SCENARIO',
                'objectType': 'SCENARIO',
                'objectId': str(scenario_id),
                'objectName': str(scenario_id),
                'payload': bulk_detail,
                'source': 'project_object_scan',
            })
            scenario_objects += 1
            continue

        # Try bulk data first for step_based scenarios.
        if scenario_type == 'step_based' and isinstance(bulk_detail, dict):
            bulk_params = bulk_detail.get('params') if isinstance(bulk_detail.get('params'), dict) else None
            bulk_steps = bulk_params.get('steps') if isinstance(bulk_params, dict) else None
            if isinstance(bulk_steps, list):
                for idx, step in enumerate(bulk_steps):
                    if not isinstance(step, dict):
                        continue
                    step_type = str(step.get('type') or '').strip().lower()
                    params = step.get('params') if isinstance(step.get('params'), dict) else {}
                    has_env_selection = isinstance(params.get('envSelection'), dict)
                    if step_type != 'custom_python' and not has_env_selection:
                        continue
                    objects.append({
                        'projectKey': project_key,
                        'usageType': 'SCENARIO_STEP',
                        'objectType': f"SCENARIO_STEP_{(step_type or 'unknown').upper()}",
                        'objectId': f"{scenario_id}:step_{idx}",
                        'objectName': f"{scenario_id}:step_{idx}",
                        'payload': step,
                        'source': 'project_object_scan',
                    })
                    scenario_objects += 1
                continue

        # Fallback: per-scenario API calls when bulk data is unavailable.
        try:
            scenario = _bench_call('get_scenario', project_obj.get_scenario, scenario_id)
        except Exception:
            continue

        if scenario_type == 'custom_python':
            try:
                scenario_settings = _bench_call('get_scenario_settings', scenario.get_settings)
                scenario_raw = _bench_call('get_scenario_settings_raw', scenario_settings.get_raw) if hasattr(scenario_settings, 'get_raw') else None
                if isinstance(scenario_raw, dict):
                    objects.append({
                        'projectKey': project_key,
                        'usageType': 'SCENARIO',
                        'objectType': 'SCENARIO',
                        'objectId': str(scenario_id),
                        'objectName': str(scenario_id),
                        'payload': scenario_raw,
                        'source': 'project_object_scan',
                    })
                    scenario_objects += 1
            except Exception:
                pass
        elif scenario_type == 'step_based':
            try:
                settings = _bench_call('get_scenario_settings', scenario.get_settings)
                raw_steps = getattr(settings, 'raw_steps', None)
                if not isinstance(raw_steps, list):
                    raw_steps = []
                for idx, step in enumerate(raw_steps):
                    if not isinstance(step, dict):
                        continue
                    step_type = str(step.get('type') or '').strip().lower()
                    params = step.get('params') if isinstance(step.get('params'), dict) else {}
                    has_env_selection = isinstance(params.get('envSelection'), dict)
                    if step_type != 'custom_python' and not has_env_selection:
                        continue
                    objects.append({
                        'projectKey': project_key,
                        'usageType': 'SCENARIO_STEP',
                        'objectType': f"SCENARIO_STEP_{(step_type or 'unknown').upper()}",
                        'objectId': f"{scenario_id}:step_{idx}",
                        'objectName': f"{scenario_id}:step_{idx}",
                        'payload': step,
                        'source': 'project_object_scan',
                    })
                    scenario_objects += 1
            except Exception:
                pass
    metrics['scenarioObjects'] = scenario_objects
    _notify_progress(
        progress_cb,
        'project_scan_scenarios_listed',
        f"scenarios listed={metrics['scenariosListed']} objects={scenario_objects}",
        'info',
        project_key,
        elapsed_ms=(time.time() - scenario_step_started) * 1000.0,
    )

    # Code Studios count (guarded for older DSS versions)
    code_studios_count = 0
    if hasattr(project_obj, 'list_code_studios'):
        try:
            code_studios = _bench_call('list_code_studios', project_obj.list_code_studios) or []
            code_studios_count = len(code_studios)
        except Exception as exc:
            _notify_progress(progress_cb, 'project_scan_code_studios_error', f"failed to list code studios: {exc}", 'warn', project_key)
    metrics['codeStudiosListed'] = code_studios_count

    metrics['objectsFound'] = len(objects)
    total_elapsed_ms = (time.time() - started) * 1000.0
    _notify_progress(
        progress_cb,
        'project_objects_scan_ok',
        f"project object scan complete objects={metrics['objectsFound']}",
        'info',
        project_key,
        elapsed_ms=total_elapsed_ms,
    )

    return {
        'objects': objects,
        'metrics': metrics,
    }


def _payload_has_inherit_env_mode(payload: Any) -> bool:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(key, str) and key.lower() == 'envmode':
                if isinstance(value, str) and value.strip().upper() == 'INHERIT':
                    return True
            if _payload_has_inherit_env_mode(value):
                return True
        return False
    if isinstance(payload, list):
        for item in payload:
            if _payload_has_inherit_env_mode(item):
                return True
    return False


def _extract_env_references_from_payload(
    payload: Any,
    env_name_to_keys: Dict[str, List[str]],
) -> Dict[str, List[str]]:
    found_keys: set = set()
    found_names: set = set()

    def maybe_register_name(text: str, hinted_name: bool) -> None:
        value = text.strip()
        if not value:
            return
        if '\n' in value or len(value) > 180:
            return

        lowered = value.lower()
        direct = env_name_to_keys.get(lowered)
        if direct:
            found_keys.update(direct)
            return

        # Notebook kernels often encode env names as py-dku-venv-<env_name>.
        if lowered.startswith('py-dku-venv-'):
            candidate = value[len('py-dku-venv-'):]
            if candidate:
                mapped = env_name_to_keys.get(candidate.lower())
                if mapped:
                    found_keys.update(mapped)
                else:
                    found_names.add(candidate)
                return

        # Display names like "Python (env my_env)".
        display_match = re.search(r'env\s+([A-Za-z0-9_.-]+)\)?$', value, flags=re.IGNORECASE)
        if display_match:
            candidate = display_match.group(1)
            mapped = env_name_to_keys.get(candidate.lower())
            if mapped:
                found_keys.update(mapped)
            else:
                found_names.add(candidate)
            return

        tokens = [token for token in re.split(r'[^a-zA-Z0-9_.-]+', value) if token]
        for token in tokens:
            mapped = env_name_to_keys.get(token.lower())
            if mapped:
                found_keys.update(mapped)

        if hinted_name:
            found_names.add(value)

    def walk(node: Any, key_hint: str = '') -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                key_lower = str(key).lower()
                if isinstance(value, str):
                    hinted = (
                        key_lower.endswith('envname')
                        or key_lower == 'envname'
                        or key_lower.endswith('codeenv')
                        or (key_hint.endswith('kernelspec') and key_lower in ('name', 'kernel_name'))
                    )
                    maybe_register_name(value, hinted_name=hinted)
                walk(value, key_lower)
            return
        if isinstance(node, list):
            for item in node:
                walk(item, key_hint)
            return
        if isinstance(node, str):
            maybe_register_name(node, hinted_name=False)

    walk(payload)
    return {
        'keys': sorted(found_keys),
        'names': sorted(found_names),
    }


def _collect_project_code_env_usage(
    client: Any,
    project_info: Dict[str, Dict[str, str]],
    size_by_env: Dict[str, int],
    include_project_object_scan: bool = True,
    include_code_env_usage_api: bool = True,
    deadline_ts: Optional[float] = None,
    progress_cb: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    envs_by_project: Dict[str, set] = {k: set() for k in project_info.keys()}
    usage_breakdown_by_project: Dict[str, Dict[str, int]] = {k: {} for k in project_info.keys()}
    usage_details_by_project: Dict[str, List[Dict[str, Any]]] = {k: [] for k in project_info.keys()}
    env_meta_by_key: Dict[str, Dict[str, Any]] = {}
    env_name_to_keys: Dict[str, List[str]] = {}
    deadline_warned = False

    def _deadline_reached() -> bool:
        nonlocal deadline_warned
        if deadline_ts is None:
            return False
        now = time.time()
        if now < deadline_ts:
            if not deadline_warned and (deadline_ts - now) <= 10.0:
                deadline_warned = True
                _notify_progress(progress_cb, 'deadline_pressure', 'deadline is under 10 seconds during code env usage collection', 'warn')
            return False
        return True

    def _remaining_seconds() -> Optional[float]:
        if deadline_ts is None:
            return None
        return max(0.0, deadline_ts - time.time())

    _notify_progress(
        progress_cb,
        'collect_project_code_env_usage_start',
        f"start projects={len(project_info)} includeProjectScan={include_project_object_scan} includeCodeEnvUsageApi={include_code_env_usage_api}",
    )
    envs = [env for env in (_bench_call('list_code_envs', client.list_code_envs) or []) if isinstance(env, dict)]
    env_payloads: List[Dict[str, Any]] = []
    catalog_rows: List[Dict[str, Any]] = []

    if include_code_env_usage_api:
        env_workers = min(_parallel_workers(8), len(envs))
        _notify_progress(progress_cb, 'code_env_usage_api_pool_start', f"code env usage API scan started envs={len(envs)} workers={env_workers}")
        if env_workers <= 1:
            for env in envs:
                if _deadline_reached():
                    _notify_progress(progress_cb, 'code_env_usage_api_timeout', 'deadline reached during serial code env usage API scan', 'warn')
                    break
                payload = _load_code_env_usage_payload(env, project_info, size_by_env)
                if payload:
                    env_payloads.append(payload)
        else:
            with ThreadPoolExecutor(max_workers=env_workers) as pool:
                future_to_env: Dict[Any, Dict[str, Any]] = {}
                for env in envs:
                    if _deadline_reached():
                        _notify_progress(progress_cb, 'code_env_usage_api_timeout', 'deadline reached while submitting env usage jobs', 'warn')
                        break
                    future = pool.submit(_load_code_env_usage_payload, env, project_info, size_by_env)
                    future_to_env[future] = env

                timed_out = False
                if future_to_env:
                    try:
                        for future in as_completed(list(future_to_env.keys()), timeout=_remaining_seconds()):
                            if _deadline_reached():
                                timed_out = True
                                _notify_progress(progress_cb, 'code_env_usage_api_timeout', 'deadline reached while collecting env usage futures', 'warn')
                                break
                            try:
                                payload = future.result()
                            except Exception as exc:
                                _notify_progress(progress_cb, 'code_env_usage_api_error', f"env usage future failed: {exc}", 'warn')
                                payload = None
                            if payload:
                                env_payloads.append(payload)
                    except FuturesTimeoutError:
                        timed_out = True
                        _notify_progress(progress_cb, 'code_env_usage_api_timeout', 'deadline reached while waiting for env usage futures', 'warn')

                if timed_out or _deadline_reached():
                    for future in future_to_env.keys():
                        if future.done():
                            continue
                        future.cancel()
                    _notify_progress(progress_cb, 'code_env_usage_api_cancelled', 'cancelled pending env usage futures on deadline', 'warn')
        _notify_progress(progress_cb, 'code_env_usage_api_pool_done', f"code env usage API scan done payloads={len(env_payloads)}")
    else:
        for env in envs:
            if _deadline_reached():
                _notify_progress(progress_cb, 'code_env_catalog_timeout', 'deadline reached during code env catalog pass', 'warn')
                break
            payload = _load_code_env_catalog_entry(env, size_by_env)
            if payload:
                catalog_rows.append(payload)
        _notify_progress(progress_cb, 'code_env_catalog_done', f"code env catalog pass done rows={len(catalog_rows)}")

    source_rows = env_payloads if include_code_env_usage_api else catalog_rows
    for payload in source_rows:
        env_key = str(payload.get('envKey') or '')
        env_name = str(payload.get('name') or '')
        if not env_key or not env_name:
            continue
        env_meta_by_key[env_key] = {
            'key': env_key,
            'name': env_name,
            'language': str(payload.get('language') or 'python'),
            'owner': str(payload.get('owner') or 'Unknown'),
            'sizeBytes': _coerce_int(payload.get('sizeBytes'), 0),
            'pythonVersion': str(payload.get('pythonVersion') or ''),
            'deploymentMode': str(payload.get('deploymentMode') or ''),
            'usageSummary': {},
            'usageDetails': [],
            'projectKeys': set(),
        }
        env_name_to_keys.setdefault(env_name.lower(), []).append(env_key)

    def ensure_env_meta_for_name(env_name: str, language: str = 'python') -> str:
        clean_name = str(env_name or '').strip()
        if not clean_name:
            return ''
        env_key = f"{language}:{clean_name}"
        if env_key not in env_meta_by_key:
            env_meta_by_key[env_key] = {
                'key': env_key,
                'name': clean_name,
                'language': language,
                'owner': 'Unknown',
                'sizeBytes': _coerce_int(size_by_env.get(env_key), 0),
                'usageSummary': {},
                'usageDetails': [],
                'projectKeys': set(),
            }
            env_name_to_keys.setdefault(clean_name.lower(), []).append(env_key)
        return env_key

    def add_usage(
        project_key: str,
        env_key: str,
        usage_type: str,
        object_type: str,
        object_id: str,
        object_name: str,
        source: str,
    ) -> None:
        if project_key not in envs_by_project:
            return
        env_meta = env_meta_by_key.get(env_key)
        if not env_meta:
            return

        usage_type = str(usage_type or 'UNKNOWN').upper()
        object_type = str(object_type or usage_type or 'UNKNOWN').upper()
        object_id = str(object_id or '')
        object_name = str(object_name or object_id or object_type)
        env_name = str(env_meta.get('name') or '')
        env_lang = str(env_meta.get('language') or '')
        env_owner = str(env_meta.get('owner') or 'Unknown')

        usage = {
            'projectKey': project_key,
            'projectName': project_info.get(project_key, {}).get('name', project_key),
            'usageType': usage_type,
            'objectType': object_type,
            'objectId': object_id,
            'objectName': object_name,
            'codeEnvKey': env_key,
            'codeEnvName': env_name,
            'codeEnvLanguage': env_lang,
            'codeEnvOwner': env_owner,
            'source': source,
        }

        envs_by_project[project_key].add(env_key)
        usage_counts = usage_breakdown_by_project[project_key]
        usage_counts[usage_type] = usage_counts.get(usage_type, 0) + 1
        usage_details_by_project[project_key].append(usage)

        env_usage_counts = env_meta['usageSummary']
        env_usage_counts[usage_type] = env_usage_counts.get(usage_type, 0) + 1
        env_meta['usageDetails'].append(usage)
        env_meta['projectKeys'].add(project_key)

    # First pass: DSS code-env usage API (covers objects like Visual ML when available).
    for payload in env_payloads:
        if _deadline_reached():
            break
        env_key = str(payload.get('envKey') or '')
        if not env_key:
            continue
        usages = payload.get('usages')
        if not isinstance(usages, list):
            continue
        for normalized in usages:
            project_key = str(normalized.get('projectKey') or '')
            if not project_key or project_key not in project_info:
                continue
            add_usage(
                project_key=project_key,
                env_key=env_key,
                usage_type=str(normalized.get('usageType') or 'UNKNOWN'),
                object_type=str(normalized.get('objectType') or normalized.get('usageType') or 'UNKNOWN'),
                object_id=str(normalized.get('objectId') or ''),
                object_name=str(normalized.get('objectName') or normalized.get('objectId') or ''),
                source='code_env_usage_api',
            )

    # Second pass: direct per-project object scan (exhaustive but expensive).
    code_studio_count_by_project: Dict[str, int] = {}
    if include_project_object_scan:
        def _scan_project_objects(project_key: str) -> Dict[str, Any]:
            local_client = _thread_client()
            _notify_progress(progress_cb, 'project_scan_start', 'project scan started', 'info', project_key)
            try:
                project_obj = _bench_call('get_project', local_client.get_project, project_key)
            except Exception as exc:
                _notify_progress(progress_cb, 'project_scan_error', f"failed to get project handle: {exc}", 'warn', project_key)
                return {'projectKey': project_key, 'objects': [], 'metrics': {}}
            scan_payload = _collect_project_python_objects(
                project_obj,
                project_key,
                progress_cb=progress_cb,
                deadline_ts=deadline_ts,
            )
            objects = scan_payload.get('objects') if isinstance(scan_payload, dict) else []
            metrics = scan_payload.get('metrics') if isinstance(scan_payload, dict) else {}
            if not isinstance(objects, list):
                objects = []
            if not isinstance(metrics, dict):
                metrics = {}
            return {'projectKey': project_key, 'objects': objects, 'metrics': metrics}

        project_keys = list(project_info.keys())
        scan_results: List[Dict[str, Any]] = []
        scan_workers = min(_parallel_workers(8), len(project_keys))
        _notify_progress(
            progress_cb,
            'project_scan_pool_start',
            f"project object scan pool started projects={len(project_keys)} workers={scan_workers}",
        )
        if scan_workers <= 1:
            for project_key in project_keys:
                if _deadline_reached():
                    _notify_progress(progress_cb, 'project_scan_timeout', 'deadline reached during serial project scanning', 'warn')
                    break
                scan_results.append(_scan_project_objects(project_key))
        else:
            with ThreadPoolExecutor(max_workers=scan_workers) as pool:
                future_to_project: Dict[Any, str] = {}
                for project_key in project_keys:
                    if _deadline_reached():
                        _notify_progress(progress_cb, 'project_scan_timeout', 'deadline reached while submitting project scan jobs', 'warn')
                        break
                    future = pool.submit(_scan_project_objects, project_key)
                    future_to_project[future] = project_key

                timed_out = False
                if future_to_project:
                    try:
                        for future in as_completed(list(future_to_project.keys()), timeout=_remaining_seconds()):
                            if _deadline_reached():
                                timed_out = True
                                _notify_progress(progress_cb, 'project_scan_timeout', 'deadline reached while collecting project scan futures', 'warn')
                                break
                            try:
                                scan_results.append(future.result())
                            except Exception as exc:
                                _notify_progress(progress_cb, 'project_scan_error', f"project scan future failed: {exc}", 'warn')
                                continue
                    except FuturesTimeoutError:
                        timed_out = True
                        _notify_progress(progress_cb, 'project_scan_timeout', 'deadline reached while waiting for project scan futures', 'warn')

                if timed_out or _deadline_reached():
                    for future, project_key in future_to_project.items():
                        if future.done():
                            continue
                        future.cancel()
                        _notify_progress(progress_cb, 'project_scan_timeout', 'project scan future cancelled on deadline', 'warn', project_key)

        for scan_result in scan_results:
            if _deadline_reached():
                _notify_progress(progress_cb, 'project_scan_timeout', 'deadline reached while merging project scan results', 'warn')
                break
            project_key = str(scan_result.get('projectKey') or '')
            if not project_key:
                continue
            objects = scan_result.get('objects')
            if not isinstance(objects, list):
                objects = []
            metrics = scan_result.get('metrics')
            if not isinstance(metrics, dict):
                metrics = {}

            code_studio_count_by_project[project_key] = _coerce_int(metrics.get('codeStudiosListed'), 0)

            app.logger.debug("[project-scan] %s python objects=%s", project_key, len(objects))
            _notify_progress(
                progress_cb,
                'project_objects_scan_summary',
                (
                    "scan summary "
                    f"recipes={metrics.get('recipesListed', 0)} "
                    f"webapps={metrics.get('webappsListed', 0)} "
                    f"notebooks={metrics.get('notebooksListed', 0)} "
                    f"scenarios={metrics.get('scenariosListed', 0)} "
                    f"codeStudios={metrics.get('codeStudiosListed', 0)} "
                    f"objects={metrics.get('objectsFound', len(objects))}"
                ),
                'info',
                project_key,
            )
            resolved_env_refs = 0
            for obj in objects:
                payload = obj.get('payload')
                env_refs = _extract_env_references_from_payload(payload, env_name_to_keys)
                env_keys = list(env_refs.get('keys') or [])
                for unresolved_name in env_refs.get('names') or []:
                    dynamic_key = ensure_env_meta_for_name(unresolved_name, 'python')
                    if dynamic_key:
                        env_keys.append(dynamic_key)
                env_keys = sorted(set(env_keys))
                if not env_keys and _payload_has_inherit_env_mode(payload):
                    default_env_name = str(project_info.get(project_key, {}).get('defaultPythonEnv') or '').strip()
                    if default_env_name:
                        mapped_keys = env_name_to_keys.get(default_env_name.lower(), [])
                        if mapped_keys:
                            env_keys = sorted(set(mapped_keys))
                        else:
                            fallback_key = ensure_env_meta_for_name(default_env_name, 'python')
                            env_keys = [fallback_key] if fallback_key else []
                resolved_env_refs += len(env_keys)
                for env_key in env_keys:
                    add_usage(
                        project_key=project_key,
                        env_key=env_key,
                        usage_type=str(obj.get('usageType') or 'UNKNOWN'),
                        object_type=str(obj.get('objectType') or obj.get('usageType') or 'UNKNOWN'),
                        object_id=str(obj.get('objectId') or ''),
                        object_name=str(obj.get('objectName') or obj.get('objectId') or ''),
                        source=str(obj.get('source') or 'project_object_scan'),
                    )
            app.logger.debug(
                "[project-scan] %s resolved_code_envs=%s",
                project_key,
                len(envs_by_project.get(project_key) or []),
            )
            _notify_progress(
                progress_cb,
                'project_env_refs_resolved',
                f"resolved env refs={resolved_env_refs} code envs={len(envs_by_project.get(project_key) or [])}",
                'info',
                project_key,
            )
        _notify_progress(progress_cb, 'project_scan_pool_done', f"project object scan pool done results={len(scan_results)}")

    for project_key, usages in usage_details_by_project.items():
        usage_details_by_project[project_key] = _dedupe_usage_entries(usages)

    for env_key, env_meta in env_meta_by_key.items():
        deduped = _dedupe_usage_entries(env_meta.get('usageDetails') or [])
        env_meta['usageDetails'] = deduped
        env_meta['usageCount'] = len(deduped)
        env_meta['projectKeys'] = sorted(set(env_meta.get('projectKeys') or []))
        env_meta['projectCount'] = len(env_meta['projectKeys'])
        env_meta['usageSummary'] = dict(env_meta.get('usageSummary') or {})

    _notify_progress(
        progress_cb,
        'collect_project_code_env_usage_done',
        f"usage collection done projects={len(envs_by_project)} envMeta={len(env_meta_by_key)}",
    )
    return {
        'envsByProject': envs_by_project,
        'usageBreakdownByProject': usage_breakdown_by_project,
        'usageDetailsByProject': usage_details_by_project,
        'envMetaByKey': env_meta_by_key,
        'codeStudioCountByProject': code_studio_count_by_project,
    }


def _build_footprint_node(name: str, path: str, footprint: Any, depth: int, max_depth: int) -> Dict[str, Any]:
    details = _footprint_details_map(footprint)
    children: List[Dict[str, Any]] = []
    has_hidden = False
    if depth < max_depth:
        for child_name, child_footprint in details.items():
            clean_name = str(child_name).strip('/') or str(child_name)
            child_path = f"{path.rstrip('/')}/{clean_name}" if path != '/' else f"/{clean_name}"
            child = _build_footprint_node(clean_name, child_path, child_footprint, depth + 1, max_depth)
            children.append(child)
    elif details:
        has_hidden = True

    children.sort(key=lambda c: c.get('size', 0), reverse=True)

    size = _coerce_int(_footprint_attr(footprint, 'size', 'totalSize', 'bytes'), 0)
    file_count = _coerce_int(_footprint_attr(footprint, 'nb_files', 'nbFiles', 'fileCount'), 0)

    if size <= 0 and children:
        size = sum(child['size'] for child in children)
    if file_count <= 0 and children:
        file_count = sum(child['fileCount'] for child in children)

    own_size = max(0, size - sum(child['size'] for child in children))
    locations_raw = _footprint_attr(footprint, 'locations')
    locations: List[str] = []
    if isinstance(locations_raw, list):
        locations = [str(loc) for loc in locations_raw if loc is not None and str(loc).strip()]
    elif isinstance(locations_raw, str) and locations_raw.strip():
        locations = [locations_raw.strip()]

    if not children and not details:
        file_count = max(file_count, 1)
    if not children and locations:
        # Some DSS footprint leaves only expose "locations". We mark them expandable
        # and lazily expand through filesystem views on demand.
        has_hidden = True

    return {
        'name': name,
        'path': path,
        'size': size,
        'ownSize': own_size,
        'isDirectory': True,
        'children': children,
        'fileCount': file_count,
        'depth': depth,
        'hasHiddenChildren': has_hidden,
        'locations': locations,
    }


def _find_footprint_subtree(
    root_footprint: Any,
    root_path: str,
    target_path: str,
) -> Optional[Tuple[str, str, Any]]:
    """Locate target subtree using only Dataiku footprint details."""
    abs_root = os.path.abspath(str(root_path or '/'))
    abs_target = os.path.abspath(str(target_path or abs_root))
    if abs_target == abs_root:
        return (str(os.path.basename(abs_root) or abs_root or '/'), abs_root, root_footprint)
    root_prefix = abs_root.rstrip('/') + '/'
    if not abs_target.startswith(root_prefix):
        return None

    rel = abs_target[len(root_prefix):]
    parts = [part for part in rel.split('/') if part]
    current = root_footprint
    current_path = abs_root
    current_name = str(os.path.basename(abs_root) or abs_root or '/')

    for part in parts:
        details = _footprint_details_map(current)
        if not details:
            return None
        next_footprint = details.get(part)
        if next_footprint is None:
            # Be tolerant to slash formatting differences.
            for key, value in details.items():
                if str(key).strip('/') == part:
                    next_footprint = value
                    break
        if next_footprint is None:
            return None
        current = next_footprint
        current_name = part
        current_path = f"{current_path.rstrip('/')}/{part}" if current_path != '/' else f"/{part}"

    return (current_name, current_path, current)


def _ensure_license_fallback(payload: Dict[str, Any], dip_home: str) -> Dict[str, Any]:
    properties = payload.get('licenseProperties') or {}
    if properties:
        return payload

    fallback = {
        'License Source': 'Unavailable from webapp context',
        'DIP_HOME': dip_home,
        'Resolution': 'Use ZIP diagnostics or grant webapp backend read access to config/license.json',
    }
    payload['licenseProperties'] = fallback
    payload['hasLicenseUsage'] = False
    return payload


def _build_dir_tree_from_footprint(
    client: Any,
    dip_home: str,
    max_depth: int,
    target_path: Optional[str] = None,
    scope: str = 'dss',
    project_key: Optional[str] = None,
) -> Dict[str, Any]:
    scope = scope if scope in ('dss', 'project') else 'dss'
    footprint_scope = 'all-dss' if scope == 'dss' else scope
    root_footprint = _compute_footprint_payload(client, footprint_scope, project_key)
    root_meta = _scope_root(scope, project_key)
    root_path = root_meta['path']

    if not root_footprint:
        app.logger.warning("[dir-tree] footprint payload unavailable scope=%s project=%s", scope, project_key)
        if target_path:
            return {'node': None}
        return {
            'root': None,
            'totalSize': 0,
            'totalFiles': 0,
            'rootPath': root_path,
            'scope': scope,
            'projectKey': project_key,
        }

    if target_path:
        subtree = _find_footprint_subtree(root_footprint, root_path, target_path)
        if subtree is None:
            return {'node': None}
        node_name, node_path, node_footprint = subtree
        node = _build_footprint_node(node_name, node_path, node_footprint, 0, max_depth)
        return {'node': node}

    root_node = _build_footprint_node(root_meta['name'], root_path, root_footprint, 0, max_depth)
    return {
        'root': root_node,
        'totalSize': root_node['size'],
        'totalFiles': root_node['fileCount'],
        'rootPath': root_node['path'],
        'scope': scope,
        'projectKey': project_key,
    }


@app.route('/api/mode')
def api_mode():
    return jsonify({'mode': 'live'})


@app.route('/api/settings/raw')
def api_settings_raw():
    client = dataiku.api_client()
    settings = client.get_general_settings().get_raw()
    return jsonify(settings)


@app.route('/api/overview')
def api_overview():
    client = dataiku.api_client()
    dip_home = _dip_home()

    def loader():
        free_output = _run_command(['free', '-m'])
        ulimit_output = _run_command(['bash', '-lc', 'ulimit -a'])
        df_output = _run_command(['df', '-h'])

        version_info = _safe_read_json(os.path.join(dip_home, 'dss-version.json')) or {}
        install_ini = _safe_read_text(os.path.join(dip_home, 'install.ini'))
        instance_info: Dict[str, Any] = {}
        if install_ini:
            current_section = None
            for line in install_ini.split('\n'):
                line = line.strip()
                if line.startswith('[') and line.endswith(']'):
                    current_section = line[1:-1].lower()
                    continue
                if current_section == 'general' and '=' in line:
                    key, value = [part.strip() for part in line.split('=', 1)]
                    if key.lower() == 'nodeid':
                        instance_info['nodeId'] = value
                    elif key.lower() == 'installid':
                        instance_info['installId'] = value
                    elif key.lower() == 'instanceurl':
                        instance_info['instanceUrl'] = value

        supervisord_log = None
        try:
            supervisord_log = client.get_log('supervisord.log')
        except Exception:
            supervisord_log = _safe_read_text(os.path.join(dip_home, 'run', 'supervisord.log'))

        settings = None
        try:
            settings = client.get_general_settings().get_raw()
        except Exception:
            settings = None

        spark_version = _find_spark_version(settings)

        return {
            'cpuCores': _get_cpu_cores(),
            'osInfo': _get_os_info(),
            'memoryInfo': _parse_memory_info(free_output),
            'systemLimits': _parse_system_limits(ulimit_output),
            'filesystemInfo': _parse_filesystem_info(df_output),
            'pythonVersion': platform.python_version(),
            'sparkVersion': spark_version,
            'lastRestartTime': _parse_supervisord_restart(supervisord_log),
            'dssVersion': version_info.get('version') or version_info.get('dssVersion'),
            'instanceInfo': instance_info,
        }

    data = _cache_get('overview', 300, loader)
    return jsonify(data)


@app.route('/api/connections')
def api_connections():
    client = dataiku.api_client()

    def loader():
        connections = client.list_connections()
        connection_counts: Dict[str, int] = {}
        details: List[Dict[str, Any]] = []

        if isinstance(connections, dict):
            items = connections.items()
        else:
            items = [(c.get('name') or c.get('id') or c.get('connectionName'), c) for c in connections]

        for name, config in items:
            if not isinstance(config, dict):
                continue
            conn_type = config.get('type') or config.get('connectionType')
            if conn_type == 'EC2':
                conn_type = 'S3'
            if not conn_type:
                continue
            driver = None
            params = config.get('params') or {}
            if isinstance(params, dict):
                driver = params.get('driverClassName')

            display_type = conn_type
            if conn_type == 'JDBC' and driver:
                short_driver = driver if len(driver) <= 50 else driver[:47] + '...'
                display_type = f"JDBC ({short_driver})"

            details.append({
                'name': name or 'unknown',
                'type': conn_type,
                'driverClassName': driver,
            })

            connection_counts[display_type] = connection_counts.get(display_type, 0) + 1

        return {'connections': connection_counts, 'connectionDetails': details}

    data = _cache_get('connections', 300, loader)
    return jsonify(data)


@app.route('/api/users')
def api_users():
    client = dataiku.api_client()

    def loader():
        users = client.list_users()
        groups = client.list_groups()

        enabled_users = [u for u in users if u.get('enabled') is True]
        user_stats: Dict[str, Any] = {
            'Total Users': len(users),
            'Enabled Users': len(enabled_users),
        }

        profile_counts: Dict[str, int] = {}
        for user in enabled_users:
            profile = user.get('userProfile')
            if profile:
                profile_counts[profile] = profile_counts.get(profile, 0) + 1
        user_stats.update(profile_counts)

        if groups:
            user_stats['Total Groups'] = len(groups)

        return {
            'userStats': user_stats,
            'users': [
                {
                    'login': u.get('login') or '',
                    'email': u.get('email'),
                    'enabled': u.get('enabled'),
                    'userProfile': u.get('userProfile'),
                }
                for u in users
            ],
        }

    data = _cache_get('users', 300, loader)
    return jsonify(data)


@app.route('/api/license')
def api_license():
    client = dataiku.api_client()
    dip_home = _dip_home()

    def loader():
        license_data = _safe_read_json(os.path.join(dip_home, 'config', 'license.json'))
        source = 'file'
        if not license_data:
            license_data = _read_license_via_client_api(client)
            source = 'api'
        parsed = _parse_license(license_data)
        parsed['licenseSource'] = source if license_data else 'none'
        return _ensure_license_fallback(parsed, dip_home)

    data = _cache_get('license', 600, loader)
    return jsonify(data)


@app.route('/api/java-memory')
def api_java_memory():
    dip_home = _dip_home()
    content = _safe_read_text(os.path.join(dip_home, 'bin', 'env-default.sh')) or ''
    return content


@app.route('/api/projects')
def api_projects():
    client = dataiku.api_client()

    def loader():
        started = time.time()
        projects = []
        raw_projects = client.list_projects() or []
        total = len(raw_projects)
        app.logger.info("[projects] start total=%s", total)
        for idx, project in enumerate(raw_projects, 1):
            key = project.get('projectKey') or project.get('key') or project.get('id')
            name = project.get('name') or key
            owner = project.get('ownerLogin') or project.get('owner') or project.get('ownerName') or 'Unknown'

            settings: Dict[str, Any] = {}
            summary: Dict[str, Any] = {}
            perms_raw: Any = None

            try:
                project_obj = client.get_project(key)
            except Exception:
                project_obj = None

            if project_obj is not None:
                try:
                    raw_settings = project_obj.get_settings().get_raw()
                    if isinstance(raw_settings, dict):
                        settings = raw_settings
                except Exception as exc:
                    app.logger.warning("[projects] %s settings fetch failed: %s", key, exc)
                try:
                    raw_summary = project_obj.get_summary()
                    if isinstance(raw_summary, dict):
                        summary = raw_summary
                except Exception as exc:
                    app.logger.warning("[projects] %s summary fetch failed: %s", key, exc)
                try:
                    perms_raw = project_obj.get_permissions()
                except Exception as exc:
                    app.logger.warning("[projects] %s permissions fetch failed: %s", key, exc)

            name_override = _extract_nested_text(
                summary,
                'name',
            ) or _extract_nested_text(
                settings,
                'name',
                'settings.name',
                'settings.dkuProperties.name',
                'dkuProperties.name',
            )
            if name_override:
                name = name_override

            owner_override = _extract_nested_text(
                summary,
                'ownerLogin',
                'owner',
                'ownerName',
            ) or _extract_nested_text(
                settings,
                'owner',
                'settings.owner',
                'settings.dkuProperties.owner',
                'dkuProperties.owner',
            )
            if owner_override:
                owner = owner_override

            version_number = _extract_project_version_number(project if isinstance(project, dict) else {}, summary, settings)
            permissions = _normalize_project_permissions(perms_raw)

            if key == 'PYTHONAUDIT_TEST' or (version_number == 0 and len(permissions) == 0):
                perms_raw_type = type(perms_raw).__name__ if perms_raw is not None else 'NoneType'
                perms_raw_keys = []
                if isinstance(perms_raw, dict):
                    perms_raw_keys = sorted(list(perms_raw.keys()))
                app.logger.info(
                    "[projects] %s version=%s perms=%s listingVersion=%s summaryVersion=%s permsRawType=%s permsRawKeys=%s",
                    key,
                    version_number,
                    len(permissions),
                    _extract_nested_int(project if isinstance(project, dict) else {}, 'versionTag.versionNumber'),
                    _extract_nested_int(summary, 'versionTag.versionNumber'),
                    perms_raw_type,
                    perms_raw_keys,
                )

            projects.append({
                'key': key,
                'name': name.replace('_', ' ') if isinstance(name, str) else key,
                'owner': owner,
                'permissions': permissions,
                'versionNumber': version_number,
            })
            if idx % 50 == 0:
                app.logger.info(
                    "[projects] progress=%s/%s elapsed=%.2fs",
                    idx,
                    total,
                    time.time() - started,
                )

        app.logger.info("[projects] done count=%s elapsed=%.2fs", len(projects), time.time() - started)
        return {'projects': projects}

    data = _cache_get('projects', 300, loader)
    return jsonify(data)


@app.route('/api/code-envs')
def api_code_envs():
    client = dataiku.api_client()

    def loader():
        timeout_ms = 600000
        started = time.time()
        deadline = started + (timeout_ms / 1000.0)
        project_limit = 0
        project_selection = 'all_by_project_key'
        limit_label = 'all' if project_limit <= 0 else str(project_limit)
        code_envs = []
        python_counts: Dict[str, int] = {}
        r_counts: Dict[str, int] = {}
        size_by_env: Dict[str, int] = {}
        project_info: Dict[str, Dict[str, str]] = {}
        steps: List[Dict[str, Any]] = []
        op_stats: Dict[str, Dict[str, Any]] = {}
        events: List[Dict[str, Any]] = []
        timed_out = False
        timeout_at_step: Optional[str] = None
        deadline_pressure_steps: set = set()
        timeout_event_steps: set = set()
        progress_run_id = _start_progress('code_envs')
        selected_project_count = 0
        usage_completed_projects: set = set()
        env_detail_total = 0
        env_detail_done = 0
        catalog_done = False
        size_map_done = False
        timed_out_or_error = False

        def elapsed_ms() -> float:
            return (time.time() - started) * 1000.0

        def remaining_ms() -> int:
            return max(0, int((deadline - time.time()) * 1000.0))

        def remaining_seconds() -> float:
            return max(0.0, deadline - time.time())

        def _compute_progress_pct(force_done: bool = False) -> int:
            if force_done:
                return 100
            usage_total = max(0, int(selected_project_count))
            usage_ratio = min(1.0, float(len(usage_completed_projects)) / float(usage_total)) if usage_total > 0 else 1.0
            detail_total = max(0, int(env_detail_total))
            detail_ratio = min(1.0, float(env_detail_done) / float(detail_total)) if detail_total > 0 else 0.0
            pct = 0.0
            pct += 10.0 if catalog_done else 0.0
            pct += 55.0 if size_map_done else 0.0
            pct += 20.0 * usage_ratio
            pct += 15.0 * detail_ratio
            if timed_out_or_error:
                return int(max(0.0, min(100.0, pct)))
            return int(max(0.0, min(99.0, pct)))

        def _infer_phase() -> str:
            if not catalog_done:
                return 'catalog'
            if not size_map_done:
                return 'size_map'
            if selected_project_count > 0 and len(usage_completed_projects) < selected_project_count:
                return 'usage_scan'
            if env_detail_total > 0 and env_detail_done < env_detail_total:
                return 'env_details'
            return 'finalizing'

        def _update_progress_summary(force_done: bool = False) -> None:
            _set_progress_summary(
                'code_envs',
                progress_run_id,
                {
                    'progressPct': _compute_progress_pct(force_done),
                    'phase': _infer_phase() if not force_done else 'done',
                    'selectedProjects': int(selected_project_count),
                    'projectUsageDone': int(len(usage_completed_projects)),
                    'envDetailsTotal': int(env_detail_total),
                    'envDetailsDone': int(env_detail_done),
                    'timedOut': bool(timed_out),
                    'timeoutAtStep': timeout_at_step,
                    'totalElapsedMs': round(elapsed_ms(), 2),
                    'remainingMs': remaining_ms(),
                },
            )

        def add_event(
            step: str,
            message: str,
            level: str = 'info',
            project_key: Optional[str] = None,
            event_elapsed_ms: Optional[float] = None,
        ) -> None:
            nonlocal env_detail_done
            event: Dict[str, Any] = {
                'tMs': round(elapsed_ms(), 2),
                'level': level,
                'step': step,
                'message': message,
            }
            if project_key:
                event['projectKey'] = project_key
            if event_elapsed_ms is not None:
                event['elapsedMs'] = round(max(0.0, float(event_elapsed_ms)), 2)
            events.append(event)
            _append_progress_event('code_envs', progress_run_id, event)
            if step == 'project_env_refs_resolved' and project_key:
                usage_completed_projects.add(project_key)
            if step in ('code_env_detail_ok', 'code_env_detail_error', 'code_env_detail_timeout'):
                env_detail_done += 1
            _update_progress_summary(False)

        def progress_event(**kwargs) -> None:
            add_event(
                step=str(kwargs.get('step') or 'event'),
                message=str(kwargs.get('message') or ''),
                level=str(kwargs.get('level') or 'info'),
                project_key=kwargs.get('project_key'),
                event_elapsed_ms=kwargs.get('elapsed_ms'),
            )

        def deadline_reached(step_name: str) -> bool:
            nonlocal timed_out, timeout_at_step, timed_out_or_error
            now = time.time()
            if now < deadline:
                if step_name not in deadline_pressure_steps and (deadline - now) <= 10.0:
                    deadline_pressure_steps.add(step_name)
                    add_event(step_name, f"deadline pressure: only {remaining_ms()}ms remaining", 'warn')
                return False
            timed_out = True
            timed_out_or_error = True
            if timeout_at_step is None:
                timeout_at_step = step_name
            if step_name not in timeout_event_steps:
                timeout_event_steps.add(step_name)
                add_event(step_name, f"deadline reached at step={step_name}", 'warn')
            return True

        def record_step(name: str, step_start: float, calls: int = 0) -> None:
            elapsed = max(0.0, (time.time() - step_start) * 1000.0)
            avg_ms = (elapsed / calls) if calls > 0 else 0.0
            qps = (calls / (elapsed / 1000.0)) if calls > 0 and elapsed > 0 else 0.0
            steps.append({
                'name': name,
                'calls': int(calls),
                'elapsedMs': round(elapsed, 2),
                'avgMs': round(avg_ms, 2),
                'qps': round(qps, 2),
            })
            add_event(name, f"{name} done calls={calls}", 'info', event_elapsed_ms=elapsed)

        def record_op(name: str, elapsed_ms_value: float, calls: int = 1) -> None:
            entry = op_stats.setdefault(name, {'operation': name, 'calls': 0, 'elapsedMs': 0.0})
            entry['calls'] = int(entry.get('calls') or 0) + int(max(0, calls))
            entry['elapsedMs'] = float(entry.get('elapsedMs') or 0.0) + max(0.0, float(elapsed_ms_value))

        def env_key_from_listing(env: Dict[str, Any]) -> str:
            env_name = env.get('envName') or env.get('name') or env.get('id')
            env_lang_raw = env.get('envLang') or env.get('language') or env.get('type') or 'PYTHON'
            language = _normalize_language(env_lang_raw)
            return f"{language}:{env_name}" if env_name else 'unknown'

        previous_recorder = getattr(_THREAD_LOCAL, 'bench_record_op', None)
        setattr(_THREAD_LOCAL, 'bench_record_op', record_op)
        add_event('code_envs_start', f"code env analysis started timeoutMs={timeout_ms} limit={limit_label}")

        try:
            if deadline_reached('load_project_catalog'):
                project_catalog = []
            else:
                step_started = time.time()
                add_event('load_project_catalog', 'loading project catalog')
                project_catalog = _list_projects_catalog(client)
                record_step('load_project_catalog', step_started, calls=1)
            catalog_done = True
            _update_progress_summary(False)

            selected_catalog: List[Dict[str, str]] = []
            if not deadline_reached('select_projects_by_key'):
                step_started = time.time()
                add_event('select_projects_by_key', f"selecting projects by key limit={limit_label}")
                selected_catalog = project_catalog[:] if project_limit <= 0 else project_catalog[:project_limit]
                record_step('select_projects_by_key', step_started, calls=len(selected_catalog))
                selected_project_count = len(selected_catalog)
                _update_progress_summary(False)

            for project in selected_catalog:
                key = str(project.get('key') or '').strip()
                if not key:
                    continue
                project_info[key] = {
                    'name': str(project.get('name') or key),
                    'owner': str(project.get('owner') or 'Unknown'),
                }
            app.logger.info(
                "[code-envs] projectInfo selected=%s total=%s limit=%s elapsed=%.2fs",
                len(project_info),
                len(project_catalog),
                limit_label,
                time.time() - started,
            )
            add_event(
                'project_scope_ready',
                f"project scope ready selected={len(project_info)} total={len(project_catalog)} limit={limit_label}",
            )

            # Launch footprint computation in background so project scan can run concurrently.
            # The project scan does not depend on size_by_env; it only needs it for sizeBytes
            # decoration which happens later in _load_code_env_full_details.
            footprint_future = None
            footprint_step_started = time.time()
            if not deadline_reached('load_code_env_size_map'):
                add_event('load_code_env_size_map', 'loading global code env size map')

                def _bg_compute_global_footprint():
                    return _compute_footprint_payload(_thread_client(), 'global', None)

                footprint_pool = ThreadPoolExecutor(max_workers=1)
                footprint_future = footprint_pool.submit(_bg_compute_global_footprint)

            usage_data: Dict[str, Any] = {}
            if project_info and not deadline_reached('collect_project_code_env_usage'):
                step_started = time.time()
                add_event('collect_project_code_env_usage', f"collecting usage for projects={len(project_info)}")
                usage_data = _collect_project_code_env_usage(
                    client,
                    project_info,
                    size_by_env,
                    include_project_object_scan=True,
                    include_code_env_usage_api=False,
                    deadline_ts=deadline,
                    progress_cb=progress_event,
                )
                record_step('collect_project_code_env_usage', step_started, calls=len(project_info))

            # Wait for footprint and populate size_by_env before the env details step.
            if footprint_future is not None:
                try:
                    global_footprint = footprint_future.result(timeout=remaining_seconds())
                    if isinstance(global_footprint, dict):
                        code_envs_section = global_footprint.get('codeEnvs')
                        if isinstance(code_envs_section, dict):
                            code_env_items = code_envs_section.get('items')
                            if isinstance(code_env_items, list):
                                for item in code_env_items:
                                    if not isinstance(item, dict):
                                        continue
                                    item_name = item.get('name')
                                    item_lang = str(item.get('language') or '').strip().lower()
                                    if not item_name or not item_lang:
                                        continue
                                    size_key = f"{item_lang}:{item_name}"
                                    size_by_env[size_key] = _coerce_int(item.get('size'), 0)
                except Exception:
                    pass
                finally:
                    footprint_pool.shutdown(wait=False)
                record_step('load_code_env_size_map', footprint_step_started, calls=1)
                size_map_done = True
                _update_progress_summary(False)
            app.logger.info("[code-envs] sizeMap=%s elapsed=%.2fs", len(size_by_env), time.time() - started)

            envs_by_project: Dict[str, set] = usage_data.get('envsByProject') or {}
            selected_env_keys = set()
            for env_keys in envs_by_project.values():
                selected_env_keys.update(env_keys or set())
            app.logger.info(
                "[code-envs] selectedEnvKeys=%s projects=%s elapsed=%.2fs",
                len(selected_env_keys),
                len(project_info),
                time.time() - started,
            )
            add_event('selected_env_keys', f"selected env keys count={len(selected_env_keys)}")

            envs: List[Dict[str, Any]] = []
            if not deadline_reached('list_code_envs'):
                step_started = time.time()
                add_event('list_code_envs', 'listing code envs')
                envs = [env for env in (client.list_code_envs() or []) if isinstance(env, dict)]
                record_step('list_code_envs', step_started, calls=1)

            # Filter out plugin-managed and DSS-internal code envs by default
            _SKIP_DEPLOYMENT_MODES = {'PLUGIN_MANAGED', 'DSS_INTERNAL'}
            if not deadline_reached('filter_selected_envs'):
                step_started = time.time()
                before_count = len(envs)
                envs = [
                    env for env in envs
                    if str(env.get('deploymentMode') or '').upper() not in _SKIP_DEPLOYMENT_MODES
                ]
                skipped = before_count - len(envs)
                add_event('filter_selected_envs', f"filtered out {skipped} plugin-managed/internal envs, keeping {len(envs)}/{before_count}")
                record_step('filter_selected_envs', step_started, calls=len(envs))
            app.logger.info("[code-envs] listed=%s", len(envs))

            env_details: List[Dict[str, Any]] = []
            max_workers = min(_parallel_workers(32), len(envs))
            env_detail_total = len(envs)
            env_detail_done = 0
            _update_progress_summary(False)
            if envs and not deadline_reached('load_code_env_details'):
                step_started = time.time()
                add_event('load_code_env_details', f"loading env details envs={len(envs)} workers={max_workers}")
                if max_workers <= 1:
                    processed = 0
                    for env in envs:
                        if deadline_reached('load_code_env_details'):
                            break
                        env_key = env_key_from_listing(env)
                        env_started = time.time()
                        add_event('code_env_detail_start', 'loading code env detail', 'info', env_key)
                        detail = _load_code_env_full_details(env, project_info, size_by_env, include_usages=False)
                        if detail:
                            env_details.append(detail)
                            row = detail.get('row')
                            if isinstance(row, dict):
                                _append_progress_partial_row('code_envs', progress_run_id, row)
                            add_event('code_env_detail_ok', 'code env detail loaded', 'info', env_key, (time.time() - env_started) * 1000.0)
                        else:
                            add_event('code_env_detail_error', 'code env detail missing', 'warn', env_key, (time.time() - env_started) * 1000.0)
                        processed += 1
                    record_step('load_code_env_details', step_started, calls=processed)
                else:
                    future_to_env: Dict[Any, Dict[str, Any]] = {}
                    env_started_at: Dict[str, float] = {}
                    with ThreadPoolExecutor(max_workers=max_workers) as pool:
                        for env in envs:
                            if deadline_reached('load_code_env_details'):
                                break
                            env_key = env_key_from_listing(env)
                            add_event('code_env_detail_start', 'loading code env detail', 'info', env_key)
                            env_started_at[env_key] = time.time()
                            future = pool.submit(_load_code_env_full_details, env, project_info, size_by_env, False)
                            future_to_env[future] = env

                        processed = 0
                        timed_out_futures = False
                        try:
                            for future in as_completed(list(future_to_env.keys()), timeout=remaining_seconds()):
                                if deadline_reached('load_code_env_details'):
                                    timed_out_futures = True
                                    break
                                env = future_to_env.get(future) or {}
                                env_key = env_key_from_listing(env)
                                started_at = env_started_at.get(env_key, started)
                                try:
                                    detail = future.result()
                                except Exception as exc:
                                    add_event('code_env_detail_error', f"code env detail failed: {exc}", 'warn', env_key, (time.time() - started_at) * 1000.0)
                                    processed += 1
                                    continue
                                if detail:
                                    env_details.append(detail)
                                    row = detail.get('row')
                                    if isinstance(row, dict):
                                        _append_progress_partial_row('code_envs', progress_run_id, row)
                                    add_event('code_env_detail_ok', 'code env detail loaded', 'info', env_key, (time.time() - started_at) * 1000.0)
                                else:
                                    add_event('code_env_detail_error', 'code env detail missing', 'warn', env_key, (time.time() - started_at) * 1000.0)
                                processed += 1
                        except FuturesTimeoutError:
                            timed_out_futures = True
                            add_event('load_code_env_details', 'timeout while waiting for env detail futures', 'warn')

                        if timed_out_futures or deadline_reached('load_code_env_details'):
                            for future, env in future_to_env.items():
                                if future.done():
                                    continue
                                future.cancel()
                                env_key = env_key_from_listing(env)
                                started_at = env_started_at.get(env_key, started)
                                add_event('code_env_detail_timeout', 'cancelled env detail future on deadline', 'warn', env_key, (time.time() - started_at) * 1000.0)
                        record_step('load_code_env_details', step_started, calls=processed)
            app.logger.info("[code-envs] details=%s workers=%s elapsed=%.2fs", len(env_details), max_workers, time.time() - started)

            if env_details and not deadline_reached('aggregate_code_env_rows'):
                step_started = time.time()
                add_event('aggregate_code_env_rows', f"aggregating rows count={len(env_details)}")
                processed = 0
                for detail in env_details:
                    row = detail.get('row')
                    if not isinstance(row, dict):
                        continue
                    code_envs.append(row)
                    language = str(detail.get('language') or 'python')
                    version_label = str(detail.get('versionLabel') or row.get('version') or 'Unknown')
                    if language == 'r':
                        r_counts[version_label] = r_counts.get(version_label, 0) + 1
                    else:
                        python_counts[version_label] = python_counts.get(version_label, 0) + 1
                    processed += 1
                record_step('aggregate_code_env_rows', step_started, calls=processed)

            code_envs.sort(key=lambda item: (_coerce_int(item.get('sizeBytes'), 0), str(item.get('name') or '')), reverse=True)
            app.logger.info("[code-envs] done rows=%s elapsed=%.2fs", len(code_envs), time.time() - started)
            add_event('code_envs_done', f"code envs done rows={len(code_envs)} timedOut={timed_out}")

            api_calls = []
            for entry in sorted(op_stats.values(), key=lambda item: float(item.get('elapsedMs') or 0.0), reverse=True):
                calls = int(entry.get('calls') or 0)
                elapsed = float(entry.get('elapsedMs') or 0.0)
                avg_ms = (elapsed / calls) if calls > 0 else 0.0
                qps = (calls / (elapsed / 1000.0)) if calls > 0 and elapsed > 0 else 0.0
                api_calls.append({
                    'operation': entry.get('operation'),
                    'calls': calls,
                    'elapsedMs': round(elapsed, 2),
                    'avgMs': round(avg_ms, 2),
                    'qps': round(qps, 2),
                })

            benchmark_summary = {
                'enabled': True,
                'projectLimit': len(project_info),
                'projectSelection': project_selection,
                'timeoutMs': timeout_ms,
                'timedOut': bool(timed_out),
                'timeoutAtStep': timeout_at_step,
                'totalElapsedMs': round(elapsed_ms(), 2),
                'remainingMs': remaining_ms(),
                'selectedProjectCount': len(project_info),
                'selectedEnvKeyCount': len(selected_env_keys),
                'steps': steps,
                'apiCalls': api_calls,
                'events': events,
            }
            summary = {
                'benchmark': {
                    **benchmark_summary,
                },
            }
            _update_progress_summary(True)
            _finish_progress('code_envs', progress_run_id, status='done', summary=benchmark_summary)

            return {
                'codeEnvs': code_envs,
                'pythonVersionCounts': python_counts,
                'rVersionCounts': r_counts,
                'summary': summary,
            }
        except Exception as exc:
            timed_out_or_error = True
            add_event('code_envs_error', f"code env analysis failed: {exc}", 'error')
            _update_progress_summary(False)
            _finish_progress(
                'code_envs',
                progress_run_id,
                status='error',
                summary={
                    'enabled': True,
                    'projectLimit': len(project_info),
                    'projectSelection': project_selection,
                    'timeoutMs': timeout_ms,
                    'timedOut': bool(timed_out),
                    'timeoutAtStep': timeout_at_step,
                    'totalElapsedMs': round(elapsed_ms(), 2),
                    'remainingMs': remaining_ms(),
                    'steps': steps,
                    'apiCalls': api_calls if 'api_calls' in locals() else [],
                    'events': events,
                },
                error=str(exc),
            )
            raise
        finally:
            setattr(_THREAD_LOCAL, 'bench_record_op', previous_recorder)

    data = _cache_get('code_envs', 5, loader)
    return jsonify(data)


@app.route('/api/code-envs/progress')
def api_code_envs_progress():
    since_raw = request.args.get('since', '0')
    run_id = request.args.get('runId')
    rows_since_raw = request.args.get('rowsSince', '0')
    try:
        since = max(0, int(str(since_raw or '0')))
    except Exception:
        since = 0
    try:
        rows_since = max(0, int(str(rows_since_raw or '0')))
    except Exception:
        rows_since = 0
    payload = _read_progress('code_envs', since=since, run_id=run_id, rows_since=rows_since)
    return jsonify(payload)


@app.route('/api/code-envs-progress')
def api_code_envs_progress_alias():
    return api_code_envs_progress()


@app.route('/api/project-footprint')
def api_project_footprint():
    client = dataiku.api_client()

    def loader():
        timeout_ms = 600000
        project_limit = 0
        project_selection = 'all_by_project_key'
        limit_label = 'all' if project_limit <= 0 else str(project_limit)
        started = time.time()
        deadline = started + (timeout_ms / 1000.0)
        steps: List[Dict[str, Any]] = []
        op_stats: Dict[str, Dict[str, Any]] = {}
        benchmark_events: List[Dict[str, Any]] = []
        benchmark_timed_out = False
        timeout_at_step: Optional[str] = None
        deadline_pressure_steps: set = set()
        timeout_event_steps: set = set()
        progress_run_id = _start_progress('project_footprint')
        selected_project_count = 0
        footprint_done_projects: set = set()
        usage_done_projects: set = set()
        aggregate_done_projects: set = set()
        catalog_done = False
        timed_out_or_error = False

        def elapsed_ms() -> float:
            return (time.time() - started) * 1000.0

        def remaining_ms() -> int:
            return max(0, int((deadline - time.time()) * 1000.0))

        def _compute_progress_pct(force_done: bool = False) -> int:
            if force_done:
                return 100
            footprint_total = max(0, int(selected_project_count))
            usage_total = max(0, int(selected_project_count))
            aggregate_total = max(0, int(selected_project_count))
            footprint_ratio = min(1.0, float(len(footprint_done_projects)) / float(footprint_total)) if footprint_total > 0 else 0.0
            usage_ratio = min(1.0, float(len(usage_done_projects)) / float(usage_total)) if usage_total > 0 else 0.0
            aggregate_ratio = min(1.0, float(len(aggregate_done_projects)) / float(aggregate_total)) if aggregate_total > 0 else 0.0
            pct = 0.0
            pct += 10.0 if catalog_done else 0.0
            pct += 50.0 * footprint_ratio
            pct += 25.0 * usage_ratio
            pct += 15.0 * aggregate_ratio
            if timed_out_or_error:
                return int(max(0.0, min(100.0, pct)))
            return int(max(0.0, min(99.0, pct)))

        def _infer_phase() -> str:
            if not catalog_done:
                return 'catalog'
            if selected_project_count > 0 and len(footprint_done_projects) < selected_project_count:
                return 'footprint_fetch'
            if selected_project_count > 0 and len(usage_done_projects) < selected_project_count:
                return 'usage_scan'
            if selected_project_count > 0 and len(aggregate_done_projects) < selected_project_count:
                return 'aggregate'
            return 'finalizing'

        def _update_progress_summary(force_done: bool = False) -> None:
            _set_progress_summary(
                'project_footprint',
                progress_run_id,
                {
                    'progressPct': _compute_progress_pct(force_done),
                    'phase': _infer_phase() if not force_done else 'done',
                    'selectedProjects': int(selected_project_count),
                    'projectFootprintDone': int(len(footprint_done_projects)),
                    'projectUsageDone': int(len(usage_done_projects)),
                    'projectAggregateDone': int(len(aggregate_done_projects)),
                    'timedOut': bool(benchmark_timed_out),
                    'timeoutAtStep': timeout_at_step,
                    'totalElapsedMs': round(elapsed_ms(), 2),
                    'remainingMs': remaining_ms(),
                },
            )

        def add_event(
            step: str,
            message: str,
            level: str = 'info',
            project_key: Optional[str] = None,
            event_elapsed_ms: Optional[float] = None,
        ) -> None:
            event: Dict[str, Any] = {
                'tMs': round(elapsed_ms(), 2),
                'level': level,
                'step': step,
                'message': message,
            }
            if project_key:
                event['projectKey'] = project_key
            if event_elapsed_ms is not None:
                event['elapsedMs'] = round(max(0.0, float(event_elapsed_ms)), 2)
            benchmark_events.append(event)
            _append_progress_event('project_footprint', progress_run_id, event)
            if step in ('project_footprint_fetch_ok', 'project_footprint_fetch_error', 'project_footprint_fetch_timeout') and project_key:
                footprint_done_projects.add(project_key)
            if step == 'project_env_refs_resolved' and project_key:
                usage_done_projects.add(project_key)
            if step == 'project_aggregate_done' and project_key:
                aggregate_done_projects.add(project_key)
            _update_progress_summary(False)

        def progress_event(**kwargs) -> None:
            add_event(
                step=str(kwargs.get('step') or 'event'),
                message=str(kwargs.get('message') or ''),
                level=str(kwargs.get('level') or 'info'),
                project_key=kwargs.get('project_key'),
                event_elapsed_ms=kwargs.get('elapsed_ms'),
            )

        def deadline_reached(step_name: str) -> bool:
            nonlocal benchmark_timed_out, timeout_at_step, timed_out_or_error
            now = time.time()
            if now < deadline:
                if step_name not in deadline_pressure_steps and (deadline - now) <= 10.0:
                    deadline_pressure_steps.add(step_name)
                    add_event(step_name, f"deadline pressure: only {remaining_ms()}ms remaining", 'warn')
                return False
            benchmark_timed_out = True
            timed_out_or_error = True
            if timeout_at_step is None:
                timeout_at_step = step_name
            if step_name not in timeout_event_steps:
                timeout_event_steps.add(step_name)
                add_event(step_name, f"deadline reached at step={step_name}", 'warn')
            return True

        def record_step(name: str, step_start: float, calls: int = 0) -> None:
            elapsed = max(0.0, (time.time() - step_start) * 1000.0)
            avg_ms = (elapsed / calls) if calls > 0 else 0.0
            qps = (calls / (elapsed / 1000.0)) if calls > 0 and elapsed > 0 else 0.0
            steps.append({
                'name': name,
                'calls': int(calls),
                'elapsedMs': round(elapsed, 2),
                'avgMs': round(avg_ms, 2),
                'qps': round(qps, 2),
            })
            add_event(name, f"{name} done calls={calls}", 'info', event_elapsed_ms=elapsed)

        def record_op(name: str, elapsed_ms_value: float, calls: int = 1) -> None:
            entry = op_stats.setdefault(name, {'operation': name, 'calls': 0, 'elapsedMs': 0.0})
            entry['calls'] = int(entry.get('calls') or 0) + int(max(0, calls))
            entry['elapsedMs'] = float(entry.get('elapsedMs') or 0.0) + max(0.0, float(elapsed_ms_value))

        previous_recorder = getattr(_THREAD_LOCAL, 'bench_record_op', None)
        setattr(_THREAD_LOCAL, 'bench_record_op', record_op)

        total_project_count = 0
        selected_catalog: List[Dict[str, str]] = []
        project_rows: List[Dict[str, Any]] = []
        project_risks: List[float] = []
        total_gb_values: List[float] = []

        try:
            project_info: Dict[str, Dict[str, str]] = {}
            project_keys: List[str] = []
            project_footprints: Dict[str, Any] = {}
            usage_data: Dict[str, Any] = {}

            if not deadline_reached('load_project_catalog'):
                step_start = time.time()
                add_event('load_project_catalog', 'loading project catalog')
                catalog = _list_projects_catalog(client)
                total_project_count = len(catalog)
                record_step('load_project_catalog', step_start, calls=1)
            else:
                catalog = []
            catalog_done = True
            _update_progress_summary(False)

            if not deadline_reached('select_projects_by_key'):
                step_start = time.time()
                add_event('select_projects_by_key', f"selecting projects by key limit={limit_label}")
                selected_catalog = catalog[:] if project_limit <= 0 else catalog[:project_limit]
                record_step('select_projects_by_key', step_start, calls=len(selected_catalog))

            project_info = {
                str(project.get('key') or ''): {
                    'name': str(project.get('name') or project.get('key') or ''),
                    'owner': str(project.get('owner') or 'Unknown'),
                }
                for project in selected_catalog
                if str(project.get('key') or '').strip()
            }
            project_keys = list(project_info.keys())
            selected_project_count = len(project_keys)
            _update_progress_summary(False)

            if project_keys and not deadline_reached('load_project_footprint_map'):
                step_start = time.time()
                add_event('load_project_footprint_map', f"loading project footprint map for {len(project_keys)} projects")
                project_footprints = _build_project_footprint_map_with_deadline(
                    client,
                    project_keys,
                    deadline_ts=deadline,
                    progress_cb=progress_event,
                )
                record_step('load_project_footprint_map', step_start, calls=len(project_keys))

            # Emit partial rows immediately after footprint fetch so the frontend
            # can render the table (~10s) while the usage scan runs in the background.
            # These rows have codeEnvCount=0; the final response replaces them.
            if project_keys and project_footprints:
                for _pk in project_keys:
                    _meta = project_info.get(_pk) or {}
                    _pf = project_footprints.get(_pk)
                    _mdb = _collect_bucket_size_by_name(_pf, lambda n: 'manageddataset' in n or ('managed' in n and 'dataset' in n))
                    _mfb = _collect_bucket_size_by_name(_pf, lambda n: 'managedfolder' in n or ('managed' in n and 'folder' in n))
                    _bb = _collect_bucket_size_by_name(_pf, lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n)
                    _bc = _collect_bucket_file_count_by_name(_pf, lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n)
                    _total = _footprint_size(_pf)
                    if _total <= 0:
                        _total = _mdb + _mfb + _bb
                    _append_progress_partial_row('project_footprint', progress_run_id, {
                        'projectKey': _pk,
                        'name': str(_meta.get('name') or _pk).replace('_', ' '),
                        'owner': _meta.get('owner') or 'Unknown',
                        'codeEnvCount': 0,
                        'codeStudioCount': 0,
                        'codeEnvBytes': 0,
                        'managedDatasetsBytes': _mdb,
                        'managedFoldersBytes': _mfb,
                        'bundleBytes': _bb,
                        'bundleCount': _bc,
                        'totalBytes': _total,
                        'totalGB': _total / float(1024 ** 3),
                        'codeEnvHealth': _code_env_health(0),
                    })

            if project_keys and not deadline_reached('collect_project_code_env_usage'):
                step_start = time.time()
                add_event('collect_project_code_env_usage', f"collecting project code env usage for {len(project_keys)} projects")
                usage_data = _collect_project_code_env_usage(
                    client,
                    project_info,
                    {},
                    include_project_object_scan=True,
                    include_code_env_usage_api=False,
                    deadline_ts=deadline,
                    progress_cb=progress_event,
                )
                record_step('collect_project_code_env_usage', step_start, calls=len(project_keys))

            envs_by_project: Dict[str, set] = usage_data.get('envsByProject') or {k: set() for k in project_info.keys()}
            usage_breakdown_by_project: Dict[str, Dict[str, int]] = usage_data.get('usageBreakdownByProject') or {k: {} for k in project_info.keys()}
            usage_details_by_project: Dict[str, List[Dict[str, Any]]] = usage_data.get('usageDetailsByProject') or {k: [] for k in project_info.keys()}
            code_studio_count_by_project: Dict[str, int] = usage_data.get('codeStudioCountByProject') or {}

            if project_keys and not deadline_reached('aggregate_project_rows'):
                step_start = time.time()
                add_event('aggregate_project_rows', f"aggregating project rows for {len(project_keys)} projects")
                processed = 0
                raw_rows: List[Dict[str, Any]] = []
                for project_key in project_keys:
                    if deadline_reached('aggregate_project_rows'):
                        break
                    project_started = time.time()
                    add_event('project_aggregate_start', 'aggregating project row', 'info', project_key)
                    meta = project_info.get(project_key) or {}
                    project_footprint = project_footprints.get(project_key)

                    managed_datasets_bytes = _collect_bucket_size_by_name(
                        project_footprint,
                        lambda n: 'manageddataset' in n or ('managed' in n and 'dataset' in n),
                    )
                    managed_folders_bytes = _collect_bucket_size_by_name(
                        project_footprint,
                        lambda n: 'managedfolder' in n or ('managed' in n and 'folder' in n),
                    )

                    project_env_keys = envs_by_project.get(project_key) or set()
                    code_env_count = len(project_env_keys)
                    bundle_bytes = _collect_bucket_size_by_name(
                        project_footprint,
                        lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n,
                    )
                    bundle_count = _collect_bucket_file_count_by_name(
                        project_footprint,
                        lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n,
                    )

                    total_bytes = _footprint_size(project_footprint)
                    if total_bytes <= 0:
                        total_bytes = managed_datasets_bytes + managed_folders_bytes + bundle_bytes
                    total_gb = total_bytes / float(1024 ** 3)
                    total_gb_values.append(total_gb)

                    raw_row = {
                        'projectKey': project_key,
                        'name': str(meta.get('name') or project_key).replace('_', ' '),
                        'owner': meta.get('owner') or 'Unknown',
                        'codeEnvCount': code_env_count,
                        'codeStudioCount': code_studio_count_by_project.get(project_key, 0),
                        'codeEnvBytes': 0,
                        'managedDatasetsBytes': managed_datasets_bytes,
                        'managedFoldersBytes': managed_folders_bytes,
                        'bundleBytes': bundle_bytes,
                        'bundleCount': bundle_count,
                        'totalBytes': total_bytes,
                        'totalGB': total_gb,
                        'codeEnvHealth': _code_env_health(code_env_count),
                        'usageBreakdown': usage_breakdown_by_project.get(project_key) or {},
                        'usageDetails': usage_details_by_project.get(project_key) or [],
                        'codeEnvKeys': sorted(list(project_env_keys)),
                    }
                    raw_rows.append(raw_row)
                    processed += 1
                    add_event(
                        'project_aggregate_done',
                        (
                            f"aggregate complete codeEnvCount={code_env_count} "
                            f"total={_format_size_human(total_bytes)} bundles={bundle_count}"
                        ),
                        'info',
                        project_key,
                        event_elapsed_ms=(time.time() - project_started) * 1000.0,
                    )

                record_step('aggregate_project_rows', step_start, calls=processed)

                avg_project_gb = (sum(total_gb_values) / len(total_gb_values)) if total_gb_values else 0.0
                if not deadline_reached('compute_health_scores'):
                    step_start = time.time()
                    add_event('compute_health_scores', f"computing health scores for {len(raw_rows)} projects")
                    for row in raw_rows:
                        if deadline_reached('compute_health_scores'):
                            break
                        total_gb = _coerce_float(row.get('totalGB'), 0.0)
                        size_index = _project_size_index(total_gb, avg_project_gb)
                        size_health = _project_size_health(total_gb, size_index)
                        code_env_count = _coerce_int(row.get('codeEnvCount'), 0)
                        env_risk = _code_env_risk(code_env_count)
                        project_risk = (0.7 * env_risk) + (0.3 * size_index)
                        project_risks.append(project_risk)
                        row.update({
                            'instanceAvgProjectGB': round(avg_project_gb, 4),
                            'projectSizeIndex': round(size_index, 4),
                            'projectSizeHealth': size_health,
                            'codeEnvRisk': round(env_risk, 4),
                            'projectRisk': round(project_risk, 4),
                        })
                        project_rows.append(row)
                    record_step('compute_health_scores', step_start, calls=len(project_rows))

            project_rows.sort(key=lambda item: _coerce_int(item.get('totalBytes'), 0), reverse=True)
            avg_project_gb = (sum(total_gb_values) / len(total_gb_values)) if total_gb_values else 0.0
            avg_project_risk = (sum(project_risks) / len(project_risks)) if project_risks else 0.0

            api_calls = []
            for entry in sorted(op_stats.values(), key=lambda item: float(item.get('elapsedMs') or 0.0), reverse=True):
                calls = int(entry.get('calls') or 0)
                elapsed = float(entry.get('elapsedMs') or 0.0)
                avg_ms = (elapsed / calls) if calls > 0 else 0.0
                qps = (calls / (elapsed / 1000.0)) if calls > 0 and elapsed > 0 else 0.0
                api_calls.append({
                    'operation': entry.get('operation'),
                    'calls': calls,
                    'elapsedMs': round(elapsed, 2),
                    'avgMs': round(avg_ms, 2),
                    'qps': round(qps, 2),
                })

            benchmark_summary = {
                'enabled': True,
                'projectLimit': len(project_keys),
                'projectSelection': project_selection,
                'timeoutMs': timeout_ms,
                'timedOut': bool(benchmark_timed_out),
                'timeoutAtStep': timeout_at_step,
                'totalElapsedMs': round(elapsed_ms(), 2),
                'remainingMs': remaining_ms(),
                'totalProjectCount': total_project_count,
                'selectedProjectCount': len(project_keys),
                'steps': steps,
                'apiCalls': api_calls,
                'events': benchmark_events,
            }
            summary = {
                'instanceProjectRiskAvg': round(avg_project_risk, 4),
                'instanceAvgProjectGB': round(avg_project_gb, 4),
                'projectCount': len(project_rows),
                'benchmark': benchmark_summary,
            }
            app.logger.info(
                "[project-footprint] benchmark done rows=%s selected=%s total=%s elapsed=%.2fs timedOut=%s",
                len(project_rows),
                len(project_keys),
                total_project_count,
                time.time() - started,
                benchmark_timed_out,
            )
            add_event(
                'project_footprint_done',
                f"project footprint done rows={len(project_rows)} selected={len(project_keys)} total={total_project_count} timedOut={benchmark_timed_out}",
            )
            _update_progress_summary(True)
            _finish_progress('project_footprint', progress_run_id, status='done', summary=benchmark_summary)
            return {
                'projects': project_rows,
                'summary': summary,
            }
        except Exception as exc:
            timed_out_or_error = True
            add_event('project_footprint_error', f"project footprint analysis failed: {exc}", 'error')
            _update_progress_summary(False)
            _finish_progress(
                'project_footprint',
                progress_run_id,
                status='error',
                summary={
                    'enabled': True,
                    'projectLimit': selected_project_count,
                    'projectSelection': project_selection,
                    'timeoutMs': timeout_ms,
                    'timedOut': bool(benchmark_timed_out),
                    'timeoutAtStep': timeout_at_step,
                    'totalElapsedMs': round(elapsed_ms(), 2),
                    'remainingMs': remaining_ms(),
                    'totalProjectCount': total_project_count,
                    'selectedProjectCount': selected_project_count,
                    'steps': steps,
                    'apiCalls': [
                        {
                            'operation': entry.get('operation'),
                            'calls': int(entry.get('calls') or 0),
                            'elapsedMs': round(float(entry.get('elapsedMs') or 0.0), 2),
                            'avgMs': round((float(entry.get('elapsedMs') or 0.0) / max(1, int(entry.get('calls') or 0))), 2),
                            'qps': round((int(entry.get('calls') or 0) / max(0.001, float(entry.get('elapsedMs') or 0.0) / 1000.0)), 2),
                        }
                        for entry in sorted(op_stats.values(), key=lambda item: float(item.get('elapsedMs') or 0.0), reverse=True)
                    ],
                    'events': benchmark_events,
                },
                error=str(exc),
            )
            raise
        finally:
            setattr(_THREAD_LOCAL, 'bench_record_op', previous_recorder)

    data = loader()
    return jsonify(data)


@app.route('/api/project-footprint/progress')
def api_project_footprint_progress():
    since_raw = request.args.get('since', '0')
    run_id = request.args.get('runId')
    rows_since_raw = request.args.get('rowsSince', '0')
    try:
        since = max(0, int(str(since_raw or '0')))
    except Exception:
        since = 0
    try:
        rows_since = max(0, int(str(rows_since_raw or '0')))
    except Exception:
        rows_since = 0
    payload = _read_progress('project_footprint', since=since, run_id=run_id, rows_since=rows_since)
    return jsonify(payload)


@app.route('/api/project-footprint-progress')
def api_project_footprint_progress_alias():
    return api_project_footprint_progress()


def _do_tracking_ingest(db, data):
    """Run a tracking ingest from outreach data. Returns the new run_id."""
    import hashlib
    overview = _CACHE.get('overview', {}).get('value') or {}
    instance_info = overview.get('instanceInfo') or {}
    install_id = instance_info.get('installId') or ''
    instance_url = instance_info.get('instanceUrl') or ''
    inst_id = install_id or (hashlib.sha256(instance_url.encode()).hexdigest()[:16] if instance_url else 'unknown')

    disabled = db.get_disabled_campaigns()
    exemptions = db.get_exemption_set()
    findings = extract_findings_from_outreach_data(data, disabled_campaigns=disabled, exemptions=exemptions)

    users_data = (_CACHE.get('users', {}).get('value') or {})
    projects_data = (_CACHE.get('projects', {}).get('value') or {})
    user_list = users_data.get('users') or []
    project_list = projects_data.get('projects') or []

    run_data = {
        'dss_version': overview.get('dssVersion'),
        'python_version': overview.get('pythonVersion'),
        'user_count': users_data.get('userCount'),
        'enabled_user_count': users_data.get('enabledUserCount'),
        'project_count': projects_data.get('projectCount'),
        'code_env_count': (data.get('summary') or {}).get('unhealthyCodeEnvCount'),
    }

    mem_info = overview.get('memoryInfo') or {}
    fs_raw = overview.get('filesystemInfo')
    mounts = fs_raw.get('mounts') or [] if isinstance(fs_raw, dict) else (fs_raw if isinstance(fs_raw, list) else [])
    max_fs_pct = 0.0
    max_fs_mount = ''
    for fs in mounts:
        pct = fs.get('usePct', 0)
        if isinstance(pct, (int, float)) and pct > max_fs_pct:
            max_fs_pct = pct
            max_fs_mount = fs.get('mountedOn', '')
    health_metrics = {
        'cpu_cores': overview.get('cpuCores'),
        'memory_total_mb': mem_info.get('totalMB'),
        'memory_used_mb': mem_info.get('usedMB'),
        'memory_available_mb': mem_info.get('availableMB'),
        'swap_total_mb': mem_info.get('swapTotalMB'),
        'swap_used_mb': mem_info.get('swapUsedMB'),
        'max_filesystem_pct': max_fs_pct if max_fs_pct else None,
        'max_filesystem_mount': max_fs_mount or None,
    }

    _campaign_recipient_keys = {
        'project': 'projectRecipients', 'code_env': 'codeEnvRecipients',
        'code_studio': 'codeStudioRecipients', 'auto_scenario': 'autoScenarioRecipients',
        'scenario_frequency': 'scenarioFrequencyRecipients',
        'scenario_failing': 'scenarioFailingRecipients',
        'disabled_user': 'disabledUserRecipients',
        'deprecated_code_env': 'deprecatedCodeEnvRecipients',
        'default_code_env': 'defaultCodeEnvRecipients',
        'empty_project': 'emptyProjectRecipients',
        'large_flow': 'largeFlowRecipients',
        'orphan_notebooks': 'orphanNotebookRecipients',
        'overshared_project': 'oversharedProjectRecipients',
        'inactive_project': 'inactiveProjectRecipients',
    }
    campaign_summaries = []
    findings_by_campaign = {}
    for f in findings:
        cid = f.get('campaign_id', '')
        findings_by_campaign[cid] = findings_by_campaign.get(cid, 0) + 1
    for cid, rkey in _campaign_recipient_keys.items():
        campaign_summaries.append({
            'campaign_id': cid,
            'finding_count': 0 if cid in disabled else findings_by_campaign.get(cid, 0),
            'recipient_count': 0 if cid in disabled else len(data.get(rkey) or []),
        })

    sections = {
        'overview': {'status': 'success'},
        'users': {'status': 'success'},
        'projects': {'status': 'success'},
        'code_envs': {'status': 'success'},
        'project_footprint': {'status': 'success'},
        'scenarios': {'status': 'success'},
        'outreach_data': {'status': 'success'},
    }

    user_ingest = []
    for u in user_list:
        if isinstance(u, dict):
            user_ingest.append({
                'login': u.get('login'),
                'email': u.get('email'),
                'displayName': u.get('displayName'),
                'userProfile': u.get('userProfile'),
                'enabled': u.get('enabled', True),
            })

    project_ingest = []
    for p in project_list:
        if isinstance(p, dict):
            project_ingest.append({
                'projectKey': p.get('projectKey') or p.get('key'),
                'name': p.get('name'),
                'owner': p.get('owner') or p.get('ownerLogin'),
            })

    run_id = db.ingest_run(
        instance_id=inst_id,
        instance_url=instance_url,
        install_id=install_id or None,
        node_id=instance_info.get('nodeId'),
        run_data=run_data,
        findings=findings,
        users=user_ingest,
        projects=project_ingest,
        sections=sections,
        health_metrics=health_metrics,
        campaign_summaries=campaign_summaries,
    )
    app.logger.info("[tracking] ingested run %d with %d findings", run_id, len(findings))
    return run_id


@app.route('/api/tools/outreach-data')
def api_tools_outreach_data():
    client = dataiku.api_client()

    def loader():
        users = client.list_users() if hasattr(client, 'list_users') else []
        user_email_by_login: Dict[str, str] = {}
        disabled_user_logins: set = set()
        for user in users:
            if not isinstance(user, dict):
                continue
            login = str(user.get('login') or '').strip()
            if not login:
                continue
            user_email_by_login[login] = str(user.get('email') or login)
            if user.get('enabled') is False:
                disabled_user_logins.add(login)

        project_info = _build_project_info(client, 0)
        project_keys = list(project_info.keys())
        project_footprints = _build_project_footprint_map(client, project_keys)
        size_by_env = _get_code_env_size_map(client)
        usage_data = _cache_get(
            'project_code_env_usage_full',
            5,
            lambda: _collect_project_code_env_usage(
                client,
                project_info,
                size_by_env,
                include_project_object_scan=True,
            ),
        )
        envs_by_project: Dict[str, set] = usage_data.get('envsByProject') or {k: set() for k in project_info.keys()}
        usage_breakdown_by_project: Dict[str, Dict[str, int]] = usage_data.get('usageBreakdownByProject') or {k: {} for k in project_info.keys()}
        usage_details_by_project: Dict[str, List[Dict[str, Any]]] = usage_data.get('usageDetailsByProject') or {k: [] for k in project_info.keys()}
        env_meta_by_key: Dict[str, Dict[str, Any]] = usage_data.get('envMetaByKey') or {}
        code_studio_count_by_project: Dict[str, int] = usage_data.get('codeStudioCountByProject') or {}

        total_gb_values: List[float] = []
        project_rows: List[Dict[str, Any]] = []
        for project_key, meta in project_info.items():
            project_footprint = project_footprints.get(project_key)

            managed_datasets_bytes = _collect_bucket_size_by_name(
                project_footprint,
                lambda n: 'manageddataset' in n or ('managed' in n and 'dataset' in n),
            )
            managed_folders_bytes = _collect_bucket_size_by_name(
                project_footprint,
                lambda n: 'managedfolder' in n or ('managed' in n and 'folder' in n),
            )

            project_env_keys = envs_by_project.get(project_key) or set()
            code_env_count = len(project_env_keys)
            code_env_bytes = sum(size_by_env.get(env_key, 0) for env_key in project_env_keys)
            bundle_bytes = _collect_bucket_size_by_name(
                project_footprint,
                lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n,
            )
            bundle_count = _collect_bucket_file_count_by_name(
                project_footprint,
                lambda n: 'preparedbundle' in n or n.endswith('bundles') or 'bundle' in n,
            )

            total_bytes = _footprint_size(project_footprint)
            if total_bytes <= 0:
                total_bytes = code_env_bytes + managed_datasets_bytes + managed_folders_bytes + bundle_bytes
            total_gb = total_bytes / float(1024 ** 3)
            total_gb_values.append(total_gb)

            row = {
                'projectKey': project_key,
                'name': str(meta.get('name') or project_key).replace('_', ' '),
                'owner': str(meta.get('owner') or 'Unknown'),
                'codeEnvCount': code_env_count,
                'codeStudioCount': code_studio_count_by_project.get(project_key, 0),
                'codeEnvBytes': code_env_bytes,
                'managedDatasetsBytes': managed_datasets_bytes,
                'managedFoldersBytes': managed_folders_bytes,
                'bundleBytes': bundle_bytes,
                'bundleCount': bundle_count,
                'totalBytes': total_bytes,
                'totalGB': total_gb,
                'codeEnvHealth': _code_env_health(code_env_count),
                'usageBreakdown': usage_breakdown_by_project.get(project_key) or {},
                'usageDetails': _dedupe_usage_entries(usage_details_by_project.get(project_key) or []),
                'codeEnvKeys': sorted(list(project_env_keys)),
            }
            project_rows.append(row)

        app.logger.info(
            "[tools] outreach footprintRows=%s projectKeys=%s",
            len(project_footprints),
            len(project_keys),
        )

        avg_project_gb = (sum(total_gb_values) / len(total_gb_values)) if total_gb_values else 0.0
        for row in project_rows:
            total_gb = _coerce_float(row.get('totalGB'), 0.0)
            size_index = _project_size_index(total_gb, avg_project_gb)
            row['instanceAvgProjectGB'] = round(avg_project_gb, 4)
            row['projectSizeIndex'] = round(size_index, 4)
            row['projectSizeHealth'] = _project_size_health(total_gb, size_index)
            row['codeEnvRisk'] = round(_code_env_risk(_coerce_int(row.get('codeEnvCount'), 0)), 4)

        project_rows.sort(key=lambda item: _coerce_int(item.get('totalBytes'), 0), reverse=True)
        unhealthy_projects = [row for row in project_rows if _coerce_int(row.get('codeEnvCount'), 0) > 1]
        unhealthy_project_keys = {str(row.get('projectKey') or '') for row in unhealthy_projects}

        unhealthy_code_envs: List[Dict[str, Any]] = []
        for env_meta in env_meta_by_key.values():
            usage_details = [u for u in (env_meta.get('usageDetails') or []) if str(u.get('projectKey') or '') in unhealthy_project_keys]
            if not usage_details:
                continue
            impacted_projects = sorted(
                {
                    str(usage.get('projectKey') or '')
                    for usage in usage_details
                    if str(usage.get('projectKey') or '')
                }
            )
            row = dict(env_meta)
            row['usageDetails'] = _dedupe_usage_entries(usage_details)
            row['impactedProjects'] = impacted_projects
            unhealthy_code_envs.append(row)
        unhealthy_code_envs.sort(key=lambda item: _coerce_int(item.get('sizeBytes'), 0), reverse=True)

        project_recipients_map: Dict[str, Dict[str, Any]] = {}
        for row in unhealthy_projects:
            owner = str(row.get('owner') or 'Unknown')
            recipient = project_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            project_env_names = []
            for env_key in row.get('codeEnvKeys') or []:
                env_meta = env_meta_by_key.get(str(env_key))
                if env_meta and env_meta.get('name'):
                    project_env_names.append(str(env_meta.get('name')))
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'codeEnvCount': row.get('codeEnvCount'),
                'totalGB': row.get('totalGB'),
                'codeEnvNames': sorted(set(project_env_names)),
            })
            for env_key in row.get('codeEnvKeys') or []:
                env_meta = env_meta_by_key.get(str(env_key))
                if env_meta and env_meta.get('name'):
                    recipient['codeEnvNames'].append(str(env_meta.get('name')))
            recipient['usageDetails'].extend(row.get('usageDetails') or [])

        project_recipients = []
        for recipient in project_recipients_map.values():
            project_keys = sorted(set(recipient.get('projectKeys') or []))
            code_env_names = sorted(set(recipient.get('codeEnvNames') or []))
            usage_details = _dedupe_usage_entries(recipient.get('usageDetails') or [])
            project_recipients.append({
                **recipient,
                'projectKeys': project_keys,
                'codeEnvNames': code_env_names,
                'usageDetails': usage_details,
                'projectKeyForSend': project_keys[0] if project_keys else None,
            })
        project_recipients.sort(key=lambda row: len(row.get('projectKeys') or []), reverse=True)

        code_env_recipients_map: Dict[str, Dict[str, Any]] = {}
        for row in project_rows:
            project_owner = str(row.get('owner') or 'Unknown')
            project_owner_key = project_owner.strip().lower()
            project_key = str(row.get('projectKey') or '')
            row_usage_details = row.get('usageDetails') or []
            mismatched_usage: List[Dict[str, Any]] = []
            mismatched_env_names: set = set()

            for usage in row_usage_details:
                if not isinstance(usage, dict):
                    continue
                env_name = str(usage.get('codeEnvName') or usage.get('codeEnvKey') or '').strip()
                env_owner = str(usage.get('codeEnvOwner') or 'Unknown').strip()
                if not env_name:
                    continue
                if env_owner.lower() == project_owner_key:
                    continue
                mismatched_usage.append(dict(usage))
                mismatched_env_names.add(env_name)

            if not mismatched_usage:
                continue

            recipient = code_env_recipients_map.setdefault(
                project_owner,
                {
                    'recipientKey': project_owner,
                    'owner': project_owner,
                    'email': user_email_by_login.get(project_owner, project_owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['codeEnvNames'].extend(sorted(mismatched_env_names))
            recipient['usageDetails'].extend(mismatched_usage)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'mismatchedCodeEnvCount': len(mismatched_env_names),
            })

        code_env_recipients = []
        for recipient in code_env_recipients_map.values():
            project_keys = sorted(set(recipient.get('projectKeys') or []))
            code_env_names = sorted(set(recipient.get('codeEnvNames') or []))
            usage_details = _dedupe_usage_entries(recipient.get('usageDetails') or [])
            code_env_recipients.append({
                **recipient,
                'projectKeys': project_keys,
                'codeEnvNames': code_env_names,
                'usageDetails': usage_details,
                'projectKeyForSend': project_keys[0] if project_keys else None,
            })
        code_env_recipients.sort(key=lambda row: len(row.get('codeEnvNames') or []), reverse=True)

        # Code Studio outreach
        unhealthy_code_studio_projects = [row for row in project_rows if _coerce_int(row.get('codeStudioCount'), 0) > 7]
        code_studio_recipients_map: Dict[str, Dict[str, Any]] = {}
        for row in unhealthy_code_studio_projects:
            owner = str(row.get('owner') or 'Unknown')
            recipient = code_studio_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'codeStudioCount': row.get('codeStudioCount'),
                'totalGB': row.get('totalGB'),
            })

        code_studio_recipients = []
        for recipient in code_studio_recipients_map.values():
            project_keys = sorted(set(recipient.get('projectKeys') or []))
            code_studio_recipients.append({
                **recipient,
                'projectKeys': project_keys,
                'codeEnvNames': sorted(set(recipient.get('codeEnvNames') or [])),
                'usageDetails': _dedupe_usage_entries(recipient.get('usageDetails') or []),
                'projectKeyForSend': project_keys[0] if project_keys else None,
            })
        code_studio_recipients.sort(key=lambda row: len(row.get('projectKeys') or []), reverse=True)

        # Auto-start scenario outreach (parallelized)
        auto_scenario_recipients_map: Dict[str, Dict[str, Any]] = {}
        auto_scenario_count = 0
        scenario_frequency_recipients_map: Dict[str, Dict[str, Any]] = {}
        scenario_frequency_count = 0
        scenario_failing_recipients_map: Dict[str, Dict[str, Any]] = {}
        scenario_failing_count = 0
        scenario_data_by_project: Dict[str, List[Dict[str, Any]]] = {}
        projects_with_active_scenarios: set = set()

        def _fetch_project_scenarios(p_key: str) -> Tuple[str, Optional[list]]:
            local_client = _thread_client()
            try:
                return (p_key, _client_perform_json(local_client, 'GET', f'/projects/{p_key}/scenarios/'))
            except Exception:
                return (p_key, None)

        scenario_project_keys = []
        for meta in project_info.values():
            p_key = str(meta.get('key') or meta.get('projectKey') or '')
            if p_key:
                scenario_project_keys.append(p_key)

        scenario_workers = min(_parallel_workers(5), max(1, len(scenario_project_keys)))
        scenario_results: List[Tuple[str, Optional[list]]] = []
        if scenario_workers <= 1:
            for p_key in scenario_project_keys:
                scenario_results.append(_fetch_project_scenarios(p_key))
        else:
            with ThreadPoolExecutor(max_workers=scenario_workers) as pool:
                futures = {pool.submit(_fetch_project_scenarios, p_key): p_key for p_key in scenario_project_keys}
                for future in as_completed(futures):
                    try:
                        scenario_results.append(future.result())
                    except Exception:
                        scenario_results.append((futures[future], None))

        def _parse_trigger_period_minutes(period: Any) -> Optional[float]:
            if isinstance(period, (int, float)) and period > 0:
                return float(period)
            return None

        for p_key, bulk_scenarios in scenario_results:
            if not isinstance(bulk_scenarios, list):
                continue
            meta = project_info.get(p_key) or {}
            active_scenarios: List[Dict[str, Any]] = []
            high_freq_scenarios: List[Dict[str, Any]] = []
            failing_scenarios: List[Dict[str, Any]] = []
            for sc in bulk_scenarios:
                if not isinstance(sc, dict):
                    continue
                sc_id = str(sc.get('id') or '')
                sc_name = str(sc.get('name') or sc_id or '')

                # Check for failing last run (applies to all scenarios, not just active)
                last_run = sc.get('lastScenarioRun') or {}
                if isinstance(last_run, dict):
                    result = last_run.get('result') or {}
                    outcome = str((result.get('outcome') if isinstance(result, dict) else '') or '').upper()
                    if outcome in ('FAILED', 'ABORTED'):
                        failing_scenarios.append({
                            'id': sc_id,
                            'name': sc_name,
                            'type': str(sc.get('type') or ''),
                            'lastOutcome': outcome,
                        })

                if not sc.get('active'):
                    continue
                triggers = sc.get('triggers') or []
                min_period_minutes: Optional[float] = None
                for trigger in triggers:
                    if not isinstance(trigger, dict):
                        continue
                    params = trigger.get('params') or {}
                    if isinstance(params, dict):
                        period = params.get('repeatEvery') or params.get('frequency') or params.get('period')
                        minutes = _parse_trigger_period_minutes(period)
                        if minutes and (min_period_minutes is None or minutes < min_period_minutes):
                            min_period_minutes = minutes
                sc_entry = {
                    'id': sc_id,
                    'name': sc_name,
                    'type': str(sc.get('type') or ''),
                    'triggerCount': len(triggers),
                }
                active_scenarios.append(sc_entry)
                if min_period_minutes is not None and min_period_minutes < 30:
                    high_freq_scenarios.append({
                        **sc_entry,
                        'minTriggerMinutes': round(min_period_minutes, 1),
                    })
            if active_scenarios:
                projects_with_active_scenarios.add(p_key)
                auto_scenario_count += len(active_scenarios)
                owner = str(meta.get('owner') or 'Unknown')
                recipient = auto_scenario_recipients_map.setdefault(
                    owner,
                    {
                        'recipientKey': owner,
                        'owner': owner,
                        'email': user_email_by_login.get(owner, owner),
                        'projectKeys': [],
                        'codeEnvNames': [],
                        'usageDetails': [],
                        'projects': [],
                    },
                )
                recipient['projectKeys'].append(p_key)
                recipient['projects'].append({
                    'projectKey': p_key,
                    'name': str(meta.get('name') or p_key),
                    'autoScenarioCount': len(active_scenarios),
                    'autoScenarios': active_scenarios,
                })
            if high_freq_scenarios:
                scenario_frequency_count += len(high_freq_scenarios)
                owner = str(meta.get('owner') or 'Unknown')
                recipient = scenario_frequency_recipients_map.setdefault(
                    owner,
                    {
                        'recipientKey': owner,
                        'owner': owner,
                        'email': user_email_by_login.get(owner, owner),
                        'projectKeys': [],
                        'codeEnvNames': [],
                        'usageDetails': [],
                        'projects': [],
                    },
                )
                recipient['projectKeys'].append(p_key)
                recipient['projects'].append({
                    'projectKey': p_key,
                    'name': str(meta.get('name') or p_key),
                    'autoScenarioCount': len(high_freq_scenarios),
                    'autoScenarios': high_freq_scenarios,
                })
            if failing_scenarios:
                scenario_failing_count += len(failing_scenarios)
                owner = str(meta.get('owner') or 'Unknown')
                recipient = scenario_failing_recipients_map.setdefault(
                    owner,
                    {
                        'recipientKey': owner,
                        'owner': owner,
                        'email': user_email_by_login.get(owner, owner),
                        'projectKeys': [],
                        'codeEnvNames': [],
                        'usageDetails': [],
                        'projects': [],
                    },
                )
                recipient['projectKeys'].append(p_key)
                recipient['projects'].append({
                    'projectKey': p_key,
                    'name': str(meta.get('name') or p_key),
                    'autoScenarioCount': len(failing_scenarios),
                    'autoScenarios': failing_scenarios,
                })

        def _finalize_recipients(recipients_map: Dict[str, Dict[str, Any]], sort_key: str = 'projectKeys') -> List[Dict[str, Any]]:
            result = []
            for recipient in recipients_map.values():
                pkeys = sorted(set(recipient.get('projectKeys') or []))
                result.append({
                    **recipient,
                    'projectKeys': pkeys,
                    'codeEnvNames': sorted(set(recipient.get('codeEnvNames') or [])),
                    'usageDetails': _dedupe_usage_entries(recipient.get('usageDetails') or []),
                    'projectKeyForSend': pkeys[0] if pkeys else None,
                })
            result.sort(key=lambda r: len(r.get(sort_key) or []), reverse=True)
            return result

        auto_scenario_recipients = _finalize_recipients(auto_scenario_recipients_map)
        scenario_frequency_recipients = _finalize_recipients(scenario_frequency_recipients_map)
        scenario_failing_recipients = _finalize_recipients(scenario_failing_recipients_map)

        # ── New campaigns (zero new API calls) ──

        # 1. Disabled user projects
        disabled_user_recipients_map: Dict[str, Dict[str, Any]] = {}
        disabled_user_project_count = 0
        for row in project_rows:
            owner = str(row.get('owner') or 'Unknown')
            if owner not in disabled_user_logins and not owner.startswith('api:'):
                continue
            disabled_user_project_count += 1
            recipient = disabled_user_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'totalGB': row.get('totalGB'),
            })
        disabled_user_recipients = _finalize_recipients(disabled_user_recipients_map)

        # 2. Deprecated code envs (Python 2.x, 3.6, 3.7)
        deprecated_code_env_recipients_map: Dict[str, Dict[str, Any]] = {}
        deprecated_code_env_count = 0
        for env_meta in env_meta_by_key.values():
            py_version = str(env_meta.get('pythonVersion') or '')
            if not py_version:
                continue
            is_deprecated = (
                py_version.startswith('2.') or
                py_version.startswith('3.6') or
                py_version.startswith('3.7')
            )
            if not is_deprecated:
                continue
            deprecated_code_env_count += 1
            owner = str(env_meta.get('owner') or 'Unknown')
            recipient = deprecated_code_env_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                    'codeEnvs': [],
                },
            )
            env_name = str(env_meta.get('name') or '')
            recipient['codeEnvNames'].append(env_name)
            impacted_keys = sorted(env_meta.get('projectKeys') or set())
            recipient['projectKeys'].extend(impacted_keys)
            recipient['codeEnvs'].append({
                'key': str(env_meta.get('key') or ''),
                'name': env_name,
                'language': str(env_meta.get('language') or ''),
                'pythonVersion': py_version,
                'impactedProjects': impacted_keys,
            })
        deprecated_code_env_recipients = _finalize_recipients(deprecated_code_env_recipients_map, 'codeEnvNames')

        # 3. Projects missing default code env
        default_code_env_recipients_map: Dict[str, Dict[str, Any]] = {}
        default_code_env_missing_count = 0
        for row in project_rows:
            project_key = str(row.get('projectKey') or '')
            meta = project_info.get(project_key) or {}
            if meta.get('defaultPythonEnv'):
                continue
            code_env_count = _coerce_int(row.get('codeEnvCount'), 0)
            if code_env_count == 0:
                continue
            default_code_env_missing_count += 1
            owner = str(row.get('owner') or 'Unknown')
            recipient = default_code_env_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'codeEnvCount': code_env_count,
            })
        default_code_env_recipients = _finalize_recipients(default_code_env_recipients_map)

        # 4. Empty projects (no code envs, no code studios, tiny size)
        empty_project_recipients_map: Dict[str, Dict[str, Any]] = {}
        empty_project_count = 0
        for row in project_rows:
            code_env_count = _coerce_int(row.get('codeEnvCount'), 0)
            code_studio_count = _coerce_int(row.get('codeStudioCount'), 0)
            total_bytes = _coerce_int(row.get('totalBytes'), 0)
            usage_breakdown = row.get('usageBreakdown') or {}
            total_objects = sum(_coerce_int(v, 0) for v in usage_breakdown.values())
            if code_env_count > 0 or code_studio_count > 0 or total_bytes > 1048576 or total_objects > 0:
                continue
            empty_project_count += 1
            owner = str(row.get('owner') or 'Unknown')
            recipient = empty_project_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'totalGB': row.get('totalGB'),
            })
        empty_project_recipients = _finalize_recipients(empty_project_recipients_map)

        # 5. Large flow projects (many objects)
        large_flow_recipients_map: Dict[str, Dict[str, Any]] = {}
        large_flow_count = 0
        large_flow_threshold = 100
        for row in project_rows:
            usage_breakdown = row.get('usageBreakdown') or {}
            total_objects = sum(_coerce_int(v, 0) for v in usage_breakdown.values())
            if total_objects < large_flow_threshold:
                continue
            large_flow_count += 1
            owner = str(row.get('owner') or 'Unknown')
            recipient = large_flow_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'totalObjects': total_objects,
            })
        large_flow_recipients = _finalize_recipients(large_flow_recipients_map)

        # 6. Orphan notebooks (high notebook count relative to recipes)
        orphan_notebook_recipients_map: Dict[str, Dict[str, Any]] = {}
        orphan_notebook_count = 0
        for row in project_rows:
            usage_breakdown = row.get('usageBreakdown') or {}
            notebook_count = _coerce_int(usage_breakdown.get('NOTEBOOK') or usage_breakdown.get('notebook'), 0)
            recipe_count = _coerce_int(usage_breakdown.get('RECIPE') or usage_breakdown.get('recipe'), 0)
            if notebook_count < 5 or notebook_count <= recipe_count:
                continue
            orphan_notebook_count += 1
            owner = str(row.get('owner') or 'Unknown')
            recipient = orphan_notebook_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            project_key = str(row.get('projectKey') or '')
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'notebookCount': notebook_count,
                'recipeCount': recipe_count,
            })
        orphan_notebook_recipients = _finalize_recipients(orphan_notebook_recipients_map)

        # 7. Inactive projects (no recent modification, no active scenarios, no deployed bundles)
        inactive_project_recipients_map: Dict[str, Dict[str, Any]] = {}
        inactive_project_count = 0
        inactive_threshold_days = 180
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        for row in project_rows:
            project_key = str(row.get('projectKey') or '')
            if not project_key:
                continue
            if project_key in projects_with_active_scenarios:
                continue
            bundle_count = _coerce_int(row.get('bundleCount'), 0)
            if bundle_count > 0:
                continue
            meta = project_info.get(project_key) or {}
            last_modified_ms = meta.get('lastModifiedOn')
            if last_modified_ms is None:
                continue
            try:
                days_inactive = (now_ms - int(last_modified_ms)) / (1000 * 60 * 60 * 24)
            except (TypeError, ValueError):
                continue
            if days_inactive < inactive_threshold_days:
                continue
            inactive_project_count += 1
            owner = str(row.get('owner') or 'Unknown')
            recipient = inactive_project_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'projects': [],
                },
            )
            if project_key:
                recipient['projectKeys'].append(project_key)
            recipient['projects'].append({
                'projectKey': project_key,
                'name': row.get('name'),
                'daysInactive': round(days_inactive),
            })
        inactive_project_recipients = _finalize_recipients(inactive_project_recipients_map)

        # 8. Unused code envs (zero usages, excluding plugin-managed and DSS-internal)
        unused_code_env_recipients_map: Dict[str, Dict[str, Any]] = {}
        unused_code_env_count = 0
        _EXCLUDED_DEPLOY_MODES = {'PLUGIN_MANAGED', 'DSS_INTERNAL'}
        for env_key, env_meta in env_meta_by_key.items():
            if _coerce_int(env_meta.get('usageCount'), -1) != 0:
                continue
            deploy_mode = str(env_meta.get('deploymentMode') or '').strip().upper()
            if deploy_mode in _EXCLUDED_DEPLOY_MODES:
                continue
            unused_code_env_count += 1
            owner = str(env_meta.get('owner') or 'Unknown')
            recipient = unused_code_env_recipients_map.setdefault(
                owner,
                {
                    'recipientKey': owner,
                    'owner': owner,
                    'email': user_email_by_login.get(owner, owner),
                    'projectKeys': [],
                    'codeEnvNames': [],
                    'usageDetails': [],
                    'codeEnvs': [],
                },
            )
            env_name = str(env_meta.get('name') or '')
            recipient['codeEnvNames'].append(env_name)
            recipient['codeEnvs'].append({
                'key': env_key,
                'name': env_name,
                'language': str(env_meta.get('language') or 'python'),
            })
        unused_code_env_recipients = _finalize_recipients(unused_code_env_recipients_map)

        mail_channels = _list_mail_channels(client)

        all_campaign_ids = [
            'project', 'code_env', 'code_studio', 'auto_scenario',
            'disabled_user', 'deprecated_code_env', 'default_code_env',
            'overshared_project', 'scenario_frequency', 'empty_project',
            'large_flow', 'orphan_notebooks', 'scenario_failing',
            'inactive_project', 'unused_code_env',
        ]

        app.logger.info(
            "[tools] outreach-data loaded projects=%s unhealthyProjects=%s unhealthyCodeEnvs=%s codeStudio=%s autoScenarios=%s disabledUser=%s deprecatedEnv=%s defaultEnv=%s scenarioFreq=%s scenarioFailing=%s empty=%s largeFlow=%s orphanNotebooks=%s inactive=%s unusedCodeEnv=%s channels=%s",
            len(project_rows),
            len(unhealthy_projects),
            len(unhealthy_code_envs),
            len(unhealthy_code_studio_projects),
            auto_scenario_count,
            disabled_user_project_count,
            deprecated_code_env_count,
            default_code_env_missing_count,
            scenario_frequency_count,
            scenario_failing_count,
            empty_project_count,
            large_flow_count,
            orphan_notebook_count,
            inactive_project_count,
            unused_code_env_count,
            len(mail_channels),
        )

        return {
            'summary': {
                'projectCount': len(project_rows),
                'unhealthyProjectCount': len(unhealthy_projects),
                'unhealthyCodeEnvCount': len(unhealthy_code_envs),
                'unhealthyCodeStudioProjectCount': len(unhealthy_code_studio_projects),
                'autoScenarioCount': auto_scenario_count,
                'projectRecipientCount': len(project_recipients),
                'codeEnvRecipientCount': len(code_env_recipients),
                'codeStudioRecipientCount': len(code_studio_recipients),
                'autoScenarioRecipientCount': len(auto_scenario_recipients),
                'disabledUserProjectCount': disabled_user_project_count,
                'deprecatedCodeEnvCount': deprecated_code_env_count,
                'defaultCodeEnvMissingCount': default_code_env_missing_count,
                'scenarioFrequencyCount': scenario_frequency_count,
                'emptyProjectCount': empty_project_count,
                'largeFlowProjectCount': large_flow_count,
                'orphanNotebookProjectCount': orphan_notebook_count,
                'scenarioFailingCount': scenario_failing_count,
                'inactiveProjectCount': inactive_project_count,
                'unusedCodeEnvCount': unused_code_env_count,
            },
            'mailChannels': mail_channels,
            'templates': {cid: _default_email_template(cid) for cid in all_campaign_ids},
            'unhealthyProjects': unhealthy_projects,
            'unhealthyCodeEnvs': unhealthy_code_envs,
            'unhealthyCodeStudioProjects': unhealthy_code_studio_projects,
            'projectRecipients': project_recipients,
            'codeEnvRecipients': code_env_recipients,
            'codeStudioRecipients': code_studio_recipients,
            'autoScenarioRecipients': auto_scenario_recipients,
            'disabledUserRecipients': disabled_user_recipients,
            'deprecatedCodeEnvRecipients': deprecated_code_env_recipients,
            'defaultCodeEnvRecipients': default_code_env_recipients,
            'oversharedProjectRecipients': [],
            'scenarioFrequencyRecipients': scenario_frequency_recipients,
            'emptyProjectRecipients': empty_project_recipients,
            'largeFlowRecipients': large_flow_recipients,
            'orphanNotebookRecipients': orphan_notebook_recipients,
            'scenarioFailingRecipients': scenario_failing_recipients,
            'inactiveProjectRecipients': inactive_project_recipients,
            'unusedCodeEnvRecipients': unused_code_env_recipients,
        }

    data = _cache_get('tools_outreach_data', 20, loader)

    # ── Tracking: ingest run on fresh cache load ──
    cache_entry = _CACHE.get('tools_outreach_data')
    if cache_entry and not cache_entry.get('_tracking_ingested'):
        db = _get_tracking_db()
        if db is not None:
            try:
                run_id = _do_tracking_ingest(db, data)
                cache_entry['_tracking_ingested'] = True
                app.logger.info("[tracking] ingested run %d", run_id)
            except Exception as exc:
                app.logger.warning("[tracking] ingest failed: %s", exc)

    return jsonify(data)


@app.route('/api/tools/email/preview', methods=['POST'])
def api_tools_email_preview():
    payload = request.get_json(silent=True) or {}
    _valid_campaigns = {
        'project', 'code_env', 'code_studio', 'auto_scenario',
        'disabled_user', 'deprecated_code_env', 'default_code_env',
        'overshared_project', 'scenario_frequency', 'empty_project',
        'large_flow', 'orphan_notebooks', 'scenario_failing',
        'inactive_project', 'unused_code_env',
    }
    campaign = str(payload.get('campaign') or 'project').strip().lower()
    if campaign not in _valid_campaigns:
        campaign = 'project'

    # Block disabled campaigns
    db = _get_tracking_db()
    if db is not None and campaign in db.get_disabled_campaigns():
        return jsonify({'error': 'Campaign is disabled', 'campaign': campaign}), 403

    template_payload = payload.get('template') if isinstance(payload.get('template'), dict) else {}
    defaults = _default_email_template(campaign)
    subject_template = str(template_payload.get('subject') or defaults['subject'])
    body_template = str(template_payload.get('body') or defaults['body'])
    recipients = payload.get('recipients')
    if not isinstance(recipients, list):
        recipients = []

    previews: List[Dict[str, Any]] = []
    for recipient in recipients:
        if not isinstance(recipient, dict):
            continue

        owner = str(recipient.get('owner') or recipient.get('recipientKey') or 'Unknown')
        to_email = str(recipient.get('email') or owner).strip()
        project_keys = sorted({str(key) for key in (recipient.get('projectKeys') or []) if str(key).strip()})
        code_env_names = sorted({str(name) for name in (recipient.get('codeEnvNames') or []) if str(name).strip()})
        usage_details = [
            usage for usage in (recipient.get('usageDetails') or [])
            if isinstance(usage, dict)
        ]
        usage_details = _dedupe_usage_entries(usage_details)
        if campaign == 'project':
            object_lines = _usage_lines_grouped_by_project(usage_details)
        else:
            object_lines = _usage_lines_grouped_by_code_env(usage_details)

        variables = {
            'owner': owner,
            'owner_email': to_email,
            'project_count': str(len(project_keys)),
            'code_env_count': str(len(code_env_names)),
            'object_count': str(len(usage_details)),
            'project_list': '\n'.join([f"- {key}" for key in project_keys]) if project_keys else '- none',
            'code_env_list': '\n'.join([f"- {name}" for name in code_env_names]) if code_env_names else '- none',
            'objects_list': '\n'.join(object_lines),
            'project_keys': ', '.join(project_keys) if project_keys else 'none',
            'code_envs': ', '.join(code_env_names) if code_env_names else 'none',
        }

        projects_data = recipient.get('projects') or []
        code_studio_lines = []
        for proj in projects_data:
            if not isinstance(proj, dict):
                continue
            pname = str(proj.get('name') or proj.get('projectKey') or 'Unknown')
            pkey = str(proj.get('projectKey') or '')
            cs_count = _coerce_int(proj.get('codeStudioCount'), 0)
            code_studio_lines.append(f"- {pname} ({pkey}): {cs_count} code studios")
        variables['code_studio_list'] = '\n'.join(code_studio_lines) if code_studio_lines else '- none'

        scenario_lines = []
        for proj in projects_data:
            if not isinstance(proj, dict):
                continue
            auto_scenarios = proj.get('autoScenarios') or []
            if not auto_scenarios:
                continue
            pname = str(proj.get('name') or proj.get('projectKey') or 'Unknown')
            pkey = str(proj.get('projectKey') or '')
            scenario_lines.append(f"Project: {pname} ({pkey})")
            for sc in auto_scenarios:
                if not isinstance(sc, dict):
                    continue
                sc_name = str(sc.get('name') or sc.get('id') or 'Unknown')
                sc_type = str(sc.get('type') or 'unknown')
                trigger_count = _coerce_int(sc.get('triggerCount'), 0)
                scenario_lines.append(f"  - {sc_name} (type={sc_type}, triggers={trigger_count})")
        variables['scenario_list'] = '\n'.join(scenario_lines) if scenario_lines else '- none'

        inactive_project_lines = []
        for proj in projects_data:
            if not isinstance(proj, dict):
                continue
            pname = str(proj.get('name') or proj.get('projectKey') or 'Unknown')
            pkey = str(proj.get('projectKey') or '')
            days_inactive = _coerce_int(proj.get('daysInactive'), 0)
            if days_inactive > 0:
                inactive_project_lines.append(f"- {pname} ({pkey}): inactive for {days_inactive} days")
            else:
                inactive_project_lines.append(f"- {pname} ({pkey})")
        variables['inactive_project_list'] = '\n'.join(inactive_project_lines) if inactive_project_lines else '- none'

        # Build project_env_list: project → code envs → objects (where used)
        # Group usage_details by projectKey → codeEnvName → object lines
        _pel_grouped: Dict[str, Dict[str, List[str]]] = {}
        _pel_seen: set = set()
        for u in usage_details:
            if not isinstance(u, dict):
                continue
            pk = str(u.get('projectKey') or '').strip()
            ce = str(u.get('codeEnvName') or u.get('codeEnvKey') or '').strip()
            if not pk or not ce:
                continue
            usage_type = str(u.get('usageType') or '').strip().upper()
            _pel_grouped.setdefault(pk, {}).setdefault(ce, [])
            # Skip PROJECT-level defaults for object lines (they have no real object)
            if usage_type == 'PROJECT':
                continue
            obj_label = _email_object_type_label(u.get('objectType'), usage_type)
            obj_name = str(u.get('objectName') or u.get('objectId') or '').strip()
            if obj_name:
                sig = (pk, ce.lower(), obj_label.lower(), obj_name)
                if sig not in _pel_seen:
                    _pel_seen.add(sig)
                    _pel_grouped[pk][ce].append(f"      {obj_label}: {obj_name}")

        project_env_lines: List[str] = []
        for proj in projects_data:
            if not isinstance(proj, dict):
                continue
            pkey = str(proj.get('projectKey') or '')
            pname = str(proj.get('name') or pkey)
            ce_count = _coerce_int(proj.get('codeEnvCount'), 0)
            header = pname if pname == pkey else f"{pname} ({pkey})"
            if ce_count:
                header += f" — {ce_count} code envs"
            project_env_lines.append(header)
            env_data = _pel_grouped.get(pkey, {})
            if env_data:
                for env_name in sorted(env_data.keys(), key=lambda e: e.lower()):
                    project_env_lines.append(f"  - {env_name}")
                    for obj_line in sorted(env_data[env_name], key=lambda l: l.lower()):
                        project_env_lines.append(obj_line)
            else:
                # Fallback: use per-project code env names (from projects array)
                proj_env_names = sorted(set(str(n) for n in (proj.get('codeEnvNames') or []) if str(n).strip()))
                for name in proj_env_names:
                    project_env_lines.append(f"  - {name}")
        variables['project_env_list'] = '\n'.join(project_env_lines) if project_env_lines else '- none'

        # Build rich HTML for all list variables
        _rich_html_map = {
            'project_env_list': (_PROJECT_ENV_MARKER, _build_project_env_html(projects_data, _pel_grouped)),
            'project_list': (_PROJECT_LIST_MARKER, _build_items_html(project_keys)),
            'code_env_list': (_CODE_ENV_LIST_MARKER, _build_items_html(code_env_names, accent='#00897b')),
            'objects_list': (_OBJECTS_LIST_MARKER, _build_objects_html(usage_details, group_by_project=(campaign == 'project'))),
            'code_studio_list': (_CODE_STUDIO_LIST_MARKER, _build_code_studio_html(projects_data)),
            'scenario_list': (_SCENARIO_LIST_MARKER, _build_scenario_html(projects_data)),
            'inactive_project_list': (_INACTIVE_LIST_MARKER, _build_inactive_projects_html(projects_data)),
        }

        _preview_debug = {
            'usageDetailsCount': len(usage_details),
            'usageTypes': sorted({str(u.get('usageType') or '') for u in usage_details}),
            'envGroups': {k: list(v.keys()) for k, v in _pel_grouped.items()},
            'projectsInRecipient': [
                {'projectKey': proj.get('projectKey'), 'codeEnvNames': proj.get('codeEnvNames')}
                for proj in projects_data if isinstance(proj, dict)
            ],
        }
        app.logger.info("[tools] email-preview campaign=%s owner=%s debug=%s", campaign, owner, _preview_debug)

        # Swap list variables with markers for rich HTML injection
        for _var_name, (_marker, _html_val) in _rich_html_map.items():
            if '{{' + _var_name + '}}' in body_template:
                variables[_var_name] = _marker

        rendered_body_text = _render_template_text(body_template, variables)
        body_html = _text_body_to_html(rendered_body_text)

        # Inject rich HTML for all list variables
        for _var_name, (_marker, _html_val) in _rich_html_map.items():
            if _marker in body_html:
                body_html = body_html.replace(_marker, _html_val)
        # Replace footer placeholders in the final HTML wrapper
        admin_email = str(payload.get('adminEmail') or 'dss-admin@your-company.com').strip()
        chat_channel_url = str(payload.get('chatChannelUrl') or '#').strip()
        body_html = body_html.replace('{{admin_email}}', admin_email)
        body_html = body_html.replace('{{chat_channel_url}}', chat_channel_url)
        preview = {
            'recipientKey': str(recipient.get('recipientKey') or owner),
            'owner': owner,
            'to': to_email,
            'projectKeys': project_keys,
            'codeEnvNames': code_env_names,
            'projectKeyForSend': recipient.get('projectKeyForSend') or (project_keys[0] if project_keys else None),
            'objectCount': len(usage_details),
            'subject': _render_template_text(subject_template, variables),
            'body': body_html,
            'usageDetails': usage_details,
            '_debug': _preview_debug,
        }

        # ── Tracking: resolve linked issue IDs ──
        db = _get_tracking_db()
        if db is not None:
            try:
                overview = (_CACHE.get('overview', {}).get('value') or {})
                instance_info = overview.get('instanceInfo') or {}
                install_id = instance_info.get('installId') or ''
                instance_url = instance_info.get('instanceUrl') or ''
                import hashlib
                inst_id = install_id or (hashlib.sha256(instance_url.encode()).hexdigest()[:16] if instance_url else 'unknown')

                entity_keys = []
                if campaign in ('auto_scenario', 'scenario_frequency', 'scenario_failing'):
                    for proj in projects_data:
                        if not isinstance(proj, dict):
                            continue
                        pkey_sc = str(proj.get('projectKey') or '')
                        for sc in (proj.get('autoScenarios') or []):
                            sc_id = str(sc.get('id') or '')
                            if pkey_sc and sc_id:
                                entity_keys.append(('scenario', f'{pkey_sc}:{sc_id}'))
                elif campaign == 'deprecated_code_env':
                    for env_name in code_env_names:
                        entity_keys.append(('code_env', env_name))
                else:
                    for pkey in project_keys:
                        entity_keys.append(('project', pkey))

                linked_ids = db.resolve_issue_ids_for_preview(inst_id, campaign, entity_keys)
                preview['linkedIssueIds'] = linked_ids
            except Exception:
                preview['linkedIssueIds'] = []
        else:
            preview['linkedIssueIds'] = []

        previews.append(preview)

    app.logger.info("[tools] preview campaign=%s recipients=%s", campaign, len(previews))
    return jsonify({
        'campaign': campaign,
        'template': {
            'subject': subject_template,
            'body': body_template,
        },
        'previews': previews,
        'count': len(previews),
    })


@app.route('/api/tools/email/send', methods=['POST'])
def api_tools_email_send():
    client = dataiku.api_client()
    payload = request.get_json(silent=True) or {}
    campaign = str(payload.get('campaign') or 'project').strip().lower()

    # Block disabled campaigns
    tdb = _get_tracking_db()
    if tdb is not None and campaign in tdb.get_disabled_campaigns():
        return jsonify({'error': 'Campaign is disabled', 'campaign': campaign}), 403

    requested_channel = str(payload.get('channelId') or '').strip() or None
    plain_text = _parse_bool(payload.get('plainText'), True)

    previews = payload.get('previews')
    if not isinstance(previews, list):
        previews = []

    channels = _list_mail_channels(client)
    if not channels:
        app.logger.warning("[tools] send failed: no DSS mail channel configured")
        return jsonify({'error': 'No DSS mail channel configured'}), 400

    selected = channels[0]
    if requested_channel:
        for channel in channels:
            if channel.get('id') == requested_channel:
                selected = channel
                break
    selected_id = str(selected.get('id') or '')

    channel_obj = _get_mail_channel(client, selected_id)
    if channel_obj is None:
        app.logger.warning("[tools] send failed: cannot resolve mail channel %s", selected_id)
        return jsonify({'error': f'Unable to load mail channel: {selected_id}'}), 400

    results: List[Dict[str, Any]] = []
    sent_count = 0
    for preview in previews:
        if not isinstance(preview, dict):
            continue
        recipient_key = str(preview.get('recipientKey') or '')
        to_email = str(preview.get('to') or '').strip()
        project_key = str(preview.get('projectKeyForSend') or '').strip()
        subject = str(preview.get('subject') or '').strip()
        body = str(preview.get('body') or '')

        to_email = re.sub(r'[\r\n]', '', to_email)
        subject = re.sub(r'[\r\n]', '', subject)
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', to_email):
            results.append({
                'recipientKey': recipient_key,
                'to': to_email,
                'projectKeyForSend': project_key,
                'status': 'error',
                'error': 'Invalid email address format',
            })
            continue

        if not to_email or not project_key or not subject:
            results.append({
                'recipientKey': recipient_key,
                'to': to_email,
                'projectKeyForSend': project_key,
                'status': 'error',
                'error': 'Missing to/projectKeyForSend/subject',
            })
            continue

        try:
            try:
                channel_obj.send(project_key, [to_email], subject, body, plain_text=plain_text)
            except TypeError:
                try:
                    channel_obj.send(
                        project_key=project_key,
                        to=[to_email],
                        subject=subject,
                        body=body,
                        plain_text=plain_text,
                    )
                except TypeError:
                    channel_obj.send(project_key, [to_email], subject, body)
            sent_count += 1
            results.append({
                'recipientKey': recipient_key,
                'to': to_email,
                'projectKeyForSend': project_key,
                'status': 'sent',
            })
        except Exception as exc:
            app.logger.warning("[tools] send failed recipient=%s to=%s: %s", recipient_key, to_email, exc)
            results.append({
                'recipientKey': recipient_key,
                'to': to_email,
                'projectKeyForSend': project_key,
                'status': 'error',
                'error': str(exc),
            })

    # ── Tracking: record email sends ──
    db = _get_tracking_db()
    if db is not None:
        try:
            # Resolve instance_id for recording
            overview = (_CACHE.get('overview', {}).get('value') or {})
            instance_info = overview.get('instanceInfo') or {}
            install_id = instance_info.get('installId') or ''
            instance_url = instance_info.get('instanceUrl') or ''
            import hashlib
            inst_id = install_id or (hashlib.sha256(instance_url.encode()).hexdigest()[:16] if instance_url else 'unknown')

            # Get latest run_id for this instance
            runs = db.list_runs(instance_id=inst_id, limit=1)
            latest_run_id = runs[0]['run_id'] if runs else None

            for i, result_item in enumerate(results):
                preview_item = previews[i] if i < len(previews) else {}
                linked_ids = preview_item.get('linkedIssueIds') or []
                db.record_email_send(
                    run_id=latest_run_id,
                    campaign_id=campaign,
                    recipient_login=str(result_item.get('recipientKey') or ''),
                    recipient_email=str(result_item.get('to') or ''),
                    status=str(result_item.get('status') or 'error'),
                    subject=str(preview_item.get('subject') or ''),
                    linked_issue_ids=linked_ids,
                    error_message=result_item.get('error'),
                    channel_id=selected_id,
                )
        except Exception as exc:
            app.logger.warning("[tracking] record_email_send failed: %s", exc)

    app.logger.info(
        "[tools] send campaign=%s channel=%s requested=%s sent=%s total=%s",
        campaign,
        selected_id,
        len(previews),
        sent_count,
        len(results),
    )
    return jsonify({
        'campaign': campaign,
        'channelId': selected_id,
        'requestedCount': len(previews),
        'sentCount': sent_count,
        'results': results,
    })


# ── Tracking API endpoints ──


def _tracking_instance_id() -> str:
    """Resolve the current instance_id from cached overview data."""
    overview = (_CACHE.get('overview', {}).get('value') or {})
    instance_info = overview.get('instanceInfo') or {}
    install_id = instance_info.get('installId') or ''
    instance_url = instance_info.get('instanceUrl') or ''
    if install_id:
        return install_id
    if instance_url:
        import hashlib
        return hashlib.sha256(instance_url.encode()).hexdigest()[:16]
    return 'unknown'


@app.route('/api/tracking/refresh', methods=['POST'])
def api_tracking_refresh():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    if not _tracking_available:
        return jsonify({'error': 'Tracking module not loaded'}), 501
    # Invalidate outreach data cache to force fresh DSS API calls
    _CACHE.pop('tools_outreach_data', None)
    _CACHE.pop('project_code_env_usage_full', None)
    # Load fresh outreach data (populates _CACHE['tools_outreach_data'])
    try:
        with app.test_request_context('/api/tools/outreach-data'):
            api_tools_outreach_data()
    except Exception as exc:
        app.logger.warning("[tracking refresh] outreach-data failed: %s", exc)
        return jsonify({'error': 'Failed to load outreach data: %s' % exc}), 500
    # Run tracking ingest directly (bypasses _tracking_ingested guard)
    cache_entry = _CACHE.get('tools_outreach_data')
    data = cache_entry.get('value') if cache_entry else None
    if not data:
        return jsonify({'error': 'No outreach data after refresh'}), 500
    try:
        run_id = _do_tracking_ingest(db, data)
        return jsonify({'ok': True, 'run_id': run_id})
    except Exception as exc:
        app.logger.warning("[tracking refresh] ingest failed: %s", exc, exc_info=True)
        return jsonify({'error': 'Ingest failed: %s' % exc}), 500


@app.route('/api/tracking/runs')
def api_tracking_runs():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    instance_id = request.args.get('instance_id') or _tracking_instance_id()
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    runs = db.list_runs(instance_id=instance_id, limit=limit, offset=offset)
    return jsonify({'runs': runs, 'count': len(runs)})


@app.route('/api/tracking/runs/<int:run_id>')
def api_tracking_run_detail(run_id):
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    run = db.get_run(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    return jsonify(run)


@app.route('/api/tracking/issues')
def api_tracking_issues():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    instance_id = request.args.get('instance_id') or _tracking_instance_id()
    status = request.args.get('status')
    campaign_id = request.args.get('campaign_id')
    owner_login = request.args.get('owner_login')
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    issues = db.list_issues(
        instance_id=instance_id,
        status=status,
        campaign_id=campaign_id,
        owner_login=owner_login,
        limit=limit,
        offset=offset,
    )
    disabled = db.get_disabled_campaigns()
    if disabled:
        issues = [i for i in issues if i.get('campaign_id') not in disabled]
    return jsonify({'issues': issues, 'count': len(issues)})


@app.route('/api/tracking/issues/<int:issue_id>')
def api_tracking_issue_detail(issue_id):
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    issue = db.get_issue(issue_id)
    if not issue:
        return jsonify({'error': 'Issue not found'}), 404
    return jsonify(issue)


@app.route('/api/tracking/users')
def api_tracking_users_all():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    instance_id = request.args.get('instance_id')
    rows = db.list_all_user_compliance(instance_id)
    disabled = db.get_disabled_campaigns()
    users = {}
    for r in rows:
        if disabled and r.get('campaign_id') in disabled:
            continue
        login = r['owner_login']
        if login not in users:
            users[login] = {'login': login, 'email': r['owner_email'], 'campaigns': []}
        users[login]['campaigns'].append(r)
    return jsonify({'users': list(users.values())})


@app.route('/api/tracking/users/<login>')
def api_tracking_user_compliance(login):
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    rows = db.get_user_compliance(login)
    return jsonify({'login': login, 'campaigns': rows})


@app.route('/api/tracking/issues/<int:issue_id>/notes', methods=['POST'])
def api_tracking_add_note(issue_id):
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    payload = request.get_json(silent=True) or {}
    note_text = str(payload.get('note') or '').strip()
    if not note_text:
        return jsonify({'error': 'Note text is required'}), 400
    created_by = str(payload.get('created_by') or '').strip() or None
    note_id = db.add_issue_note(issue_id, note_text, created_by=created_by)
    return jsonify({'note_id': note_id, 'issue_id': issue_id})


@app.route('/api/tracking/compare/<int:run1>/<int:run2>')
def api_tracking_compare(run1, run2):
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    result = db.compare_runs(run1, run2)
    if 'error' in result:
        return jsonify(result), 404
    return jsonify(result)


@app.route('/api/tracking/dashboard')
def api_tracking_dashboard():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    instance_id = request.args.get('instance_id') or _tracking_instance_id()
    dashboard = db.get_dashboard(instance_id=instance_id)
    disabled = db.get_disabled_campaigns()
    if disabled and 'campaign_stats' in dashboard:
        dashboard['campaign_stats'] = [
            s for s in dashboard['campaign_stats']
            if s.get('campaign_id') not in disabled
        ]
    return jsonify(dashboard)


_ALL_CAMPAIGN_IDS = {
    'project', 'code_env', 'code_studio', 'auto_scenario',
    'scenario_frequency', 'scenario_failing', 'disabled_user',
    'deprecated_code_env', 'default_code_env', 'empty_project',
    'large_flow', 'orphan_notebooks', 'overshared_project',
    'inactive_project', 'unused_code_env',
}


@app.route('/api/tracking/campaign-settings')
def api_tracking_campaign_settings():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    stored = db.get_campaign_settings()
    # Default all campaigns to enabled, overlay stored values
    campaigns = {cid: stored.get(cid, True) for cid in _ALL_CAMPAIGN_IDS}
    return jsonify({'campaigns': campaigns})


@app.route('/api/tracking/campaign-settings', methods=['PUT'])
def api_tracking_campaign_settings_update():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    payload = request.get_json(silent=True) or {}
    campaign_id = str(payload.get('campaign_id') or '').strip()
    if campaign_id not in _ALL_CAMPAIGN_IDS:
        return jsonify({'error': 'Invalid campaign_id', 'valid': sorted(_ALL_CAMPAIGN_IDS)}), 400
    enabled = bool(payload.get('enabled', True))
    db.set_campaign_enabled(campaign_id, enabled)
    return jsonify({'ok': True, 'campaign_id': campaign_id, 'enabled': enabled})


@app.route('/api/tracking/exemptions')
def api_tracking_exemptions():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    campaign_id = request.args.get('campaign_id')
    exemptions = db.get_exemptions(campaign_id=campaign_id)
    return jsonify({'exemptions': exemptions})


@app.route('/api/tracking/exemptions', methods=['POST'])
def api_tracking_exemptions_add():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    payload = request.get_json(silent=True) or {}
    campaign_id = str(payload.get('campaign_id') or '').strip()
    if campaign_id not in _ALL_CAMPAIGN_IDS:
        return jsonify({'error': 'Invalid campaign_id', 'valid': sorted(_ALL_CAMPAIGN_IDS)}), 400
    entity_key = str(payload.get('entity_key') or '').strip()
    if not entity_key:
        return jsonify({'error': 'entity_key is required'}), 400
    reason = payload.get('reason') or None
    if reason:
        reason = str(reason).strip() or None
    exemption = db.add_exemption(campaign_id, entity_key, reason)
    return jsonify({'ok': True, 'exemption': exemption})


@app.route('/api/tracking/exemptions', methods=['DELETE'])
def api_tracking_exemptions_remove():
    db = _get_tracking_db()
    if db is None:
        return jsonify({'error': 'Tracking not available'}), 501
    payload = request.get_json(silent=True) or {}
    exemption_id = payload.get('exemption_id')
    if exemption_id is None:
        return jsonify({'error': 'exemption_id is required'}), 400
    deleted = db.remove_exemption(int(exemption_id))
    if not deleted:
        return jsonify({'error': 'Exemption not found'}), 404
    return jsonify({'ok': True})


# ── Code Env Cleaner helpers ──

def _cec_filter_envs(envs):
    """Filter out plugin-managed and DSS-internal environments."""
    return [
        e for e in envs
        if e.get("deploymentMode", "") not in ("PLUGIN_MANAGED", "DSS_INTERNAL")
    ]


def _cec_fetch_env_with_usages(client, env_info):
    """Fetch usage info for a single env and return result dict + timing."""
    env_name = env_info["envName"]
    env_lang = env_info["envLang"]
    t0 = time.time()

    try:
        usages = client._perform_json(
            "GET", "/admin/code-envs/%s/%s/usages" % (env_lang, env_name)
        )
        usage_count = len(usages) if isinstance(usages, list) else 0
    except Exception:
        usages = []
        usage_count = -1

    usage_ms = int((time.time() - t0) * 1000)

    return {
        "envName": env_name,
        "envLang": env_lang,
        "deploymentMode": env_info.get("deploymentMode", ""),
        "owner": env_info.get("owner", ""),
        "pythonInterpreter": env_info.get("pythonInterpreter", ""),
        "usageCount": usage_count,
        "usages": usages if isinstance(usages, list) else [],
    }, usage_ms


@app.route('/api/cache/clear', methods=['POST'])
def api_cache_clear():
    """Clear the in-memory cache so subsequent requests fetch fresh data."""
    with _CACHE_LOCK:
        _CACHE.clear()
    return jsonify({'ok': True})


@app.route('/api/managed-folders', methods=['GET'])
def api_managed_folders():
    """List managed folders in the current project."""
    client = dataiku.api_client()
    project_key = dataiku.default_project_key()
    project = client.get_project(project_key)
    folders = project.list_managed_folders()
    return jsonify({
        'folders': [
            {'id': f['id'], 'name': f.get('name') or f['id']}
            for f in folders
        ]
    })


@app.route('/api/tools/code-env-cleaner/scan')
def api_code_env_cleaner_scan():
    """Stream code env data via SSE for real-time progress."""
    threads = request.args.get("threads", "1", type=str)
    try:
        threads = max(1, min(20, int(threads)))
    except (ValueError, TypeError):
        threads = 1

    def generate():
        t0 = time.time()
        client = dataiku.api_client()

        try:
            all_envs = client._perform_json("GET", "/admin/code-envs/")
        except Exception as e:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": str(e)})
            return

        filtered = _cec_filter_envs(all_envs)
        list_ms = int((time.time() - t0) * 1000)

        yield "event: init\ndata: %s\n\n" % json.dumps({
            "total": len(filtered),
            "list_ms": list_ms,
            "threads": threads,
        })

        if threads <= 1:
            for i, env_info in enumerate(filtered):
                result, usage_ms = _cec_fetch_env_with_usages(client, env_info)
                result["index"] = i
                result["usage_ms"] = usage_ms
                yield "event: env\ndata: %s\n\n" % json.dumps(result)
        else:
            counter = [0]
            with ThreadPoolExecutor(max_workers=threads) as pool:
                futures = {
                    pool.submit(_cec_fetch_env_with_usages, client, env_info): env_info
                    for env_info in filtered
                }
                for future in as_completed(futures):
                    result, usage_ms = future.result()
                    result["index"] = counter[0]
                    result["usage_ms"] = usage_ms
                    counter[0] += 1
                    yield "event: env\ndata: %s\n\n" % json.dumps(result)

        total_ms = int((time.time() - t0) * 1000)
        yield "event: done\ndata: %s\n\n" % json.dumps({"total_ms": total_ms})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route('/api/tools/code-env-cleaner/<lang>/<name>', methods=['DELETE'])
def api_code_env_cleaner_delete(lang, name):
    """Backup to managed folder then delete a code env after verifying the confirmation header."""
    import tempfile

    confirm = request.headers.get("X-Confirm-Name", "")
    if confirm != name:
        return jsonify({"error": "Confirmation header does not match env name"}), 400

    folder_id = request.args.get("folderId", "").strip()
    if not folder_id:
        return jsonify({"error": "folderId query parameter is required"}), 400

    client = dataiku.api_client()
    project_key = dataiku.default_project_key()
    project = client.get_project(project_key)

    # Validate managed folder exists
    try:
        dest_folder = project.get_managed_folder(folder_id)
        dest_folder.get_definition()  # verify it exists
    except Exception as e:
        app.logger.error("[code-env-cleaner] invalid folder %s: %s", folder_id, e)
        return jsonify({"error": "Invalid managed folder: %s" % str(e)}), 400

    # Fetch the code env definition
    try:
        env_def = client._perform_json("GET", "/admin/code-envs/%s/%s/" % (lang, name))
    except Exception as e:
        app.logger.error("[code-env-cleaner] fetch failed for %s/%s: %s", lang, name, e)
        return jsonify({"error": "Failed to fetch env definition: %s" % str(e)}), 500

    # Backup first — build ZIP to temp file, upload to managed folder
    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', name)
    zip_filename = "%s.zip" % safe_name
    try:
        env_lang = lang.lower()
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=True) as tmp:
            with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
                # Directory entries (match DSS on-disk export exactly)
                for d in ["%s/", "%s/spec/", "%s/actual/"]:
                    zf.writestr(zipfile.ZipInfo(d % env_lang), "")
                # desc.json — strip owner (not present in on-disk version)
                desc = dict(env_def.get("desc") or env_def)
                desc.pop("owner", None)
                zf.writestr("%s/desc.json" % env_lang, json.dumps(desc, indent=2))
                # spec/requirements.txt
                zf.writestr("%s/spec/requirements.txt" % env_lang, env_def.get("specPackageList", ""))
                # spec/resources_init.py (field is resourcesInitScript, NOT specResourcesInit)
                zf.writestr("%s/spec/resources_init.py" % env_lang, env_def.get("resourcesInitScript", ""))
                # spec/environment.spec
                zf.writestr("%s/spec/environment.spec" % env_lang, env_def.get("specCondaEnvironment", ""))
                # actual/requirements.txt
                zf.writestr("%s/actual/requirements.txt" % env_lang, env_def.get("actualPackageList", ""))
            # Upload to managed folder
            with open(tmp.name, "rb") as f:
                dest_folder.put_file(zip_filename, f)
    except Exception as e:
        app.logger.error("[code-env-cleaner] backup/upload failed for %s/%s: %s", lang, name, e)
        return jsonify({"error": "Backup upload failed — deletion aborted: %s" % str(e)}), 500

    # Delete code env
    try:
        client._perform_empty("DELETE", "/admin/code-envs/%s/%s/" % (lang, name))
    except Exception as e:
        app.logger.error("[code-env-cleaner] delete failed for %s/%s: %s", lang, name, e)
        return jsonify({"error": "Delete failed (backup saved to managed folder): %s" % str(e)}), 500

    # Invalidate caches so subsequent fetches reflect the deletion
    _CACHE.pop('code_envs', None)
    _CACHE.pop('tools_outreach_data', None)
    _CACHE.pop('project_code_env_usage_full', None)

    app.logger.info("[code-env-cleaner] backed up %s to managed folder %s and deleted %s/%s", zip_filename, folder_id, lang, name)
    return jsonify({"backed_up_to": "managed folder", "zip_name": zip_filename, "deleted": name}), 200


@app.route('/api/tools/inactive-projects', methods=['GET'])
def api_tools_inactive_projects():
    """Fast endpoint: list inactive projects using only list_projects() (~0.1s)."""
    from datetime import datetime, timezone

    def _load():
        client = dataiku.api_client()
        catalog = _list_projects_catalog(client)
        inactive_threshold_days = 180
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        results = []
        for entry in catalog:
            last_modified_ms = entry.get('lastModifiedOn')
            if last_modified_ms is None:
                continue
            try:
                days_inactive = (now_ms - int(last_modified_ms)) / (1000 * 60 * 60 * 24)
            except (TypeError, ValueError):
                continue
            if days_inactive < inactive_threshold_days:
                continue
            results.append({
                'projectKey': entry['key'],
                'name': entry.get('name', entry['key']),
                'owner': entry.get('owner', 'Unknown'),
                'daysInactive': round(days_inactive),
            })
        return {'projects': results}

    data = _cache_get('inactive_projects', 20, _load)
    return jsonify(data)


@app.route('/api/tools/project-cleaner/<project_key>', methods=['DELETE'])
def api_project_cleaner_delete(project_key):
    """Backup to managed folder then delete an inactive project after verifying the confirmation header."""
    import tempfile

    confirm = request.headers.get("X-Confirm-Name", "")
    if confirm != project_key:
        return jsonify({"error": "Confirmation header does not match project key"}), 400

    folder_id = request.args.get("folderId", "").strip()
    if not folder_id:
        return jsonify({"error": "folderId query parameter is required"}), 400

    client = dataiku.api_client()
    plugin_project_key = dataiku.default_project_key()
    plugin_project = client.get_project(plugin_project_key)

    # Validate managed folder exists
    try:
        dest_folder = plugin_project.get_managed_folder(folder_id)
        dest_folder.get_definition()  # verify it exists
    except Exception as e:
        app.logger.error("[project-cleaner] invalid folder %s: %s", folder_id, e)
        return jsonify({"error": "Invalid managed folder: %s" % str(e)}), 400

    target_project = client.get_project(project_key)

    # Backup first — export to temp file, upload to managed folder
    safe_key = re.sub(r'[^a-zA-Z0-9._-]', '_', project_key)
    zip_filename = "%s.zip" % safe_key
    try:
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=True) as tmp:
            target_project.export_to_file(tmp.name)
            with open(tmp.name, "rb") as f:
                dest_folder.put_file(zip_filename, f)
    except Exception as e:
        app.logger.error("[project-cleaner] backup/upload failed for %s: %s", project_key, e)
        return jsonify({"error": "Backup upload failed — deletion aborted: %s" % str(e)}), 500

    # Delete project
    try:
        target_project.delete()
    except Exception as e:
        app.logger.error("[project-cleaner] delete failed for %s: %s", project_key, e)
        return jsonify({"error": "Delete failed (backup saved to managed folder): %s" % str(e)}), 500

    # Invalidate caches
    _CACHE.pop('tools_outreach_data', None)
    _CACHE.pop('inactive_projects', None)

    app.logger.info("[project-cleaner] backed up %s to managed folder %s and deleted %s", zip_filename, folder_id, project_key)
    return jsonify({"backed_up_to": "managed folder", "zip_name": zip_filename, "deleted": project_key}), 200


@app.route('/api/tools/plugins/compare', methods=['POST'])
def api_tools_plugins_compare():
    """Compare local (Design) plugins with a remote (Automation) node."""
    payload = request.get_json(silent=True) or {}
    remote_url = (payload.get('url') or '').strip().rstrip('/')
    remote_api_key = (payload.get('apiKey') or '').strip()
    if not remote_url or not remote_api_key:
        return jsonify({"error": "url and apiKey are required"}), 400

    try:
        import dataikuapi
    except ImportError:
        return jsonify({"error": "dataikuapi is not available on this DSS node"}), 500

    try:
        local_client = dataiku.api_client()
        local_plugins_raw = local_client.list_plugins()
    except Exception as e:
        return jsonify({"error": "Failed to fetch local plugins: %s" % str(e)}), 500

    try:
        remote_client = dataikuapi.DSSClient(remote_url, remote_api_key)
        remote_plugins_raw = remote_client.list_plugins()
    except Exception as e:
        return jsonify({"error": "Failed to fetch remote plugins: %s" % str(e)}), 500

    def _parse_plugins(raw_list):
        out = {}
        for p in raw_list:
            if isinstance(p, dict):
                meta = p.get('meta') or {}
                pid = p.get('id') or p.get('name') or meta.get('label')
                if not pid:
                    continue
                out[pid] = {
                    'label': meta.get('label') or pid,
                    'version': p.get('version'),
                    'isDev': bool(p.get('isDev', False)),
                }
            else:
                pid = str(p)
                if pid:
                    out[pid] = {'label': pid, 'version': None, 'isDev': False}
        return out

    local_map = _parse_plugins(local_plugins_raw)
    remote_map = _parse_plugins(remote_plugins_raw)
    all_ids = sorted(set(list(local_map.keys()) + list(remote_map.keys())))

    rows = []
    for pid in all_ids:
        local = local_map.get(pid)
        remote = remote_map.get(pid)
        rows.append({
            'id': pid,
            'label': (local or remote or {}).get('label', pid),
            'localVersion': local['version'] if local else None,
            'remoteVersion': remote['version'] if remote else None,
            'isDev': (local or {}).get('isDev', False),
        })

    return jsonify({"rows": rows})


@app.route('/api/tools/plugins/deploy-one', methods=['POST'])
def api_tools_plugins_deploy_one():
    body = request.get_json(force=True) or {}
    remote_url = (body.get('url') or '').strip().rstrip('/')
    api_key = (body.get('apiKey') or '').strip()
    plugin_id = (body.get('pluginId') or '').strip()

    if not remote_url or not api_key or not plugin_id:
        return jsonify({"error": "url, apiKey, and pluginId are required"}), 400

    try:
        import dataikuapi
    except ImportError:
        return jsonify({"error": "dataikuapi is not available on this DSS node"}), 500

    local_client = dataiku.api_client()
    remote_client = dataikuapi.DSSClient(remote_url, api_key)

    # Strategy 1: dev plugin → download stream and upload archive
    try:
        stream = local_client.download_plugin_stream(plugin_id)
        remote_client.install_plugin_from_archive(stream)
        return jsonify({"ok": True, "method": "archive"})
    except Exception as e:
        dev_error = str(e)

    # Strategy 2: non-dev (store) plugin → install from store on remote
    try:
        remote_client.install_plugin_from_store(plugin_id)
        return jsonify({"ok": True, "method": "store"})
    except Exception as e:
        store_error = str(e)

    return jsonify({
        "error": "Failed to deploy plugin '%s'. Archive: %s | Store: %s" % (plugin_id, dev_error, store_error)
    }), 500


@app.route('/api/plugins')
def api_plugins():
    client = dataiku.api_client()

    def loader():
        plugins = []
        plugin_details = []
        for p in client.list_plugins():
            if isinstance(p, dict):
                meta = p.get('meta') or {}
                pid = p.get('id') or p.get('name') or meta.get('label')
                if not pid:
                    continue
                plugins.append(pid)
                plugin_details.append({
                    'id': pid,
                    'label': meta.get('label') or pid,
                    'installedVersion': p.get('version'),
                    'isDev': bool(p.get('isDev', False)),
                })
            else:
                pid = str(p)
                if pid:
                    plugins.append(pid)
                    plugin_details.append({'id': pid, 'label': pid})
        plugins.sort()
        plugin_details.sort(key=lambda d: d.get('id', ''))
        return {'plugins': plugins, 'pluginDetails': plugin_details, 'pluginsCount': len(plugins)}

    data = _cache_get('plugins', 300, loader)
    return jsonify(data)


@app.route('/api/mail-channels')
def api_mail_channels():
    client = dataiku.api_client()
    channels = _list_mail_channels(client)
    return jsonify({'channels': channels})


@app.route('/api/logs/errors')
def api_logs_errors():
    client = dataiku.api_client()
    dip_home = _dip_home()

    def loader():
        log_content = None
        try:
            log_content = client.get_log('backend.log')
        except Exception:
            log_content = _safe_read_text(os.path.join(dip_home, 'run', 'backend.log'))
        return _parse_log_errors(log_content)

    data = _cache_get('log_errors', 300, loader)
    return jsonify(data)


@app.route('/api/dir-tree')
def api_dir_tree():
    client = dataiku.api_client()
    dip_home = _dip_home()
    max_depth = request.args.get('maxDepth', type=int) or 3
    path = request.args.get('path')
    raw_scope = (request.args.get('scope') or 'dss').strip().lower()
    if raw_scope in ('global', 'all', 'unknown'):
        raw_scope = 'dss'
    scope = raw_scope if raw_scope in ('dss', 'project') else 'dss'
    project_key = (request.args.get('projectKey') or '').strip() or None
    if scope != 'project':
        project_key = None

    cache_key = f"dir_tree:{scope}:{project_key or '-'}:{path or 'root'}:{max_depth}"

    def loader():
        return _build_dir_tree_from_footprint(
            client,
            dip_home,
            max_depth,
            target_path=path,
            scope=scope,
            project_key=project_key,
        )

    data = _cache_get(cache_key, 600, loader)
    return jsonify(data)
