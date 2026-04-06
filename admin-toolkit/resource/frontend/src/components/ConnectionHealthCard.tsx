import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { getBackendUrl } from '../utils/api';
import type { ConnectionHealthResult } from '../types';

export function ConnectionHealthCard() {
  const { state, setParsedData } = useDiag();
  const { parsedData } = state;

  // Live streaming state (only while scan is active)
  const [liveResults, setLiveResults] = useState<ConnectionHealthResult[]>([]);
  const [liveTotal, setLiveTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Use persisted results from context, fall back to live results during scan
  const results = loading ? liveResults : (parsedData.connectionHealth || []);
  const total = loading ? liveTotal : (parsedData.connectionHealthTotal ?? null);

  const dssBaseUrl = useMemo(() => {
    const bUrl = getBackendUrl('/');
    try {
      const u = new URL(bUrl, window.location.origin);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }, []);

  const runScan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setLiveResults([]);
    setLiveTotal(null);
    setIncomplete(false);

    try {
      const url = getBackendUrl('/api/connections/health');
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });

      if (!response.ok || !response.body) {
        const body = await response.text();
        let msg = `Scan failed: ${response.status} ${response.statusText}`;
        try { msg = (JSON.parse(body) as { error?: string }).error || msg; } catch {}
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotDone = false;
      const collected: ConnectionHealthResult[] = [];

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
          try { payload = JSON.parse(dataMatch[1]) as Record<string, unknown>; } catch { continue; }

          if (eventType === 'error') {
            throw new Error(String(payload.error || 'Scan error'));
          } else if (eventType === 'init') {
            setLiveTotal(Number(payload.total));
          } else if (eventType === 'conn') {
            const item = payload as unknown as ConnectionHealthResult;
            collected.push(item);
            setLiveResults([...collected]);
          } else if (eventType === 'done') {
            gotDone = true;
          }
        }
      }

      if (!gotDone) {
        setIncomplete(true);
      }

      // Persist results to context so they survive navigation
      setParsedData({
        connectionHealth: collected,
        connectionHealthTotal: collected.length,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setIncomplete(true);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [setParsedData]);

  const abortScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Auto-scan on mount only if no persisted results
  const hasPersistedResults = (parsedData.connectionHealth?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasPersistedResults) runScan();
    return () => { abortRef.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const failedConnections = results.filter((r) => r.status === 'fail');
  const okCount = results.filter((r) => r.status === 'ok').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const hasResults = results.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="glass-card p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Connection Health</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Tests all DSS connections and reports those that are not returning OK.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={runScan}
            disabled={loading}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
      </section>

      {/* Progress */}
      {loading && (
        <section className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
              {total !== null
                ? `Testing connections\u2026 ${results.length} / ${total}`
                : 'Discovering connections\u2026'}
            </div>
            <button
              onClick={abortScan}
              className="px-3 py-1 rounded-md text-xs font-medium text-[var(--text-secondary)] border border-[var(--text-tertiary)]/30 hover:bg-[var(--bg-glass-hover)] transition-colors"
            >
              Abort
            </button>
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <section className="glass-card p-4">
          <div className="text-sm text-[var(--neon-red)]">
            <span className="font-medium">Scan error:</span> {error}
          </div>
        </section>
      )}

      {/* Incomplete warning */}
      {incomplete && !loading && (
        <section className="glass-card p-4">
          <div className="text-sm text-amber-400">
            Scan incomplete — results may not reflect full health status.
          </div>
        </section>
      )}

      {/* Stats */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-primary)]">
                {total !== null && loading ? `${results.length} / ${total}` : results.length}
              </div>
              <div className="text-xs text-[var(--text-muted)]">Tested</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-green)]">{okCount}</div>
              <div className="text-xs text-[var(--text-muted)]">Healthy</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-red)]">{failedConnections.length}</div>
              <div className="text-xs text-[var(--text-muted)]">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-muted)]">{skippedCount}</div>
              <div className="text-xs text-[var(--text-muted)]">Skipped</div>
            </div>
          </div>
        </section>
      )}

      {/* Failed connections table */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[60vh]">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th>Connection</th>
                  <th>Type</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {failedConnections.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-[var(--text-muted)]">
                      All testable connections are healthy.
                    </td>
                  </tr>
                ) : failedConnections.length === 0 && loading ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-[var(--text-muted)]">
                      Scanning. Failed connections will appear here as they are found.
                    </td>
                  </tr>
                ) : (
                  failedConnections.map((c) => (
                    <tr key={c.name} className="hover:bg-[var(--bg-glass)]">
                      <td>
                        <a
                          href={`${dssBaseUrl}/admin/connections/${encodeURIComponent(c.name)}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--neon-cyan)] hover:underline"
                        >
                          {c.name}
                        </a>
                      </td>
                      <td className="text-[var(--text-secondary)]">{c.type}</td>
                      <td className="text-[var(--text-muted)] max-w-[400px] truncate" title={c.error || ''}>
                        {c.error || ''}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
