import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import { fetchJson } from '../../utils/api';
import type {
  CompareManifest,
  CompareDatasetSummary,
  CompareDatasetDetail,
  CompareScalarField,
  CompareRowDiff,
  CompareSummaryDelta,
  DatasetCategory,
} from '../../types';

/* ---------- Constants ---------- */

interface TrendsRun {
  run_id: number;
  run_at: string;
  health_score: number | null;
  user_count: number | null;
  project_count: number | null;
}

const CATEGORY_ORDER: DatasetCategory[] = [
  'run_summary',
  'health_metrics',
  'snapshot_entities',
  'lifecycle',
  'metadata',
];

const CATEGORY_LABELS: Record<DatasetCategory, string> = {
  run_summary: 'Run Summary',
  health_metrics: 'Health Metrics',
  snapshot_entities: 'Snapshot Entities',
  lifecycle: 'Lifecycle / Interval Data',
  metadata: 'Metadata / Admin',
};

const SUPPORT_LABELS: Record<string, string> = {
  full: 'Full Diff',
  lifecycle: 'Lifecycle',
  current_only: 'Current Only',
};

const SUPPORT_COLORS: Record<string, string> = {
  full: 'var(--neon-green)',
  lifecycle: 'var(--neon-amber)',
  current_only: 'var(--text-muted)',
};

const FILTER_OPTIONS = ['all', 'added', 'removed', 'changed', 'unchanged'] as const;
type FilterType = (typeof FILTER_OPTIONS)[number];

const FILTER_COLORS: Record<string, string> = {
  all: 'var(--text-secondary)',
  added: 'var(--neon-green)',
  removed: 'var(--neon-red)',
  changed: 'var(--neon-amber)',
  unchanged: 'var(--text-muted)',
};

/* ---------- Helpers ---------- */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatNum(v: unknown): string {
  if (v === null || v === undefined) return '--';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

/* ---------- URL state ---------- */

function useUrlState() {
  const getParam = (key: string) => {
    try { return new URLSearchParams(window.location.search).get(key); } catch { return null; }
  };
  const setParams = useCallback((updates: Record<string, string | null>) => {
    try {
      const sp = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) sp.delete(k); else sp.set(k, v);
      }
      const qs = sp.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    } catch { /* iframe restrictions */ }
  }, []);
  return { getParam, setParams };
}

/* ---------- Data hook (Step 35) ---------- */

