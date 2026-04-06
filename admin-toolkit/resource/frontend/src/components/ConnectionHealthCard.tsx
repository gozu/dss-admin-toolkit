import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getBackendUrl } from '../utils/api';
import type { ConnectionHealthResult } from '../types';

interface HealthSummary {
  total: number;
  ok: number;
  fail: number;
  skipped: number;
  healthPct: number;
}

export function ConnectionHealthCard() {
  const [results, setResults] = useState<ConnectionHealthResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runScan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults([]);
    setTotal(null);
    setSummary(null);
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
            setTotal(Number(payload.total));
          } else if (eventType === 'conn') {
            setResults((prev) => [...prev, payload as unknown as ConnectionHealthResult]);
          } else if (eventType === 'done') {
            setSummary((payload as { summary: HealthSummary }).summary);
            gotDone = true;
          }
        }
      }

      if (!gotDone) setIncomplete(true);
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
  }, []);

  const abortScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const failedConnections = results.filter((r) => r.status === 'fail');
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const scanned = results.length;
  const hasScanRun = summary !== null || results.length > 0 || error !== null;

  const badgeClass = !summary ? 'badge-info'
    : summary.healthPct >= 80 ? 'badge-success'
    : summary.healthPct >= 50 ? 'badge-warning'
    : 'badge-critical';

  return (
    <motion.div
      className="chart-container"
      id="connection-health"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chart-header">
        <div className="flex items-center gap-2">
          <h4>Connection Health</h4>
          {summary && (
            <span className={`badge ${badgeClass} font-mono`}>
              {summary.healthPct}%
            </span>
          )}
        </div>
        {loading ? (
          <button
            onClick={abortScan}
            className="px-3 py-1 rounded-md text-xs font-medium text-[var(--text-secondary)] border border-[var(--text-tertiary)]/30 hover:bg-[var(--bg-glass-hover)] transition-colors"
          >
            Abort
          </button>
        ) : (
          <button
            onClick={runScan}
            className="px-3 py-1 rounded-md text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 transition-colors"
          >
            {hasScanRun ? 'Rescan' : 'Scan'}
          </button>
        )}
      </div>

      {/* Progress */}
      {loading && (
        <div className="px-4 py-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
          {total !== null
            ? `Testing connections\u2026 ${scanned} / ${total}`
            : 'Discovering connections\u2026'}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 text-sm text-[var(--status-critical)]">{error}</div>
      )}

      {/* Incomplete warning */}
      {incomplete && !loading && (
        <div className="px-4 py-2 text-xs text-[var(--status-warning)]">
          Scan incomplete — results may not reflect full health status.
        </div>
      )}

      {/* Results */}
      {!loading && !error && hasScanRun && !incomplete && (
        <div className="chart-summary">
          {failedConnections.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[var(--status-success)]">
              All {summary ? `${summary.ok} testable` : ''} connections healthy.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-[var(--text-muted)] pb-1">Connection</th>
                  <th className="text-left text-xs font-medium text-[var(--text-muted)] pb-1">Type</th>
                  <th className="text-left text-xs font-medium text-[var(--text-muted)] pb-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {failedConnections.map((c) => (
                  <tr key={c.name}>
                    <td className="font-mono text-[var(--status-critical)]">{c.name}</td>
                    <td className="text-[var(--text-secondary)]">{c.type}</td>
                    <td className="text-[var(--text-muted)] max-w-[300px] truncate" title={c.error}>
                      {c.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {skippedCount > 0 && (
            <div className="px-4 py-2 text-xs text-[var(--text-muted)]">
              {skippedCount} connection{skippedCount !== 1 ? 's' : ''} skipped (test not supported)
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
