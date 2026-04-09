import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import { fetchJson } from '../../utils/api';

/* ---------- Types ---------- */

interface TrendsRun {
  run_id: number;
  run_at: string;
  health_score: number | null;
  user_count: number | null;
  project_count: number | null;
  plugin_count: number | null;
  connection_count: number | null;
  code_env_count: number | null;
  cluster_count: number | null;
  dss_version: string | null;
}

type DatasetSupport = 'full' | 'lifecycle' | 'current_only';
type DatasetKind = 'scalar' | 'keyed_table' | 'interval_events' | 'metadata';
type ChangeFilterType = 'all' | 'added' | 'removed' | 'changed' | 'unchanged';

interface CompareDatasetSummary {
  datasetId: string;
  label: string;
  category: string;
  kind: DatasetKind;
  support: DatasetSupport;
  run1Count: number;
  run2Count: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  availableInRun1: boolean;
  availableInRun2: boolean;
  notes: string | null;
}

interface CompareManifest {
  run1: Record<string, unknown>;
  run2: Record<string, unknown>;
  datasets: CompareDatasetSummary[];
}

interface CompareRowDiff {
  key: string;
  changeType: string;
  run1: Record<string, unknown> | null;
  run2: Record<string, unknown> | null;
}

interface CompareDatasetDetail {
  datasetId: string;
  columns: string[];
  keyFields: string[];
  rows: CompareRowDiff[];
  page: number;
  pageSize: number;
  totalRows: number;
  support: DatasetSupport;
  notes: string | null;
}

/* ---------- Constants ---------- */

const CATEGORY_ORDER = ['run_summary', 'snapshot_entities', 'lifecycle', 'metadata'];
const CATEGORY_LABELS: Record<string, string> = {
  run_summary: 'Run Summary',
  snapshot_entities: 'Snapshot Entities',
  lifecycle: 'Lifecycle / Interval',
  metadata: 'Metadata / Admin',
};
const CHANGE_FILTERS: ChangeFilterType[] = ['all', 'added', 'removed', 'changed', 'unchanged'];

/* ---------- Helpers ---------- */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ---------- Custom hook ---------- */

function useCompareData() {
  const { addDebugLog } = useDiag();
  const [runs, setRuns] = useState<TrendsRun[]>([]);
  const [run1Id, setRun1Id] = useState<number | null>(null);
  const [run2Id, setRun2Id] = useState<number | null>(null);
  const [manifest, setManifest] = useState<CompareManifest | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available runs
  useEffect(() => {
    let cancelled = false;
    setRunsLoading(true);
    fetchJson<{ runs: TrendsRun[] }>('/api/tracking/runs?limit=100')
      .then((data) => {
        if (cancelled) return;
        const list = data.runs ?? (Array.isArray(data) ? data : []);
        setRuns(list);
        addDebugLog(`[trends] Fetched ${list.length} runs`, 'trends');
        if (list.length >= 2) {
          setRun1Id(list[0].run_id);            // newest
          setRun2Id(list[list.length - 1].run_id); // oldest
        } else if (list.length === 1) {
          setRun1Id(list[0].run_id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setRunsLoading(false); });
    return () => { cancelled = true; };
  }, [addDebugLog]);

  // Fetch manifest when run selection changes
  useEffect(() => {
    if (!run1Id || !run2Id) return;
    let cancelled = false;
    setManifestLoading(true);
    setError(null);
    const t0 = performance.now();
    fetchJson<CompareManifest>(`/api/tracking/compare/full?run1=${run1Id}&run2=${run2Id}`)
      .then((data) => {
        if (cancelled) return;
        setManifest(data);
        addDebugLog(`[trends] Manifest loaded in ${(performance.now() - t0).toFixed(0)}ms`, 'trends');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setManifestLoading(false); });
    return () => { cancelled = true; };
  }, [run1Id, run2Id, addDebugLog]);

  return {
    runs, run1Id, run2Id, setRun1Id, setRun2Id,
    manifest, loading: runsLoading || manifestLoading, error,
  };
}

/* ---------- Sub-components ---------- */

function SkeletonCard() {
  return (
    <div className="glass-card animate-pulse">
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <div className="h-4 w-24 rounded bg-[var(--bg-glass-hover)]" />
      </div>
      <div className="px-4 py-6 space-y-3">
        <div className="h-8 w-20 rounded bg-[var(--bg-glass-hover)]" />
        <div className="h-3 w-32 rounded bg-[var(--bg-glass-hover)]" />
      </div>
    </div>
  );
}

function SupportBadge({ support }: { support: DatasetSupport }) {
  const cfg: Record<DatasetSupport, { bg: string; text: string; label: string }> = {
    full: { bg: 'rgba(74, 222, 128, 0.15)', text: 'var(--neon-green)', label: 'full' },
    lifecycle: { bg: 'rgba(251, 191, 36, 0.15)', text: 'var(--neon-amber)', label: 'lifecycle' },
    current_only: { bg: 'rgba(148, 163, 184, 0.15)', text: 'var(--text-muted)', label: 'current only' },
  };
  const s = cfg[support] || cfg.full;
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: s.bg, color: s.text }}>
      {s.label}
    </span>
  );
}

