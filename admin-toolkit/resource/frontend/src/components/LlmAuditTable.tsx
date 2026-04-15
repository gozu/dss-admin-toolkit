import { useMemo, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableSort } from '../hooks/useTableSort';
import type { LlmAuditRow, LlmAuditStatus } from '../types';

type SortKey =
  | 'status'
  | 'friendlyName'
  | 'type'
  | 'connection'
  | 'effectiveModel'
  | 'currentModel'
  | 'modelInputPrice'
  | 'modelOutputPrice'
  | 'projectsUsing';

const STATUS_ORDER: Record<LlmAuditStatus, number> = {
  ripoff: 0,
  obsolete: 1,
  unknown: 2,
  current: 3,
  not_applicable: 4,
};

const STATUS_LABEL: Record<LlmAuditStatus, string> = {
  ripoff: 'Ripoff',
  obsolete: 'Obsolete',
  unknown: 'Unknown',
  current: 'Current',
  not_applicable: 'N/A',
};

function statusBadgeClass(status: LlmAuditStatus): string {
  switch (status) {
    case 'ripoff':
      return 'bg-[var(--neon-red)]/20 text-[var(--neon-red)] border border-[var(--neon-red)]/40 pulse-glow';
    case 'obsolete':
      return 'bg-[var(--neon-amber)]/20 text-[var(--neon-amber)] border border-[var(--neon-amber)]/40';
    case 'current':
      return 'bg-[var(--neon-green)]/20 text-[var(--neon-green)] border border-[var(--neon-green)]/40';
    case 'unknown':
      return 'bg-[var(--text-tertiary)]/15 text-[var(--text-secondary)] border border-[var(--text-tertiary)]/30';
    case 'not_applicable':
    default:
      return 'bg-[var(--text-tertiary)]/10 text-[var(--text-tertiary)] italic border border-[var(--text-tertiary)]/20';
  }
}

function priceDeltaClass(model: number | null | undefined, current: number | null | undefined): string {
  if (model == null || current == null) return 'text-[var(--text-secondary)]';
  if (model > current) return 'text-[var(--neon-red)]';
  if (model < current) return 'text-[var(--neon-green)]';
  return 'text-[var(--text-secondary)]';
}

