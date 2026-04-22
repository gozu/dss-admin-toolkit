import { useCallback, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { getBackendUrl } from '../utils/api';
import type { ConnectionHealthResult, ConnectionAuditResult } from '../types';

type ErrorCategory = 'missing_config' | 'missing_credentials' | 'invalid_credentials' | 'unreachable';

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  missing_config: 'Missing Configuration',
  missing_credentials: 'Missing Credentials',
  invalid_credentials: 'Invalid Credentials',
  unreachable: 'Unreachable / Driver Error',
};

const CATEGORY_COLORS: Record<ErrorCategory, string> = {
  missing_config: 'var(--neon-red)',
  missing_credentials: 'amber-400',
  invalid_credentials: 'var(--neon-red)',
  unreachable: 'var(--text-muted)',
};

const CATEGORY_ORDER: ErrorCategory[] = ['missing_config', 'missing_credentials', 'invalid_credentials', 'unreachable'];

function classifyError(error: string): ErrorCategory {
  const lower = error.toLowerCase();
  if (/does not have credentials|user .* does not have/.test(lower)) return 'missing_credentials';
  if (/should not be left blank|missing .* parameter|no models selected|not defined/.test(lower)) return 'missing_config';
  if (/password authentication failed|incorrect username or password|invalid.*credentials|security token.*invalid|expired|failed to get access token|unauthorized_client|trial has ended|cannot invoke.*null/.test(lower)) return 'invalid_credentials';
  return 'unreachable';
}

export function ConnectionHealthCard() {
  const { state, setParsedData } = useDiag();
  const { parsedData } = state;

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const results = parsedData.connectionHealth || [];
  const total = parsedData.connectionHealthTotal ?? null;

  const dssBaseUrl = useMemo(() => {
    const bUrl = getBackendUrl('/');
    try {
      const u = new URL(bUrl, window.location.origin);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }, []);

  const rescan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setScanning(true);
    setError(null);
    setParsedData({ connectionHealth: [], connectionHealthTotal: null });

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
            setParsedData({ connectionHealthTotal: Number(payload.total) });
          } else if (eventType === 'conn') {
            collected.push(payload as unknown as ConnectionHealthResult);
            setParsedData({ connectionHealth: [...collected] });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [setParsedData]);

  const abortScan = useCallback(() => {
    abortRef.current?.abort();
    setScanning(false);
  }, []);

  const failedConnections = results.filter((r) => r.status === 'fail');
  const okCount = results.filter((r) => r.status === 'ok').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const hasResults = results.length > 0;
  const isLoading = scanning || (hasResults && total !== null && results.length < total);

  // Group failures by category
  const groupedFailures = useMemo(() => {
    const groups: Record<ErrorCategory, ConnectionHealthResult[]> = {
      missing_config: [],
      missing_credentials: [],
      invalid_credentials: [],
      unreachable: [],
    };
    for (const c of failedConnections) {
      const cat = classifyError(c.error || '');
      groups[cat].push(c);
    }
    return groups;
  }, [failedConnections]);

  const auditFindings: ConnectionAuditResult[] = useMemo(
    () => parsedData.connectionAudit || [],
    [parsedData.connectionAudit],
  );
  const auditBySeverity = useMemo(() => {
    const groups: Record<'critical' | 'warning' | 'info', ConnectionAuditResult[]> = {
      critical: [],
      warning: [],
      info: [],
    };
    for (const f of auditFindings) {
      if (f.configIssues.length === 0) continue;
      groups[f.severity].push(f);
    }
    return groups;
  }, [auditFindings]);
  const auditSeverityOrder: Array<'critical' | 'warning' | 'info'> = ['critical', 'warning', 'info'];
  const auditSeverityLabels: Record<'critical' | 'warning' | 'info', string> = {
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
  };
  const auditSeverityColors: Record<'critical' | 'warning' | 'info', string> = {
    critical: 'var(--neon-red)',
    warning: 'amber-400',
    info: 'var(--text-muted)',
  };
  const hasAudit = auditFindings.some((f) => f.configIssues.length > 0);

  return (
    <div id="connection-health-card" className="space-y-4">
      {/* Header */}
      <section className="glass-card p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Connection Health</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Tests all DSS connections and reports those that are not returning OK.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={rescan}
            disabled={scanning}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
      </section>

      {/* Progress */}
      {isLoading && (
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

      {/* Stats */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-primary)]">
                {total !== null && isLoading ? `${results.length} / ${total}` : results.length}
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

      {/* Failed connections grouped by category */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[60vh]">
            {failedConnections.length === 0 && !isLoading ? (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">
                All testable connections are healthy.
              </div>
            ) : failedConnections.length === 0 && isLoading ? (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">
                Scanning. Failed connections will appear here as they are found.
              </div>
            ) : (
              CATEGORY_ORDER.filter((cat) => groupedFailures[cat].length > 0).map((cat) => (
                <div key={cat} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-semibold" style={{ color: CATEGORY_COLORS[cat] }}>
                      {CATEGORY_LABELS[cat]}
                    </h4>
                    <span className="text-xs font-mono text-[var(--text-muted)]">
                      ({groupedFailures[cat].length})
                    </span>
                  </div>
                  <table className="table-dark w-full">
                    <thead>
                      <tr>
                        <th>Connection</th>
                        <th>Type</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedFailures[cat].map((c) => (
                        <tr key={c.name} className="hover:bg-[var(--bg-glass)] align-top">
                          <td className="whitespace-nowrap">
                            <a
                              href={`${dssBaseUrl}/admin/connections/${encodeURIComponent(c.name)}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--neon-cyan)] hover:underline"
                            >
                              {c.name}
                            </a>
                          </td>
                          <td className="text-[var(--text-secondary)] whitespace-nowrap">{c.type}</td>
                          <td className="text-[var(--text-muted)] text-xs leading-relaxed max-w-[500px]">
                            {c.error || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Configuration Audit */}
      {hasAudit && (
        <section className="glass-card p-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Configuration Audit</h4>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Recommended settings for fast-write, details readability, HDFS interface, and default connections.
          </p>
          <div className="overflow-auto max-h-[60vh]">
            {auditSeverityOrder
              .filter((sev) => auditBySeverity[sev].length > 0)
              .map((sev) => (
                <div key={sev} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-semibold" style={{ color: auditSeverityColors[sev] }}>
                      {auditSeverityLabels[sev]}
                    </h4>
                    <span className="text-xs font-mono text-[var(--text-muted)]">
                      ({auditBySeverity[sev].length})
                    </span>
                  </div>
                  <table className="table-dark w-full">
                    <thead>
                      <tr>
                        <th>Connection</th>
                        <th>Type</th>
                        <th>Findings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditBySeverity[sev].map((f) => (
                        <tr key={f.name} className="hover:bg-[var(--bg-glass)] align-top">
                          <td className="whitespace-nowrap">
                            <a
                              href={`${dssBaseUrl}/admin/connections/${encodeURIComponent(f.name)}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--neon-cyan)] hover:underline"
                            >
                              {f.name}
                            </a>
                          </td>
                          <td className="text-[var(--text-secondary)] whitespace-nowrap">{f.type}</td>
                          <td className="text-[var(--text-muted)] text-xs leading-relaxed">
                            <ul className="list-disc list-inside space-y-0.5">
                              {f.configIssues.map((issue, idx) => (
                                <li key={idx}>{issue}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