function ChangeTypeBadge({ ct }: { ct: string }) {
  const styles: Record<string, { color: string; bg: string }> = {
    added: { color: 'var(--neon-green)', bg: 'rgba(74, 222, 128, 0.12)' },
    removed: { color: 'var(--neon-red)', bg: 'rgba(248, 113, 113, 0.12)' },
    changed: { color: 'var(--neon-amber)', bg: 'rgba(251, 191, 36, 0.12)' },
    unchanged: { color: 'var(--text-muted)', bg: 'rgba(148, 163, 184, 0.08)' },
  };
  const s = styles[ct] || styles.unchanged;
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: s.color, background: s.bg }}>
      {ct}
    </span>
  );
}

function DiffChips({ ds }: { ds: CompareDatasetSummary }) {
  if (ds.kind === 'metadata') return <span className="text-xs text-[var(--text-muted)]">current only</span>;
  const chips: Array<{ label: string; val: number; color: string }> = [];
  if (ds.added > 0) chips.push({ label: '+', val: ds.added, color: 'var(--neon-green)' });
  if (ds.removed > 0) chips.push({ label: '-', val: ds.removed, color: 'var(--neon-red)' });
  if (ds.changed > 0) chips.push({ label: '~', val: ds.changed, color: 'var(--neon-amber)' });
  if (chips.length === 0) {
    if (ds.unchanged > 0) return <span className="text-xs text-[var(--text-muted)]">no changes</span>;
    return <span className="text-xs text-[var(--text-muted)]">empty</span>;
  }
  return (
    <div className="flex gap-1.5">
      {chips.map((c) => (
        <span key={c.label} className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ color: c.color, border: `1px solid color-mix(in srgb, ${c.color} 30%, transparent)` }}>
          {c.label}{c.val}
        </span>
      ))}
    </div>
  );
}

