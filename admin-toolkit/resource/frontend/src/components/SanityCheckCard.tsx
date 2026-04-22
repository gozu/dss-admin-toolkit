import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { getBackendUrl } from '../utils/api';
import type { SanityCheckMessage } from '../types';

type Severity = 'ERROR' | 'WARNING' | 'INFO' | 'SUCCESS';

const SEVERITY_ORDER: Severity[] = ['ERROR', 'WARNING', 'INFO', 'SUCCESS'];

const SEVERITY_LABELS: Record<Severity, string> = {
  ERROR: 'Errors',
  WARNING: 'Warnings',
  INFO: 'Info',
  SUCCESS: 'Success',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  ERROR: 'var(--neon-red)',
  WARNING: 'var(--neon-yellow)',
  INFO: 'var(--neon-cyan)',
  SUCCESS: 'var(--neon-green)',
};

interface SanityCheckResponse {
  messages: SanityCheckMessage[];
  hasError?: boolean;
  hasWarning?: boolean;
  hasSuccess?: boolean;
  maxSeverity?: string | null;
  error?: string;
}

export function SanityCheckCard() {
  const { state, setParsedData } = useDiag();
  const { parsedData } = state;

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoRanRef = useRef(false);

  const results = useMemo(() => parsedData.sanityCheck || [], [parsedData.sanityCheck]);
  const hasResults = results.length > 0;

  const rescan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setScanning(true);
    setError(null);
    setParsedData({ sanityCheck: [], sanityCheckMaxSeverity: null });

    try {
      const url = getBackendUrl('/api/sanity-check');
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      const body = (await response.json()) as SanityCheckResponse;

      if (!response.ok) {
        throw new Error(body.error || `Scan failed: ${response.status} ${response.statusText}`);
      }

      setParsedData({
        sanityCheck: body.messages || [],
        sanityCheckMaxSeverity: body.maxSeverity ?? null,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [setParsedData]);

  useEffect(() => {
    if (autoRanRef.current) return;
    if (hasResults) return;
    autoRanRef.current = true;
    void rescan();
  }, [hasResults, rescan]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { ERROR: 0, WARNING: 0, INFO: 0, SUCCESS: 0 };
    for (const m of results) {
      if (m.severity in c) c[m.severity as Severity] += 1;
    }
    return c;
  }, [results]);

  const grouped = useMemo(() => {
    const groups: Record<Severity, SanityCheckMessage[]> = {
      ERROR: [],
      WARNING: [],
      INFO: [],
      SUCCESS: [],
    };
    for (const m of results) {
      const sev = (SEVERITY_ORDER as string[]).includes(m.severity) ? (m.severity as Severity) : 'INFO';
      groups[sev].push(m);
    }
    return groups;
  }, [results]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="glass-card p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Instance Sanity Check</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Runs a fresh DSS instance sanity check — connections, clusters, code envs, security, etc. Results are always live.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={rescan}
            disabled={scanning}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning ? 'Running...' : 'Rerun'}
          </button>
        </div>
      </section>

      {/* Progress */}
      {scanning && (
        <section className="glass-card p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
            Running sanity check&hellip;
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <section className="glass-card p-4">
          <div className="text-sm text-[var(--neon-red)]">
            <span className="font-medium">Sanity check error:</span> {error}
          </div>
        </section>
      )}

      {/* Stats */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-primary)]">{results.length}</div>
              <div className="text-xs text-[var(--text-muted)]">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-red)]">{counts.ERROR}</div>
              <div className="text-xs text-[var(--text-muted)]">Errors</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-yellow)]">{counts.WARNING}</div>
              <div className="text-xs text-[var(--text-muted)]">Warnings</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-cyan)]">{counts.INFO}</div>
              <div className="text-xs text-[var(--text-muted)]">Info</div>
            </div>
          </div>
        </section>
      )}

      {/* Messages grouped by severity */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[70vh]">
            {SEVERITY_ORDER.filter((sev) => grouped[sev].length > 0).map((sev) => (
              <div key={sev} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-sm font-semibold" style={{ color: SEVERITY_COLORS[sev] }}>
                    {SEVERITY_LABELS[sev]}
                  </h4>
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    ({grouped[sev].length})
                  </span>
                </div>
                <table className="table-dark w-full">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Title</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[sev].map((m, i) => (
                      <tr key={`${m.code}-${i}`} className="hover:bg-[var(--bg-glass)] align-top">
                        <td className="whitespace-nowrap text-[var(--text-secondary)] font-mono text-xs">
                          {m.code || ''}
                        </td>
                        <td className="text-[var(--text-primary)] text-sm">{m.title || ''}</td>
                        <td className="text-[var(--text-muted)] text-xs leading-relaxed max-w-[600px] whitespace-pre-wrap">
                          {m.details || m.message || ''}
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

      {/* Empty state (after a successful run with no messages) */}
      {!scanning && !error && !hasResults && (
        <section className="glass-card p-4">
          <div className="py-6 text-center text-sm text-[var(--text-muted)]">
            Click <span className="text-[var(--text-secondary)] font-medium">Rerun</span> to run a sanity check.
          </div>
        </section>
      )}
    </div>
  );
}