function formatPrice(value: number | null | undefined): string {
  if (value == null) return '\u2014';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffSec = Math.max(0, (Date.now() - ts) / 1000);
  if (diffSec < 60) return `${Math.round(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

interface GroupedRow {
  llmId: string;
  status: LlmAuditStatus;
  friendlyName: string;
  friendlyNameShort: string;
  type: string;
  connection: string;
  rawModel: string;
  effectiveModel: string;
  currentModel: string;
  modelInputPrice: number | null;
  modelOutputPrice: number | null;
  currentInputPrice: number | null;
  currentOutputPrice: number | null;
  provider: string;
  family: string;
  projectsUsing: number;
  sampleProjects: string[];
}

export function LlmAuditTable() {
  const { state } = useDiag();
  const audit = state.parsedData.llmAudit;
  const loading = state.parsedData.llmAuditLoading;
  const isLoading = Boolean(loading?.active);
  const rows: LlmAuditRow[] = useMemo(() => audit?.rows || [], [audit]);

  const [statusFilter, setStatusFilter] = useState<Set<LlmAuditStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [openProjectsFor, setOpenProjectsFor] = useState<string | null>(null);

  const grouped: GroupedRow[] = useMemo(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of rows) {
      const key = r.llmId || `${r.connection || '-'}::${r.rawModel || r.effectiveModel || '-'}`;
      const existing = map.get(key);
      if (existing) {
        existing.projectsUsing += 1;
        if (existing.sampleProjects.length < 50) existing.sampleProjects.push(r.projectKey);
        continue;
      }
      map.set(key, {
        llmId: r.llmId || key,
        status: r.status,
        friendlyName: r.friendlyName || r.llmId || '',
        friendlyNameShort: r.friendlyNameShort || r.friendlyName || r.llmId || '',
        type: r.type || '',
        connection: r.connection || '',
        rawModel: r.rawModel || '',
        effectiveModel: r.effectiveModel || r.rawModel || '',
        currentModel: r.currentModel || '',
        modelInputPrice: r.modelInputPrice ?? null,
        modelOutputPrice: r.modelOutputPrice ?? null,
        currentInputPrice: r.currentInputPrice ?? null,
        currentOutputPrice: r.currentOutputPrice ?? null,
        provider: r.provider || '',
        family: r.family || '',
        projectsUsing: 1,
        sampleProjects: [r.projectKey],
      });
    }
    return Array.from(map.values());
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grouped.filter((r) => {
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) return false;
      if (!q) return true;
      return (
        r.friendlyName.toLowerCase().includes(q) ||
        r.llmId.toLowerCase().includes(q) ||
        r.effectiveModel.toLowerCase().includes(q) ||
        r.rawModel.toLowerCase().includes(q) ||
        (r.connection || '').toLowerCase().includes(q) ||
        (r.currentModel || '').toLowerCase().includes(q)
      );
    });
  }, [grouped, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<LlmAuditStatus, number> = {
      ripoff: 0,
      obsolete: 0,
      current: 0,
      unknown: 0,
      not_applicable: 0,
    };
    for (const r of grouped) c[r.status] += 1;
    return c;
  }, [grouped]);

  const distinctModels = useMemo(() => {
    const r = new Set<string>();
    const o = new Set<string>();
    for (const g of grouped) {
      const k = g.effectiveModel || g.rawModel;
      if (!k) continue;
      if (g.status === 'ripoff') r.add(k);
      if (g.status === 'obsolete') o.add(k);
    }
    return { ripoff: r.size, obsolete: o.size };
  }, [grouped]);

  const { sortKey, sortDir, handleSort, sortIndicator } = useTableSort<SortKey>({
    defaultKey: 'status',
    ascDefaultKeys: ['status', 'friendlyName', 'type', 'connection', 'effectiveModel', 'currentModel'],
  });

  const sorted = useMemo(() => {
    const clone = [...filtered];
    clone.sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case 'status':
          result = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (result === 0) result = a.friendlyName.localeCompare(b.friendlyName);
          break;
        case 'friendlyName':
          result = a.friendlyName.localeCompare(b.friendlyName);
          break;
        case 'type':
          result = a.type.localeCompare(b.type);
          break;
        case 'connection':
          result = (a.connection || '').localeCompare(b.connection || '');
          break;
        case 'effectiveModel':
          result = a.effectiveModel.localeCompare(b.effectiveModel);
          break;
        case 'currentModel':
          result = (a.currentModel || '').localeCompare(b.currentModel || '');
          break;
        case 'modelInputPrice':
          result = (a.modelInputPrice ?? -1) - (b.modelInputPrice ?? -1);
          break;
        case 'modelOutputPrice':
          result = (a.modelOutputPrice ?? -1) - (b.modelOutputPrice ?? -1);
          break;
        case 'projectsUsing':
          result = a.projectsUsing - b.projectsUsing;
          break;
      }
      return sortDir === 'asc' ? result : -result;
    });
    return clone;
  }, [filtered, sortKey, sortDir]);

  const toggleStatusFilter = (s: LlmAuditStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const openRow = sorted.find((r) => r.llmId === openProjectsFor) || null;

  return (
    <div className="space-y-4">
      <SummaryCard
        total={grouped.length}
        counts={counts}
        distinct={distinctModels}
        pricingFetchedAt={audit?.pricingFetchedAt}
        loading={isLoading}
      />

      <div
        className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]"
        id="llm-audit-table"
      >
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-lg font-semibold text-[var(--text-primary)]">
              {grouped.length > 0
                ? statusFilter.size > 0 || search
                  ? `${sorted.length} of ${grouped.length} LLM profiles`
                  : `${grouped.length} LLM profiles`
                : 'LLM profiles'}
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              {(['ripoff', 'obsolete', 'unknown', 'current', 'not_applicable'] as LlmAuditStatus[]).map(
                (s) => {
                  const active = statusFilter.has(s);
                  const c = counts[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatusFilter(s)}
                      className={`px-2 py-0.5 text-xs font-semibold rounded transition-all ${statusBadgeClass(s)} ${active ? 'ring-2 ring-[var(--neon-cyan)]/60' : 'opacity-70 hover:opacity-100'}`}
                    >
                      {STATUS_LABEL[s]} {c}
                    </button>
                  );
                },
              )}
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search model / connection..."
                className="ml-2 px-2 py-1 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-glass)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--neon-cyan)]/50 w-[220px]"
              />
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="px-4 py-3 border-b border-[var(--border-glass)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>{loading?.message || 'Scanning...'}</span>
              <span className="font-mono">
                {Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[var(--bg-glass)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--neon-cyan)] to-[var(--neon-green)] transition-all duration-300 ease-out"
                style={{
                  width: `${Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%`,
                }}
              />
            </div>
          </div>
        )}

        {grouped.length === 0 && !isLoading ? (
          <div className="p-6 text-sm text-[var(--text-secondary)]">
            No LLM profiles found. Either this instance has no LLM Mesh connections configured, or the
            scan failed — see the page logs for details.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-elevated)] sticky top-0">
                <tr>
                  <Th onClick={() => handleSort('status')} indicator={sortIndicator('status')}>
                    Status
                  </Th>
                  <Th onClick={() => handleSort('friendlyName')} indicator={sortIndicator('friendlyName')}>
                    LLM
                  </Th>
                  <Th onClick={() => handleSort('type')} indicator={sortIndicator('type')}>
                    Type
                  </Th>
                  <Th onClick={() => handleSort('connection')} indicator={sortIndicator('connection')}>
                    Connection
                  </Th>
                  <Th onClick={() => handleSort('effectiveModel')} indicator={sortIndicator('effectiveModel')}>
                    Model
                  </Th>
                  <Th onClick={() => handleSort('currentModel')} indicator={sortIndicator('currentModel')}>
                    Replacement
                  </Th>
                  <Th
                    onClick={() => handleSort('modelInputPrice')}
                    indicator={sortIndicator('modelInputPrice')}
                    align="right"
                  >
                    In $/1M
                  </Th>
                  <Th
                    onClick={() => handleSort('modelOutputPrice')}
                    indicator={sortIndicator('modelOutputPrice')}
                    align="right"
                  >
                    Out $/1M
                  </Th>
                  <Th
                    onClick={() => handleSort('projectsUsing')}
                    indicator={sortIndicator('projectsUsing')}
                    align="right"
                  >
                    Projects
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-glass)]">
                {sorted.map((r) => (
                  <tr key={r.llmId} className="hover:bg-[var(--bg-glass-hover)] transition-colors">
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded ${statusBadgeClass(r.status)}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-[var(--text-primary)] text-sm">{r.friendlyNameShort}</div>
                      <div className="font-mono text-[11px] text-[var(--text-tertiary)] break-all">
                        {r.llmId}
                      </div>
                      {r.provider && r.family && (
                        <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                          {r.provider} · {r.family}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-[var(--text-secondary)]">
                      {r.connection || '\u2014'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-sm text-[var(--text-primary)] break-all">
                        {r.effectiveModel || '\u2014'}
                      </div>
                      {r.rawModel && r.effectiveModel && r.rawModel !== r.effectiveModel && (
                        <div
                          className="font-mono text-[11px] text-[var(--text-tertiary)] mt-0.5 break-all"
                          title="Original DSS model string before CustomLLM unwrap"
                        >
                          raw: {r.rawModel}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {r.currentModel ? (
                        <span className="font-mono text-sm text-[var(--neon-cyan)] break-all">
                          {r.currentModel}
                        </span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">{'\u2014'}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 align-top text-right font-mono text-sm ${priceDeltaClass(r.modelInputPrice, r.currentInputPrice)}`}
                    >
                      {formatPrice(r.modelInputPrice)}
                      {r.currentInputPrice != null && r.modelInputPrice != null && (
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          vs {formatPrice(r.currentInputPrice)}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 align-top text-right font-mono text-sm ${priceDeltaClass(r.modelOutputPrice, r.currentOutputPrice)}`}
                    >
                      {formatPrice(r.modelOutputPrice)}
                      {r.currentOutputPrice != null && r.modelOutputPrice != null && (
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          vs {formatPrice(r.currentOutputPrice)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <button
                        type="button"
                        onClick={() => setOpenProjectsFor(r.llmId)}
                        className={`font-mono text-sm hover:underline ${r.projectsUsing >= 50 ? 'text-[var(--neon-amber)]' : 'text-[var(--neon-cyan)]'}`}
                      >
                        {r.projectsUsing}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openRow && (
        <ProjectsModal
          row={openRow}
          onClose={() => setOpenProjectsFor(null)}
        />
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  indicator,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  indicator: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 text-${align || 'left'} text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] cursor-pointer select-none hover:text-[var(--neon-cyan)]`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="text-[var(--text-tertiary)]">{indicator}</span>
      </span>
    </th>
  );
}

function SummaryCard({
  total,
  counts,
  distinct,
  pricingFetchedAt,
  loading,
}: {
  total: number;
  counts: Record<LlmAuditStatus, number>;
  distinct: { ripoff: number; obsolete: number };
  pricingFetchedAt: string | null | undefined;
  loading: boolean;
}) {
  const tiles: Array<{ label: string; value: number; sub?: string; color: string }> = [
    {
      label: 'Profiles',
      value: total,
      color: 'text-[var(--text-primary)]',
    },
    {
      label: 'Ripoff',
      value: counts.ripoff,
      sub: distinct.ripoff > 0 ? `${distinct.ripoff} distinct model(s)` : undefined,
      color: 'text-[var(--neon-red)]',
    },
    {
      label: 'Obsolete',
      value: counts.obsolete,
      sub: distinct.obsolete > 0 ? `${distinct.obsolete} distinct model(s)` : undefined,
      color: 'text-[var(--neon-amber)]',
    },
    {
      label: 'Current',
      value: counts.current,
      color: 'text-[var(--neon-green)]',
    },
    {
      label: 'Unknown',
      value: counts.unknown,
      sub: 'See raw model string',
      color: 'text-[var(--text-secondary)]',
    },
  ];

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl shadow-md border border-[var(--border-glass)]">
      <div className="px-4 py-3 border-b border-[var(--border-glass)] flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">LLM Model Audit</h3>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            Cross-instance scan against the LiteLLM pricing catalog. Pricing fetched{' '}
            {formatRelative(pricingFetchedAt)}.
          </p>
        </div>
        {loading && (
          <span className="text-xs text-[var(--neon-cyan)] flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full animate-spin" />
            scanning
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-[var(--border-glass)]">
        {tiles.map((t) => (
          <div key={t.label} className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {t.label}
            </div>
            <div className={`text-2xl font-semibold ${t.color}`}>{t.value}</div>
            {t.sub && <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsModal({ row, onClose }: { row: GroupedRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-surface)] rounded-xl shadow-xl border border-[var(--border-glass)] max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border-glass)] flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-[var(--text-primary)]">
              Projects using {row.friendlyNameShort}
            </h4>
            <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-0.5">{row.llmId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] rounded"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-4 text-sm">
          <p className="text-xs text-[var(--text-tertiary)] mb-2">
            {row.projectsUsing} project(s) total
            {row.sampleProjects.length < row.projectsUsing
              ? ` (showing first ${row.sampleProjects.length})`
              : ''}
          </p>
          <ul className="space-y-1 font-mono text-xs">
            {row.sampleProjects.map((pk) => (
              <li key={pk} className="text-[var(--text-secondary)]">
                {pk}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