function useTrendsCompare() {
  const { addDebugLog } = useDiag();
  const { getParam, setParams } = useUrlState();

  const [runs, setRuns] = useState<TrendsRun[]>([]);
  const [run1Id, setRun1Id] = useState<number | null>(() => {
    const p = getParam('run1');
    return p ? Number(p) : null;
  });
  const [run2Id, setRun2Id] = useState<number | null>(() => {
    const p = getParam('run2');
    return p ? Number(p) : null;
  });
  const [manifest, setManifest] = useState<CompareManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch runs list
  useEffect(() => {
    let c = false;
    fetchJson<{ runs: TrendsRun[] }>('/api/tracking/runs?limit=100')
      .then((data) => {
        if (c) return;
        const list = data.runs ?? [];
        setRuns(list);
        // Step 36: newest = run1 default
        if (list.length > 0 && !run1Id) setRun1Id(list[0].run_id);
        // Step 37: oldest = run2 default
        if (list.length > 1 && !run2Id) setRun2Id(list[list.length - 1].run_id);
        if (list.length <= 1) setLoading(false);
        addDebugLog(`[trends] Fetched ${list.length} runs`, 'trends');
      })
      .catch((err) => {
        if (!c) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); }
      });
    return () => { c = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch manifest when runs selected
  useEffect(() => {
    if (!run1Id || !run2Id) return;
    let c = false;
    setLoading(true);
    setError(null);
    setParams({ run1: String(run1Id), run2: String(run2Id) });
    const t0 = performance.now();
    fetchJson<CompareManifest>(`/api/tracking/compare/full?run1=${run1Id}&run2=${run2Id}`)
      .then((data) => {
        if (c) return;
        if (data.swapped) {
          setRun1Id(data.run1.run_id);
          setRun2Id(data.run2.run_id);
        }
        setManifest(data);
        addDebugLog(`[trends] Manifest loaded in ${(performance.now() - t0).toFixed(0)}ms`, 'trends');
      })
      .catch((err) => {
        if (!c) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run1Id, run2Id]);

  const selectRun1 = useCallback((id: number) => setRun1Id(id), []);
  const selectRun2 = useCallback((id: number) => setRun2Id(id), []);

  return { runs, run1Id, run2Id, manifest, loading, error, selectRun1, selectRun2 };
}

/* ---------- Lazy detail loader (Step 43) ---------- */

function useDatasetDetail(run1Id: number | null, run2Id: number | null) {
  const [cache, setCache] = useState<Record<string, CompareDatasetDetail>>({});
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());

  const load = useCallback((datasetId: string, changeType: string = 'all', page: number = 1, search?: string, sort?: string) => {
    if (!run1Id || !run2Id) return;
    const key = `${datasetId}:${changeType}:${page}:${search || ''}:${sort || ''}`;
    setLoadingSet((s) => new Set(s).add(datasetId));
    const params = new URLSearchParams({
      run1: String(run1Id), run2: String(run2Id), dataset: datasetId,
      change_type: changeType, page: String(page), page_size: '100',
    });
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    fetchJson<CompareDatasetDetail>(`/api/tracking/compare/full/dataset?${params}`)
      .then((data) => {
        setCache((c) => ({ ...c, [key]: data, [datasetId]: data }));
      })
      .finally(() => {
        setLoadingSet((s) => { const n = new Set(s); n.delete(datasetId); return n; });
      });
  }, [run1Id, run2Id]);

  return { cache, loadingSet, load };
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

/* Step 39: Summary band */
function SummaryBand({ manifest }: { manifest: CompareManifest }) {
  const s = manifest.summary;
  const chips: { label: string; data: CompareSummaryDelta }[] = [
    { label: 'Health', data: s.healthScore },
    { label: 'Users', data: s.userCount },
    { label: 'Projects', data: s.projectCount },
    { label: 'Plugins', data: s.pluginCount },
    { label: 'Connections', data: s.connectionCount },
    { label: 'Code Envs', data: s.codeEnvCount },
  ];

  return (
    <motion.div
      className="sticky top-0 z-10 glass-card border-[var(--border-glow)] shadow-[var(--glow-sm)] px-4 py-3"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex flex-wrap gap-4 items-center">
        {chips.map(({ label, data }) => (
          <DeltaChip key={label} label={label} data={data} />
        ))}
        {s.coverageStatus.run1 !== 'complete' && (
          <span className="text-xs px-2 py-1 rounded bg-[var(--neon-amber)]/10 text-[var(--neon-amber)]">
            Run 1: {s.coverageStatus.run1}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function DeltaChip({ label, data }: { label: string; data: CompareSummaryDelta }) {
  const v1 = data.run1;
  const delta = data.delta;
  const color = delta === null || delta === 0 ? 'var(--text-muted)' : delta > 0 ? 'var(--neon-green)' : 'var(--neon-red)';
  const sign = delta !== null && delta > 0 ? '+' : '';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{formatNum(v1)}</span>
      {delta !== null && delta !== 0 && (
        <span className="text-xs font-mono px-1.5 py-0.5 rounded-full" style={{ color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}>
          {sign}{formatNum(delta)}
          {data.pctDelta !== null ? ` (${sign}${data.pctDelta}%)` : ''}
        </span>
      )}
    </div>
  );
}

/* Step 40: Category sections */
function CategorySection({ category, datasets, onExpand, expandedSet, detailCache, detailLoading, onReload }: {
  category: DatasetCategory;
  datasets: CompareDatasetSummary[];
  onExpand: (id: string) => void;
  expandedSet: Set<string>;
  detailCache: Record<string, CompareDatasetDetail>;
  detailLoading: Set<string>;
  onReload: (datasetId: string, changeType: string, page?: number, search?: string) => void;
}) {
  if (datasets.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3 pt-4 pb-2">
        <h3 className="text-base font-semibold text-[var(--text-secondary)] tracking-wide uppercase">
          {CATEGORY_LABELS[category]}
        </h3>
        <div className="flex-1 h-px bg-[var(--border-default)]" />
        <span className="text-xs text-[var(--text-muted)]">{datasets.length} datasets</span>
      </div>
      <div className="space-y-2">
        {datasets.map((ds) => (
          <DatasetSection
            key={ds.datasetId}
            ds={ds}
            expanded={expandedSet.has(ds.datasetId)}
            onToggle={() => onExpand(ds.datasetId)}
            detail={detailCache[ds.datasetId]}
            isLoading={detailLoading.has(ds.datasetId)}
            onReload={(ct, pg, s) => onReload(ds.datasetId, ct, pg, s)}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* Step 41: Dataset section headers */
function DatasetSection({ ds, expanded, onToggle, detail, isLoading, onReload }: {
  ds: CompareDatasetSummary;
  expanded: boolean;
  onToggle: () => void;
  detail?: CompareDatasetDetail;
  isLoading: boolean;
  onReload?: (changeType: string, page?: number, search?: string) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unavailable = !ds.availableInRun1 || !ds.availableInRun2;
  const showPagination = (ds.kind === 'keyed_table' || ds.kind === 'interval_events' || ds.kind === 'metadata')
    && detail && detail.totalRows !== undefined && detail.totalRows > (detail.pageSize ?? 100);
  const showSearch = ds.kind === 'keyed_table' || ds.kind === 'interval_events';
  const totalChanges = ds.added + ds.removed + ds.changed;
  const supportColor = SUPPORT_COLORS[ds.support] || 'var(--text-muted)';

  return (
    <div className="glass-card overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-glass-hover)] transition-colors"
        onClick={onToggle}
      >
        <span className="text-xs font-mono" style={{ color: supportColor, opacity: 0.8 }}>
          {expanded ? '▼' : '▶'}
        </span>
        <span className="font-semibold text-sm text-[var(--text-primary)] flex-1">{ds.label}</span>

        {/* Support badge */}
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: supportColor, border: `1px solid color-mix(in srgb, ${supportColor} 30%, transparent)` }}
        >
          {SUPPORT_LABELS[ds.support]}
        </span>

        {/* Count chips */}
        {!unavailable && ds.support !== 'current_only' && (
          <div className="flex gap-1.5">
            {ds.added > 0 && <CountChip count={ds.added} label="+" color="var(--neon-green)" />}
            {ds.removed > 0 && <CountChip count={ds.removed} label="-" color="var(--neon-red)" />}
            {ds.changed > 0 && <CountChip count={ds.changed} label="~" color="var(--neon-amber)" />}
            {totalChanges === 0 && <span className="text-xs text-[var(--text-muted)] font-mono">no changes</span>}
          </div>
        )}

        {/* Step 54: Unavailable badge */}
        {unavailable && (
          <span className="text-xs text-[var(--text-muted)] italic">
            {!ds.availableInRun1 && !ds.availableInRun2 ? 'not available' : `not available for ${!ds.availableInRun1 ? 'run 1' : 'run 2'}`}
          </span>
        )}

        {/* Row counts */}
        <span className="text-xs text-[var(--text-muted)] font-mono min-w-[60px] text-right">
          {ds.run1Count}/{ds.run2Count}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--border-glass)] px-4 py-3">
          {isLoading && <div className="text-sm text-[var(--text-muted)] animate-pulse">Loading detail...</div>}

          {/* Step 54: Unavailable state */}
          {unavailable && !isLoading && (
            <div className="text-sm text-[var(--text-muted)] italic py-2">
              Not available for this run — data was not collected at the time of the selected run.
              {ds.notes && <span className="block mt-1 text-xs">{ds.notes}</span>}
            </div>
          )}

          {/* Step 55: Current-only labeling */}
          {ds.support === 'current_only' && !isLoading && detail && (
            <div>
              <div className="text-xs text-[var(--neon-amber)] mb-2 italic">
                This data is not historically versioned — showing current state only.
              </div>
              <MetadataTable detail={detail} />
            </div>
          )}

          {/* Search input */}
          {!unavailable && ds.support !== 'current_only' && showSearch && (
            <SearchInput
              value={searchTerm}
              onChange={(v) => {
                setSearchTerm(v);
                clearTimeout(searchTimerRef.current);
                searchTimerRef.current = setTimeout(() => onReload?.(activeFilter, 1, v), 400);
              }}
            />
          )}

          {/* Step 42: Filter chips for diffable datasets */}
          {!unavailable && ds.support !== 'current_only' && (ds.kind === 'keyed_table' || ds.kind === 'interval_events') && (
            <FilterChips
              active={activeFilter}
              counts={{ added: ds.added, removed: ds.removed, changed: ds.changed, unchanged: ds.unchanged }}
              onChange={(f) => { setActiveFilter(f); onReload?.(f, 1, searchTerm); }}
            />
          )}

          {/* Full / lifecycle content */}
          {!unavailable && ds.support !== 'current_only' && !isLoading && detail && (
            <DatasetContent ds={ds} detail={detail} />
          )}

          {/* Pagination */}
          {!unavailable && !isLoading && showPagination && detail && (
            <PaginationBar
              page={detail.page ?? 1}
              pageSize={detail.pageSize ?? 100}
              totalRows={detail.totalRows ?? 0}
              onPageChange={(p) => onReload?.(activeFilter, p, searchTerm)}
            />
          )}

          {/* Step 53: Zero-row empty state */}
          {!unavailable && !isLoading && detail && ds.run1Count === 0 && ds.run2Count === 0 && (
            <div className="text-sm text-[var(--text-muted)] py-2 text-center">
              No data in either run for this dataset.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CountChip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
      style={{ color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)` }}
    >
      {label}{count}
    </span>
  );
}

/* Step 42: Filter chips */
function FilterChips({ active, counts, onChange }: {
  active: FilterType;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  onChange: (f: FilterType) => void;
}) {
  return (
    <div className="flex gap-1.5 mb-3">
      {FILTER_OPTIONS.map((f) => {
        const c = f === 'all' ? counts.added + counts.removed + counts.changed + counts.unchanged : counts[f as keyof typeof counts] ?? 0;
        const isActive = active === f;
        const color = FILTER_COLORS[f];
        return (
          <button
            key={f}
            onClick={() => onChange(f)}
            className="text-[11px] font-mono px-2 py-1 rounded transition-colors"
            style={{
              color: isActive ? color : 'var(--text-muted)',
              background: isActive ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
              border: `1px solid ${isActive ? `color-mix(in srgb, ${color} 40%, transparent)` : 'transparent'}`,
            }}
          >
            {f} ({c})
          </button>
        );
      })}
    </div>
  );
}

/* Pagination bar */
function PaginationBar({ page, pageSize, totalRows, onPageChange }: {
  page: number; pageSize: number; totalRows: number; onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(totalRows / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-3 text-xs font-mono">
      <button
        className="px-2 py-1 rounded border border-[var(--border-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)] disabled:opacity-30"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Prev
      </button>
      <span className="text-[var(--text-muted)]">
        Page {page} of {totalPages} ({totalRows} rows)
      </span>
      <button
        className="px-2 py-1 rounded border border-[var(--border-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)] disabled:opacity-30"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

/* Search input */
function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder="Search rows..."
      className="w-full max-w-xs text-xs font-mono px-2.5 py-1.5 mb-2 rounded border border-[var(--border-glass)] bg-[var(--bg-glass)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-glow)]"
    />
  );
}

/* DatasetContent — routes to the right renderer */
function DatasetContent({ ds, detail }: { ds: CompareDatasetSummary; detail: CompareDatasetDetail }) {
  if (detail.fields) {
    return <ScalarView fields={detail.fields} />;
  }
  if (detail.rows) {
    if (ds.kind === 'interval_events') {
      return <LifecycleTable detail={detail} />;
    }
    return <KeyedTable detail={detail} />;
  }
  return null;
}

/* Step 45: Scalar comparison views */
function ScalarView({ fields }: { fields: CompareScalarField[] }) {
  return (
    <div className="space-y-0.5">
      {fields.map((f) => (
        <div
          key={f.field}
          className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[var(--bg-glass-hover)] transition-colors"
        >
          <span className="text-xs text-[var(--text-muted)] w-48 truncate font-mono">{f.field}</span>

          {f.kind === 'json' ? (
            <JsonFieldView field={f} />
          ) : f.kind === 'text' ? (
            <TextFieldView field={f} />
          ) : (
            <>
              <span className="font-mono text-sm text-[var(--text-primary)] w-32 text-right">{formatNum(f.run1Value)}</span>
              <span className="text-xs text-[var(--text-muted)]">was</span>
              <span className="font-mono text-sm text-[var(--text-secondary)] w-32 text-right">{formatNum(f.run2Value)}</span>
              {f.status === 'changed' && f.delta !== undefined && (
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded-full"
                  style={{
                    color: f.delta > 0 ? 'var(--neon-green)' : 'var(--neon-red)',
                    border: `1px solid color-mix(in srgb, ${f.delta > 0 ? 'var(--neon-green)' : 'var(--neon-red)'} 35%, transparent)`,
                  }}
                >
                  {f.delta > 0 ? '+' : ''}{formatNum(f.delta)}
                  {f.pctDelta !== undefined ? ` (${f.pctDelta > 0 ? '+' : ''}${f.pctDelta}%)` : ''}
                </span>
              )}
              {f.status === 'same' && (
                <span className="text-xs text-[var(--text-muted)]">--</span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* Step 46: JSON viewer */
function JsonFieldView({ field }: { field: CompareScalarField }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {open ? '▼' : '▶'} {field.status === 'changed' ? 'changed' : 'same'}
        </button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Run 1</div>
            <pre className="text-xs font-mono bg-[var(--bg-surface)] rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {typeof field.run1Value === 'string' ? field.run1Value : JSON.stringify(field.run1Value, null, 2) ?? 'null'}
            </pre>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Run 2</div>
            <pre className="text-xs font-mono bg-[var(--bg-surface)] rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {typeof field.run2Value === 'string' ? field.run2Value : JSON.stringify(field.run2Value, null, 2) ?? 'null'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* Step 47: Text diff viewer */
function TextFieldView({ field }: { field: CompareScalarField }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {open ? '▼' : '▶'} {field.status === 'changed' ? 'changed' : 'same'}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Run 1</div>
            <pre className="text-xs font-mono bg-[var(--bg-surface)] rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {String(field.run1Value ?? '')}
            </pre>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Run 2</div>
            <pre className="text-xs font-mono bg-[var(--bg-surface)] rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {String(field.run2Value ?? '')}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* Step 44: Paginated keyed table */
function KeyedTable({ detail }: { detail: CompareDatasetDetail }) {
  const rows = detail.rows ?? [];
  const cols = detail.columns ?? [];

  if (rows.length === 0) {
    return <div className="text-sm text-[var(--text-muted)] py-2">No rows match the current filter.</div>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-[var(--border-glass)]">
            <th className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal w-20">Status</th>
            {cols.map((c) => (
              <th key={c} className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <DiffRow key={i} row={row} columns={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({ row, columns }: { row: CompareRowDiff; columns: string[] }) {
  const statusColors: Record<string, string> = {
    added: 'var(--neon-green)',
    removed: 'var(--neon-red)',
    changed: 'var(--neon-amber)',
    unchanged: 'var(--text-muted)',
  };
  const color = statusColors[row.status] || 'var(--text-muted)';
  const data = row.run1 ?? row.run2 ?? {};

  return (
    <tr
      className="border-b border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)] transition-colors"
      style={{ opacity: row.status === 'unchanged' ? 0.6 : 1 }}
    >
      <td className="py-1 px-2">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ color, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)` }}
        >
          {row.status}
        </span>
      </td>
      {columns.map((c) => {
        const isChanged = row.changes.includes(c);
        const val = data[c];
        return (
          <td
            key={c}
            className="py-1 px-2 text-[var(--text-primary)] max-w-[200px] truncate"
            style={{ color: isChanged ? 'var(--neon-amber)' : undefined }}
            title={val !== null && val !== undefined ? String(val) : ''}
          >
            {val !== null && val !== undefined ? String(val) : <span className="text-[var(--text-muted)]">null</span>}
          </td>
        );
      })}
    </tr>
  );
}

/* Steps 48-51: Lifecycle table */
function LifecycleTable({ detail }: { detail: CompareDatasetDetail }) {
  const rows = detail.rows ?? [];
  const cols = detail.columns ?? [];

  if (rows.length === 0) {
    return <div className="text-sm text-[var(--text-muted)] py-2">No rows match the current filter.</div>;
  }

  const lifecycleColors: Record<string, string> = {
    opened_between_runs: 'var(--neon-green)',
    resolved_between_runs: 'var(--neon-green)',
    regressed_between_runs: 'var(--neon-red)',
    existed_in_both: 'var(--text-muted)',
    visible_only_in_run1: 'var(--neon-amber)',
    visible_only_in_run2: 'var(--neon-amber)',
    event_between_runs: 'var(--neon-green)',
    before_run2: 'var(--text-muted)',
    after_run1: 'var(--text-muted)',
    created_between_runs: 'var(--neon-green)',
    visible_at_run1: 'var(--text-secondary)',
    visible_at_run2: 'var(--text-muted)',
  };

  return (
    <div className="overflow-auto">
      {detail.notes && (
        <div className="text-xs text-[var(--neon-amber)] italic mb-2">{detail.notes}</div>
      )}
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-[var(--border-glass)]">
            <th className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal w-36">Lifecycle</th>
            {cols.slice(0, 8).map((c) => (
              <th key={c} className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const lc = row._lifecycle;
            const lcColor = lc ? lifecycleColors[lc] || 'var(--text-muted)' : 'var(--text-muted)';
            const data: Record<string, unknown> = row.run1 ?? row.run2 ?? (row as unknown as Record<string, unknown>);
            return (
              <tr key={i} className="border-b border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]">
                <td className="py-1 px-2">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{ color: lcColor, border: `1px solid color-mix(in srgb, ${lcColor} 40%, transparent)` }}
                  >
                    {lc?.replace(/_/g, ' ') ?? 'unknown'}
                  </span>
                </td>
                {cols.slice(0, 8).map((c) => {
                  const val = data[c as keyof typeof data];
                  return (
                    <td key={c} className="py-1 px-2 text-[var(--text-primary)] max-w-[180px] truncate"
                      title={val != null ? String(val) : ''}
                    >
                      {val != null ? String(val) : <span className="text-[var(--text-muted)]">null</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Step 52: Current-only metadata table */
function MetadataTable({ detail }: { detail: CompareDatasetDetail }) {
  const rows = detail.rows ?? [];
  const cols = detail.columns ?? [];

  if (rows.length === 0) {
    return <div className="text-sm text-[var(--text-muted)] py-2">No metadata rows.</div>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-[var(--border-glass)]">
            {cols.map((c) => (
              <th key={c} className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const data: Record<string, unknown> = row.run1 ?? row.run2 ?? (row as unknown as Record<string, unknown>);
            return (
              <tr key={i} className="border-b border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]">
                {cols.map((c) => {
                  const val = data[c];
                  return (
                    <td key={c} className="py-1 px-2 text-[var(--text-primary)] max-w-[200px] truncate">
                      {val != null ? String(val) : <span className="text-[var(--text-muted)]">null</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Main Page ---------- */

export function TrendsPage() {
  const { runs, run1Id, run2Id, manifest, loading, error, selectRun1, selectRun2 } = useTrendsCompare();
  const { cache: detailCache, loadingSet: detailLoading, load: loadDetail } = useDatasetDetail(run1Id, run2Id);

  // Track which datasets are expanded
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  // Auto-expand on manifest load (first few datasets)
  const manifetRef = useRef<CompareManifest | null>(null);
  useEffect(() => {
    if (manifest && manifest !== manifetRef.current) {
      manifetRef.current = manifest;
      // Auto-expand scalar datasets
      const toExpand = manifest.datasets
        .filter((d) => d.kind === 'scalar' && d.availableInRun1 && d.availableInRun2)
        .map((d) => d.datasetId);
      setExpandedSet(new Set(toExpand));
      // Preload scalar details
      for (const id of toExpand) {
        loadDetail(id);
      }
    }
  }, [manifest, loadDetail]);

  const handleToggle = useCallback((datasetId: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(datasetId)) {
        next.delete(datasetId);
      } else {
        next.add(datasetId);
        // Lazy load on expand
        if (!detailCache[datasetId]) {
          loadDetail(datasetId);
        }
      }
      return next;
    });
  }, [detailCache, loadDetail]);

  const handleReload = useCallback((datasetId: string, changeType: string, page?: number, search?: string) => {
    loadDetail(datasetId, changeType, page, search);
  }, [loadDetail]);

  // Group datasets by category
  const grouped = useMemo(() => {
    if (!manifest) return {};
    const g: Partial<Record<DatasetCategory, CompareDatasetSummary[]>> = {};
    for (const ds of manifest.datasets) {
      const cat = ds.category as DatasetCategory;
      if (!g[cat]) g[cat] = [];
      g[cat]!.push(ds);
    }
    return g;
  }, [manifest]);

  // Empty state: no runs at all
  if (!loading && runs.length === 0 && !error) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <motion.div
          className="flex flex-col items-center justify-center py-20 rounded-xl border border-[var(--border-default)]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <div className="text-4xl mb-4 opacity-40">~</div>
          <div className="text-[var(--text-secondary)] text-lg font-medium">No tracking runs yet</div>
          <div className="text-[var(--text-muted)] text-sm mt-1">
            Run a diagnostics collection to start building trend data.
          </div>
        </motion.div>
      </div>
    );
  }

  // Single-run state
  if (!loading && runs.length === 1 && !error) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <motion.div
          className="flex flex-col items-center justify-center py-20 rounded-xl border border-[var(--border-default)]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <div className="text-4xl mb-4 opacity-40">1</div>
          <div className="text-[var(--text-secondary)] text-lg font-medium">Only one run available</div>
          <div className="text-[var(--text-muted)] text-sm mt-1">
            Run another diagnostics collection to enable comparison.
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      {/* Run selectors (Steps 36-37) */}
      <motion.div
        className="flex flex-wrap items-center gap-3"
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">Run 1 (newer):</span>
          <select
            className="text-sm font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] min-w-[260px]"
            value={run1Id ?? ''}
            onChange={(e) => e.target.value && selectRun1(Number(e.target.value))}
          >
            <option value="">Select run...</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                #{r.run_id} — {formatDate(r.run_at)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">Run 2 (older):</span>
          <select
            className="text-sm font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] min-w-[260px]"
            value={run2Id ?? ''}
            onChange={(e) => e.target.value && selectRun2(Number(e.target.value))}
          >
            <option value="">Select run...</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                #{r.run_id} — {formatDate(r.run_at)}
              </option>
            ))}
          </select>
        </div>
      </motion.div>

      {/* Error display */}
      {error && (
        <motion.div
          className="text-sm text-[var(--neon-red)] bg-[var(--neon-red)]/10 rounded-lg px-4 py-3 border border-[var(--neon-red)]/20"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          {error}
        </motion.div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {/* Coverage warnings */}
      {manifest && manifest.coverageWarnings.length > 0 && (
        <motion.div
          className="text-xs space-y-1"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          {manifest.coverageWarnings.map((w, i) => (
            <div key={i} className="text-[var(--neon-amber)] bg-[var(--neon-amber)]/5 rounded px-3 py-1.5 border border-[var(--neon-amber)]/15">
              {w.message}
            </div>
          ))}
        </motion.div>
      )}

      {/* Summary band (Step 39) */}
      {manifest && <SummaryBand manifest={manifest} />}

      {/* Category sections (Step 40) */}
      {manifest && CATEGORY_ORDER.map((cat) => {
        const datasets = grouped[cat];
        if (!datasets || datasets.length === 0) return null;
        return (
          <CategorySection
            key={cat}
            category={cat}
            datasets={datasets}
            onExpand={handleToggle}
            expandedSet={expandedSet}
            detailCache={detailCache}
            detailLoading={detailLoading}
            onReload={handleReload}
          />
        );
      })}

      {/* Run metadata footer */}
      {manifest && (
        <motion.div
          className="text-xs text-[var(--text-muted)] text-center pt-4 pb-2"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        >
          Comparing run #{manifest.run1.run_id} ({formatDate(manifest.run1.run_at)})
          against run #{manifest.run2.run_id} ({formatDate(manifest.run2.run_at)})
          — {manifest.datasets.length} datasets
        </motion.div>
      )}
    </div>
  );
}
