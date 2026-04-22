import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { getBackendUrl } from '../utils/api';
import type { SanityCheckMessage } from '../types';

type Severity = 'ERROR' | 'WARNING' | 'INFO' | 'SUCCESS';

const SEVERITY_RANK: Record<Severity, number> = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
  SUCCESS: 3,
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

// --- Text helpers --------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s: string | null | undefined): string {
  if (!s) return '';
  const withBreaks = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTitlePrefix(title: string): string {
  if (!title) return '';
  const idx = title.indexOf(' - ');
  return idx >= 0 ? title.slice(idx + 3).trim() : title;
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// --- Per-code extractor regexes -----------------------------------------

const CONN_SINGLE_QUOTE_RE = /connection '([^']+)'/;
const PROJECT_SINGLE_QUOTE_RE = /project '([^']+)'/;
const CODE_ENV_DEP_RE =
  /environment '([^']+)' uses a deprecated python interpreter\s*:?\s*([^\n.]+)?/i;
const CODE_ENV_NAME_RE = /code environment '([^']+)'/i;

function extractFirst(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function formatList(items: string[]): string {
  return items.join(', ');
}

// --- Per-code formatters -------------------------------------------------

type Formatter = (msgs: SanityCheckMessage[]) => string;

const FORMATTERS: Record<string, Formatter> = {
  WARN_CONNECTION_SPARK_NO_GROUP_WITH_DETAILS_READ_ACCESS: (msgs) => {
    const names = uniq(
      msgs.map((m) => extractFirst(CONN_SINGLE_QUOTE_RE, stripHtml(m.details))).filter(Boolean) as string[],
    );
    if (names.length === 0) return defaultFormatter(msgs);
    return `${formatList(names)} have no groups allowed to read their details. Spark interaction may be slow.`;
  },

  WARN_CLUSTERS_NONE_SELECTED_PROJECT: (msgs) => {
    const names = uniq(
      msgs.map((m) => extractFirst(PROJECT_SINGLE_QUOTE_RE, stripHtml(m.details))).filter(Boolean) as string[],
    );
    return names.length ? formatList(names) : defaultFormatter(msgs);
  },

  WARN_CONNECTION_SNOWFLAKE_NO_AUTOFASTWRITE: (msgs) => {
    const names = uniq(
      msgs.map((m) => extractFirst(CONN_SINGLE_QUOTE_RE, stripHtml(m.details))).filter(Boolean) as string[],
    );
    return names.length ? formatList(names) : defaultFormatter(msgs);
  },

  WARN_CONNECTION_NO_HADOOP_INTERFACE: (msgs) => {
    const names = uniq(
      msgs.map((m) => extractFirst(CONN_SINGLE_QUOTE_RE, stripHtml(m.details))).filter(Boolean) as string[],
    );
    return names.length ? formatList(names) : defaultFormatter(msgs);
  },

  WARN_MISC_CODE_ENV_DEPRECATED_INTERPRETER: (msgs) => {
    const entries = msgs
      .map((m) => {
        const plain = stripHtml(m.details);
        const match = plain.match(CODE_ENV_DEP_RE);
        if (!match) return null;
        const env = match[1];
        const interp = (match[2] || '').trim();
        return interp ? `${env} (${interp})` : env;
      })
      .filter(Boolean) as string[];
    return entries.length ? formatList(uniq(entries)) : defaultFormatter(msgs);
  },

  WARN_MISC_CODE_ENV_USES_PYSPARK: (msgs) => {
    const names = uniq(
      msgs.map((m) => extractFirst(CODE_ENV_NAME_RE, stripHtml(m.details))).filter(Boolean) as string[],
    );
    return names.length ? formatList(names) : defaultFormatter(msgs);
  },

  WARN_GIT_PROJECT_NOT_MIGRATED: (msgs) => {
    // extraInfoDetails holds a <pre>...</pre> block shaped like:
    //   PROJECT_KEY:
    //     - branch1 (last migrated with DSS X.Y.Z)
    //     - branch2 (last migrated with DSS X.Y.Z)
    //   NEXT_PROJECT_KEY:
    //     - master (last migrated with DSS X.Y.Z)
    // One message typically covers all affected projects.
    const lines: string[] = [];
    const branchRe = /^-\s*(.+?)\s*\(last migrated with DSS\s+(.+?)\)\s*$/;
    for (const m of msgs) {
      const block = stripHtml(m.extraInfoDetails || '');
      if (!block) continue;
      let current = '';
      for (const raw of block.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const bm = line.match(branchRe);
        if (bm) {
          const branch = bm[1].trim();
          const ver = bm[2].trim();
          lines.push(
            current
              ? `${current}: ${branch} (last migrated with DSS ${ver})`
              : `${branch} (last migrated with DSS ${ver})`,
          );
        } else if (line.endsWith(':')) {
          current = line.slice(0, -1).trim();
        }
      }
    }
    return lines.length ? lines.join('\n') : defaultFormatter(msgs);
  },

  WARN_APP_AS_RECIPE_HAS_ORPHAN_INSTANCES: (msgs) => {
    const parts: string[] = [];
    for (const m of msgs) {
      const summary = stripHtml(m.details);
      const extraSummary = stripHtml(m.extraInfoSummary || '');
      const extra = stripHtml(m.extraInfoDetails || '');
      const tail = [extraSummary, extra].filter(Boolean).join(' ');
      const combined = [summary, tail].filter(Boolean).join('\n');
      if (combined) parts.push(combined);
    }
    return parts.length ? parts.join('\n\n') : defaultFormatter(msgs);
  },

  WARN_SECURITY_MEMORY_LIMIT_TOO_HIGH: (msgs) => {
    return uniq(msgs.map((m) => stripHtml(m.details)).filter(Boolean)).join('\n\n');
  },
};

function defaultFormatter(msgs: SanityCheckMessage[]): string {
  const parts = uniq(msgs.map((m) => stripHtml(m.details || m.message || '')).filter(Boolean));
  return parts.join('; ');
}

function formatDetailsForCode(code: string, msgs: SanityCheckMessage[]): string {
  const fn = FORMATTERS[code];
  return (fn || defaultFormatter)(msgs);
}

// --- Grouping -----------------------------------------------------------

interface GroupedRow {
  code: string;
  severity: Severity;
  title: string;
  msgs: SanityCheckMessage[];
}

function normalizeSeverity(s: string): Severity {
  return (['ERROR', 'WARNING', 'INFO', 'SUCCESS'] as Severity[]).includes(s as Severity)
    ? (s as Severity)
    : 'INFO';
}

function groupByCode(msgs: SanityCheckMessage[]): GroupedRow[] {
  const map = new Map<string, SanityCheckMessage[]>();
  for (const m of msgs) {
    const key = m.code || m.title || '';
    const arr = map.get(key);
    if (arr) arr.push(m);
    else map.set(key, [m]);
  }
  const rows: GroupedRow[] = [];
  for (const [code, arr] of map) {
    rows.push({
      code,
      severity: normalizeSeverity(arr[0].severity),
      title: arr[0].title || '',
      msgs: arr,
    });
  }
  rows.sort((a, b) => {
    const sd = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sd !== 0) return sd;
    return a.code.localeCompare(b.code);
  });
  return rows;
}

// --- Component ----------------------------------------------------------

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
      const sev = normalizeSeverity(m.severity);
      c[sev] += 1;
    }
    return c;
  }, [results]);

  const rows = useMemo(() => groupByCode(results), [results]);

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

      {/* Grouped-by-code table */}
      {hasResults && (
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[70vh]">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.code}
                    className="hover:bg-[var(--bg-glass)] align-top"
                    style={{ borderLeft: `3px solid ${SEVERITY_COLORS[row.severity]}` }}
                  >
                    <td className="text-[var(--text-primary)] text-sm">
                      {stripTitlePrefix(row.title)}
                    </td>
                    <td className="text-[var(--text-muted)] text-xs leading-relaxed max-w-[600px] whitespace-pre-wrap">
                      {formatDetailsForCode(row.code, row.msgs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
