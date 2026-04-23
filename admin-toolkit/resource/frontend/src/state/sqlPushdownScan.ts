import { getBackendUrl } from '../utils/api';
import type { SqlPushdownOwnerGroup } from '../types';

export interface SqlPushdownScanState {
  total: number | null;
  scanned: number | null;
  ownerGroups: SqlPushdownOwnerGroup[];
  status: 'idle' | 'scanning' | 'done' | 'error';
  error: string | null;
  elapsedMs: number | null;
}

const INITIAL_STATE: SqlPushdownScanState = {
  total: null,
  scanned: null,
  ownerGroups: [],
  status: 'idle',
  error: null,
  elapsedMs: null,
};

let _state: SqlPushdownScanState = INITIAL_STATE;
let _controller: AbortController | null = null;
const _listeners: Set<() => void> = new Set();

function setState(next: SqlPushdownScanState) {
  _state = next;
  _listeners.forEach((l) => l());
}

function patchState(patch: Partial<SqlPushdownScanState>) {
  setState({ ..._state, ...patch });
}

export function getSqlPushdownScan(): SqlPushdownScanState {
  return _state;
}

export function subscribeSqlPushdownScan(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

async function runScan() {
  _controller?.abort();
  const controller = new AbortController();
  _controller = controller;

  setState({ ...INITIAL_STATE, status: 'scanning' });

  try {
    const url = getBackendUrl('/api/projects/sql_pushdown_audit');
    const response = await fetch(url, {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.text();
      let msg = `Scan failed: ${response.status} ${response.statusText}`;
      try {
        msg = (JSON.parse(body) as { error?: string }).error || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const eventMatch = part.match(/^event:\s*(\S+)/m);
        const dataMatch = part.match(/^data:\s*(.*)/m);
        if (!eventMatch || !dataMatch) continue;
        const eventType = eventMatch[1];
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (eventType === 'error') {
          throw new Error(String(payload.error || 'Scan error'));
        } else if (eventType === 'init') {
          patchState({ total: Number(payload.total) });
        } else if (eventType === 'progress') {
          patchState({ scanned: Number(payload.scanned) });
        } else if (eventType === 'done') {
          patchState({
            status: 'done',
            ownerGroups: (payload.ownerGroups || []) as SqlPushdownOwnerGroup[],
            scanned: _state.total,
            elapsedMs: Number(payload.total_ms) || null,
          });
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    patchState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (_controller === controller) {
      _controller = null;
    }
  }
}

/** Idempotent — only starts a scan if one has never run (or isn't running). */
export function startSqlPushdownScan(): void {
  if (_state.status === 'scanning' || _state.status === 'done') return;
  void runScan();
}

/** Retry button — abort any in-flight scan, reset state, and start fresh. */
export function restartSqlPushdownScan(): void {
  _controller?.abort();
  _controller = null;
  void runScan();
}