function SummaryStrip({ manifest }: { manifest: CompareManifest }) {
  const r1 = manifest.run1;
  const r2 = manifest.run2;
  const metrics = [
    { label: 'Health Score', v1: r1.health_score as number | null, v2: r2.health_score as number | null, isHealth: true },
    { label: 'Users', v1: r1.user_count as number | null, v2: r2.user_count as number | null },
    { label: 'Projects', v1: r1.project_count as number | null, v2: r2.project_count as number | null },
    { label: 'Plugins', v1: r1.plugin_count as number | null, v2: r2.plugin_count as number | null },
    { label: 'Connections', v1: r1.connection_count as number | null, v2: r2.connection_count as number | null },
    { label: 'Code Envs', v1: r1.code_env_count as number | null, v2: r2.code_env_count as number | null },
    { label: 'Clusters', v1: r1.cluster_count as number | null, v2: r2.cluster_count as number | null },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {metrics.map((m, i) => {
        const v1 = m.v1 ?? 0;
        const v2 = m.v2 ?? 0;
        const diff = v1 - v2;
        const color = diff > 0 ? 'var(--neon-green)' : diff < 0 ? 'var(--neon-red)' : 'var(--text-muted)';
        const isHealth = m.isHealth;
        const pct = isHealth ? Math.max(0, Math.min(100, v1)) : 0;
        const hue = (pct / 100) * 120;

        return (
          <motion.div key={m.label}
            className={`glass-card px-3 py-2 ${isHealth ? 'border-[var(--border-glow)] shadow-[var(--glow-sm)]' : ''}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.04 }}>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{m.label}</div>
            {isHealth ? (
              <div className="flex items-center gap-2 mt-1">
                <div className="relative w-10 h-10 flex-shrink-0">
                  <div className="w-full h-full rounded-full"
                       style={{
                         background: `conic-gradient(hsl(${hue}, 75%, 55%) 0deg, hsl(${hue}, 65%, 40%) ${pct * 3.6}deg, rgba(50, 55, 70, 0.3) ${pct * 3.6}deg)`,
                       }} />
                  <div className="absolute inset-1 rounded-full bg-[var(--bg-surface)] flex items-center justify-center">
                    <span className="text-xs font-bold font-mono">{m.v1 !== null ? v1 : '--'}</span>
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-[var(--text-muted)]">was {m.v2 !== null ? v2 : '--'}</span>
                  {diff !== 0 && m.v1 !== null && m.v2 !== null && (
                    <span className="text-[10px] font-mono" style={{ color }}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="text-lg font-mono font-bold text-[var(--text-primary)] mt-0.5">
                  {m.v1 !== null ? v1.toLocaleString() : '--'}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] text-[var(--text-muted)]">was {m.v2 !== null ? v2.toLocaleString() : '--'}</span>
                  {diff !== 0 && m.v1 !== null && m.v2 !== null && (
                    <span className="text-[10px] font-mono" style={{ color }}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                </div>
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function SectionHeader({ title, delay = 0 }: { title: string; delay?: number }) {
  return (
    <motion.div className="flex items-center gap-3 pt-4 pb-1"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: delay * 0.06 }}>
      <h3 className="text-base font-semibold text-[var(--text-secondary)] tracking-wide uppercase">{title}</h3>
      <div className="flex-1 h-px bg-[var(--border-default)]" />
    </motion.div>
  );
}

/* ---------- Detail Table ---------- */

function DetailTable({ detail, kind }: { detail: CompareDatasetDetail; kind: DatasetKind }) {
  if (detail.rows.length === 0) {
    return <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No rows match the current filter</div>;
  }

  // Scalar: field-by-field
  if (kind === 'scalar') {
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-glass)]">
            <th className="px-4 py-2 text-left text-[var(--text-muted)] font-medium">Field</th>
            <th className="px-4 py-2 text-left text-[var(--text-muted)] font-medium">Run 1</th>
            <th className="px-4 py-2 text-left text-[var(--text-muted)] font-medium">Run 2</th>
            <th className="px-4 py-2 text-left text-[var(--text-muted)] font-medium w-20">Status</th>
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => {
            const field = row.key;
            const r1 = row.run1 || {};
            const r2 = row.run2 || {};
            const isJson = r1.fieldType === 'json' || r2.fieldType === 'json';
            const v1Display = isJson ? '[JSON blob]' : String(r1[field] ?? '--');
            const v2Display = isJson ? '[JSON blob]' : String(r2[field] ?? '--');
            return (
              <tr key={field} className="border-b border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]">
                <td className="px-4 py-2 font-mono text-[var(--text-secondary)]">{field}</td>
                <td className="px-4 py-2 font-mono text-[var(--text-primary)] max-w-[300px] truncate"
                    title={isJson ? undefined : v1Display}>
                  {isJson ? <span className="text-[var(--text-muted)] italic">{v1Display}</span> : v1Display}
                </td>
                <td className="px-4 py-2 font-mono text-[var(--text-primary)] max-w-[300px] truncate"
                    title={isJson ? undefined : v2Display}>
                  {isJson ? <span className="text-[var(--text-muted)] italic">{v2Display}</span> : v2Display}
                </td>
                <td className="px-4 py-2"><ChangeTypeBadge ct={row.changeType} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // Keyed, lifecycle, metadata: row-based table
  const showStatus = kind !== 'metadata';
  const displayCols = detail.columns.filter((c) => !detail.keyFields.includes(c)).slice(0, 6);
  const extraColCount = Math.max(0, detail.columns.filter((c) => !detail.keyFields.includes(c)).length - 6);

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-[var(--border-glass)]">
          <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">Key</th>
          {showStatus && <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium w-20">Status</th>}
          {displayCols.map((c) => (
            <th key={c} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium max-w-[140px] truncate">{c}</th>
          ))}
          {extraColCount > 0 && (
            <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">+{extraColCount}</th>
          )}
        </tr>
      </thead>
      <tbody>
        {detail.rows.map((row, i) => {
          const data = row.run2 || row.run1 || {};
          return (
            <tr key={`${row.key}-${i}`} className="border-b border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]">
              <td className="px-3 py-1.5 font-mono text-[var(--text-secondary)] max-w-[200px] truncate" title={row.key}>
                {row.key}
              </td>
              {showStatus && <td className="px-3 py-1.5"><ChangeTypeBadge ct={row.changeType} /></td>}
              {displayCols.map((c) => {
                const v1 = row.run1?.[c];
                const v2 = row.run2?.[c];
                const differs = showStatus && row.changeType === 'changed'
                  && v1 !== undefined && v2 !== undefined && String(v1) !== String(v2);
                return (
                  <td key={c} className="px-3 py-1.5 font-mono max-w-[140px] truncate"
                      style={{ color: differs ? 'var(--neon-amber)' : 'var(--text-primary)' }}
                      title={String(data[c] ?? '')}>
                    {String(data[c] ?? '--')}
                    {differs && (
                      <span className="text-[var(--text-muted)]"> ({String(v1)})</span>
                    )}
                  </td>
                );
              })}
              {extraColCount > 0 && <td className="px-3 py-1.5 text-[var(--text-muted)]">...</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- Dataset Row (expandable) ---------- */

function DatasetRow({ ds, run1Id, run2Id, delay = 0 }: {
  ds: CompareDatasetSummary;
  run1Id: number;
  run2Id: number;
  delay?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CompareDatasetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [changeFilter, setChangeFilter] = useState<ChangeFilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const { addDebugLog } = useDiag();

  const loadDetail = useCallback((ct: ChangeFilterType = changeFilter, pg: number = 1, srch: string = searchTerm) => {
    setDetailLoading(true);
    const params = new URLSearchParams({
      run1: String(run1Id), run2: String(run2Id), dataset: ds.datasetId,
      change_type: ct, page: String(pg), page_size: '100',
    });
    if (srch) params.set('search', srch);
    fetchJson<CompareDatasetDetail>(`/api/tracking/compare/full/dataset?${params}`)
      .then((data) => {
        setDetail(data);
        setCurrentPage(pg);
        addDebugLog(`[trends] Detail '${ds.datasetId}' page=${pg}`, 'trends');
      })
      .catch((err: unknown) => {
        addDebugLog(`[trends] Detail '${ds.datasetId}' error: ${err}`, 'trends', 'error');
      })
      .finally(() => setDetailLoading(false));
  }, [run1Id, run2Id, ds.datasetId, changeFilter, searchTerm, addDebugLog]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) loadDetail('all', 1, '');
  };

  const handleFilterChange = (ct: ChangeFilterType) => {
    setChangeFilter(ct);
    loadDetail(ct, 1, searchTerm);
  };

  const handleSearch = (val: string) => {
    setSearchTerm(val);
    // Debounce-like: only fetch on Enter or empty
    if (!val || val.length >= 2) loadDetail(changeFilter, 1, val);
  };

  const totalPages = detail ? Math.ceil(detail.totalRows / detail.pageSize) : 0;

  return (
    <motion.div className="glass-card overflow-hidden"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: delay * 0.04 }}>
      {/* Collapsed summary row */}
      <button className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-[var(--bg-glass-hover)] transition-colors"
              onClick={handleExpand}>
        <span className="text-xs text-[var(--text-muted)] w-4 flex-shrink-0">{expanded ? '\u25BE' : '\u25B8'}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate">{ds.label}</span>
        <SupportBadge support={ds.support} />
        <span className="text-xs font-mono text-[var(--text-muted)] w-16 text-right flex-shrink-0">{ds.run1Count}</span>
        <span className="text-xs text-[var(--text-muted)] flex-shrink-0">{'\u2192'}</span>
        <span className="text-xs font-mono text-[var(--text-muted)] w-16 flex-shrink-0">{ds.run2Count}</span>
        <div className="w-32 flex justify-end flex-shrink-0">
          <DiffChips ds={ds} />
        </div>
      </button>

      {/* Unavailable warning */}
      {(!ds.availableInRun1 || !ds.availableInRun2) && (
        <div className="px-4 py-1.5 bg-[var(--neon-amber)]/5 border-t border-[var(--neon-amber)]/20 text-xs text-[var(--neon-amber)]">
          {!ds.availableInRun1 && !ds.availableInRun2
            ? 'Not available for either run'
            : !ds.availableInRun1 ? 'Not available for Run 1' : 'Not available for Run 2'}
          {ds.notes && ` \u2014 ${ds.notes}`}
        </div>
      )}

      {/* Expanded detail panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-[var(--border-glass)] overflow-hidden"
          >
            {/* Filter bar (skip for metadata & scalar) */}
            {ds.kind !== 'metadata' && ds.kind !== 'scalar' && (
              <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-[var(--border-glass)] bg-[var(--bg-surface)]/50">
                {CHANGE_FILTERS.map((ct) => (
                  <button key={ct}
                    className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                      changeFilter === ct
                        ? 'bg-[var(--bg-glass-hover)] text-[var(--text-primary)] border border-[var(--border-glow)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                    onClick={() => handleFilterChange(ct)}>
                    {ct}
                  </button>
                ))}
                <input
                  type="text"
                  placeholder="Search..."
                  className="ml-auto text-xs bg-[var(--bg-surface)] border border-[var(--border-default)] rounded px-2 py-1 text-[var(--text-primary)] w-40 focus:outline-none focus:border-[var(--border-glow)]"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                />
              </div>
            )}

            {/* Table content */}
            <div className="max-h-[500px] overflow-auto">
              {detailLoading && !detail && (
                <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)] animate-pulse">Loading detail...</div>
              )}
              {detail && <DetailTable detail={detail} kind={ds.kind} />}
              {detailLoading && detail && (
                <div className="px-4 py-1 text-center text-[10px] text-[var(--text-muted)]">Updating...</div>
              )}
            </div>

            {/* Pagination */}
            {detail && totalPages > 1 && (
              <div className="px-4 py-2 flex items-center justify-between border-t border-[var(--border-glass)] bg-[var(--bg-surface)]/50">
                <span className="text-xs text-[var(--text-muted)]">
                  {detail.totalRows.toLocaleString()} rows &middot; page {detail.page} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <button className="text-xs px-2 py-1 rounded bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] disabled:opacity-30"
                          disabled={currentPage <= 1}
                          onClick={() => { setCurrentPage(currentPage - 1); loadDetail(changeFilter, currentPage - 1, searchTerm); }}>
                    Prev
                  </button>
                  <button className="text-xs px-2 py-1 rounded bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] disabled:opacity-30"
                          disabled={currentPage >= totalPages}
                          onClick={() => { setCurrentPage(currentPage + 1); loadDetail(changeFilter, currentPage + 1, searchTerm); }}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ---------- Main Page ---------- */

export function TrendsPage() {
  const { runs, run1Id, run2Id, setRun1Id, setRun2Id, manifest, loading, error } = useCompareData();

  // Empty state
  if (!loading && runs.length === 0 && !error) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <motion.div
          className="flex flex-col items-center justify-center py-20 rounded-xl border border-[var(--border-default)]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <div className="text-4xl mb-4 opacity-40">~</div>
          <div className="text-[var(--text-secondary)] text-lg font-medium">No tracking runs yet</div>
          <div className="text-[var(--text-muted)] text-sm mt-1">
            Run a diagnostics collection to start building trend data.
          </div>
        </motion.div>
      </div>
    );
  }

  // Group datasets by category
  const grouped = manifest
    ? CATEGORY_ORDER.map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        datasets: manifest.datasets.filter((d) => d.category === cat),
      })).filter((g) => g.datasets.length > 0)
    : [];

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      {/* Run selector row */}
      <motion.div className="flex flex-wrap items-center gap-3"
                  initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}>
        <span className="text-sm text-[var(--text-muted)]">Run 1:</span>
        <select
          className="text-sm font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] min-w-[280px]"
          value={run1Id ?? ''}
          onChange={(e) => e.target.value && setRun1Id(Number(e.target.value))}
        >
          <option value="">Select run...</option>
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              #{r.run_id} &mdash; {formatDate(r.run_at)} ({r.user_count ?? '?'} users)
            </option>
          ))}
        </select>

        <span className="text-sm font-semibold text-[var(--text-muted)]">vs</span>

        <span className="text-sm text-[var(--text-muted)]">Run 2:</span>
        <select
          className="text-sm font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] min-w-[280px]"
          value={run2Id ?? ''}
          onChange={(e) => e.target.value && setRun2Id(Number(e.target.value))}
        >
          <option value="">Select run...</option>
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              #{r.run_id} &mdash; {formatDate(r.run_at)} ({r.user_count ?? '?'} users)
            </option>
          ))}
        </select>

        {run1Id && run2Id && manifest && (
          <div className="ml-auto text-xs text-[var(--text-muted)]">
            {manifest.datasets.length} datasets compared
          </div>
        )}
      </motion.div>

      {/* Error */}
      {error && (
        <motion.div
          className="text-sm text-[var(--neon-red)] bg-[var(--neon-red)]/10 rounded-lg px-4 py-3 border border-[var(--neon-red)]/20"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {error}
        </motion.div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Manifest content */}
      {!loading && manifest && run1Id && run2Id && (
        <>
          {/* Summary strip */}
          <SummaryStrip manifest={manifest} />

          {/* Category sections */}
          {grouped.map((group, gi) => (
            <div key={group.category}>
              <SectionHeader title={group.label} delay={gi + 1} />
              <div className="space-y-1.5">
                {group.datasets.map((ds, di) => (
                  <DatasetRow key={ds.datasetId} ds={ds} run1Id={run1Id} run2Id={run2Id}
                              delay={gi * 4 + di} />
                ))}
              </div>
            </div>
          ))}

          {/* Footer */}
          <motion.div className="text-xs text-[var(--text-muted)] text-center pt-4 pb-2"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            Comparing run #{run1Id} ({formatDate(String(manifest.run1.run_at || ''))}) vs
            run #{run2Id} ({formatDate(String(manifest.run2.run_at || ''))})
          </motion.div>
        </>
      )}
    </div>
  );
}
