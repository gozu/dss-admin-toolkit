import { useCallback, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { getBackendUrl } from '../utils/api';
import type {
  ModelAuditMode,
  ModelAuditReference,
  ModelAuditResult,
  ModelAuditRow,
  ModelAuditStatus,
} from '../types';

type SortKey = 'status' | 'canonicalModel' | 'referenceCount' | 'projectCount' | 'usedCount' | 'availableOnlyCount' | 'metadataCount' | 'fileStringCount';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | ModelAuditStatus;

const STATUS_ORDER: Record<ModelAuditStatus, number> = {
  ripoff: 0,
  obsolete: 1,
  unknown: 2,
  current: 3,
};

function statusClass(status: ModelAuditStatus): string {
  if (status === 'ripoff') return 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30';
  if (status === 'obsolete') return 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30';
  if (status === 'current') return 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30';
  return 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border-[var(--border-default)]';
}

function sourceLabel(source: string): string {
  if (source === 'used_recipe') return 'Used';
  if (source === 'available_llm') return 'Available';
  if (source === 'metadata') return 'Metadata';
  if (source === 'file_string') return 'File';
  return source;
}

function modeLabel(mode: ModelAuditMode | undefined): string {
  if (mode === 'metadata') return 'Aggressive metadata';
  if (mode === 'deep_files') return 'Deep file';
  return 'Used + available';
}

function formatPrice(price: ModelAuditRow['modelPrice']): string {
  if (!price) return '-';
  const input = price.input_usd_per_1m_tokens;
  const output = price.output_usd_per_1m_tokens;
  return `$${input} / $${output}`;
}

function formatFetchedAt(value: string | undefined): string {
  if (!value) return 'not fetched';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function readModelAuditStream(
  mode: ModelAuditMode,
  signal: AbortSignal,
  handlers: {
    onInit: (payload: Record<string, unknown>) => void;
    onProgress: (payload: Record<string, unknown>) => void;
    onDone: (payload: ModelAuditResult) => void;
  },
) {
  const url = getBackendUrl(`/api/tools/model-upgrade-audit/scan?mode=${mode}`);
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok || !response.body) {
    const body = await response.text();
    throw new Error(`Scan failed: ${response.status} ${response.statusText} ${body.slice(0, 160)}`);
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

      if (eventType === 'init') handlers.onInit(payload);
      if (eventType === 'progress') handlers.onProgress(payload);
      if (eventType === 'done') handlers.onDone(payload as unknown as ModelAuditResult);
      if (eventType === 'error') throw new Error(String(payload.error || 'Scan error'));
    }
  }
}

export function ModelUpgradeAuditReport() {
  const { state, setParsedData } = useDiag();
  const audit = state.parsedData.modelAudit || null;
  const loading = state.parsedData.modelAuditLoading;
  const isLoading = Boolean(loading?.active);
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const runScan = useCallback(
    async (mode: ModelAuditMode) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setParsedData({
        modelAuditLoading: {
          active: true,
          progressPct: 0,
          phase: 'starting',
          message: `Starting ${modeLabel(mode)} scan`,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      try {
        await readModelAuditStream(mode, controller.signal, {
          onInit: (payload) => {
            const total = Number(payload.total || 0);
            setParsedData({
              modelAuditLoading: {
                active: true,
                progressPct: 0,
                phase: 'catalog',
                message: total > 0 ? `${modeLabel(mode)} scan: ${total} projects queued` : `${modeLabel(mode)} scan queued`,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            });
          },
          onProgress: (payload) => {
            const progressPct = Math.max(0, Math.min(100, Number(payload.progressPct || 0)));
            const scanned = Number(payload.scanned || 0);
            const total = Number(payload.total || 0);
            setParsedData({
              modelAuditLoading: {
                active: true,
                progressPct,
                phase: String(payload.phase || mode),
                message: total > 0
                  ? `${modeLabel(mode)} scan: ${scanned}/${total} projects`
                  : String(payload.message || `${modeLabel(mode)} scan running`),
                startedAt: loading?.startedAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            });
          },
          onDone: (payload) => {
            setParsedData({
              modelAudit: payload,
              modelAuditLoading: {
                active: false,
                progressPct: 100,
                phase: 'done',
                message: `${modeLabel(payload.mode)} scan completed`,
                startedAt: loading?.startedAt,
                updatedAt: new Date().toISOString(),
              },
            });
          },
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setParsedData({
          modelAuditLoading: {
            active: false,
            progressPct: 0,
            phase: 'error',
            message: 'Model audit failed',
            startedAt: loading?.startedAt,
            updatedAt: new Date().toISOString(),
          },
        });
      } finally {
        abortRef.current = null;
      }
    },
    [loading?.startedAt, setParsedData],
  );

  const abortScan = useCallback(() => {
    abortRef.current?.abort();
    setParsedData({
      modelAuditLoading: {
        active: false,
        progressPct: 0,
        phase: 'aborted',
        message: 'Model audit aborted',
        startedAt: loading?.startedAt,
        updatedAt: new Date().toISOString(),
      },
    });
  }, [loading?.startedAt, setParsedData]);

  const referencesByRow = useMemo(() => {
    const map = new Map<string, ModelAuditReference[]>();
    (audit?.references || []).forEach((ref) => {
      const rows = map.get(ref.rowKey) || [];
      rows.push(ref);
      map.set(ref.rowKey, rows);
    });
    return map;
  }, [audit?.references]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = [...(audit?.rows || [])].filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      const refs = referencesByRow.get(row.rowKey) || [];
      return (
        row.canonicalModel.toLowerCase().includes(q) ||
        row.currentModel.toLowerCase().includes(q) ||
        row.provider.toLowerCase().includes(q) ||
        row.family.toLowerCase().includes(q) ||
        refs.some((ref) =>
          `${ref.projectKey} ${ref.projectName} ${ref.rawString} ${ref.context}`.toLowerCase().includes(q),
        )
      );
    });

    rows.sort((a, b) => {
      let result = 0;
      if (sortKey === 'status') {
        result = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      } else if (sortKey === 'canonicalModel') {
        result = a.canonicalModel.localeCompare(b.canonicalModel);
      } else {
        result = Number(a[sortKey] || 0) - Number(b[sortKey] || 0);
      }
      return sortDir === 'asc' ? result : -result;
    });

    return rows;
  }, [audit?.rows, query, referencesByRow, sortDir, sortKey, statusFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'canonicalModel' ? 'asc' : 'desc');
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const toggleExpanded = (rowKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const summary = audit?.summary;
  const filters: StatusFilter[] = ['all', 'ripoff', 'obsolete', 'unknown', 'current'];

  return (
    <div className="chart-container flex flex-col min-h-0" id="model-upgrade-audit-table">
      <div className="chart-header">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4>LLM Model Upgrade Audit</h4>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Finds expensive or stale OpenAI, Anthropic, and Gemini model references across projects.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => runScan('used_available')}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Refresh Audit
            </button>
            <button
              type="button"
              onClick={() => runScan('metadata')}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-md text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Aggressive Metadata Scan
            </button>
            <button
              type="button"
              onClick={() => runScan('deep_files')}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-md text-sm font-medium border border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning)]/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Slower and noisier: scans exported project file contents for model-looking strings."
            >
              Deep File Scan
            </button>
            {isLoading && (
              <button
                type="button"
                onClick={abortScan}
                className="px-3 py-1.5 rounded-md text-sm font-medium border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                Abort
              </button>
            )}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="px-4 py-3 border-b border-[var(--border-default)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{loading?.message || 'Model audit running'}</span>
            <span className="font-mono">{Math.round(loading?.progressPct || 0)}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-[var(--bg-glass)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 border-b border-[var(--border-default)] text-sm text-[var(--danger)]">
          <span className="font-medium">Scan error:</span> {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4 border-b border-[var(--border-default)]">
          <Metric label="Ripoff" value={summary.ripoffCount} tone="danger" />
          <Metric label="Obsolete" value={summary.obsoleteCount} tone="warning" />
          <Metric label="Unknown" value={summary.unknownModels} tone="muted" />
          <Metric label="Projects" value={summary.projectsScanned} tone="default" />
          <Metric label="Refs" value={summary.referencesFound} tone="default" />
          <Metric label="Mode" value={modeLabel(audit?.mode)} tone="default" />
        </div>
      )}

      <div className="p-4 border-b border-[var(--border-default)] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                statusFilter === filter
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]/30'
                  : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {filter === 'all' ? 'All' : filter}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter models, projects, refs..."
          className="w-full lg:w-80 px-3 py-1.5 text-sm rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      {!audit && !isLoading ? (
        <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
          Model audit has not completed yet. The default scan starts during live diagnostics.
        </div>
      ) : filteredRows.length === 0 && audit ? (
        <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
          No model references match the current filters.
        </div>
      ) : (
        <div className="card-scroll-body">
          <table className="table-dark">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => toggleSort('canonicalModel')}>
                  Model{sortIndicator('canonicalModel')}
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status{sortIndicator('status')}
                </th>
                <th>Current</th>
                <th className="text-right">Price</th>
                <th className="cursor-pointer select-none text-right" onClick={() => toggleSort('projectCount')}>
                  Projects{sortIndicator('projectCount')}
                </th>
                <th className="cursor-pointer select-none text-right" onClick={() => toggleSort('referenceCount')}>
                  Refs{sortIndicator('referenceCount')}
                </th>
                <th className="text-right">Sources</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const refs = referencesByRow.get(row.rowKey) || [];
                const isExpanded = expanded.has(row.rowKey);
                return (
                  <tr key={row.rowKey} className="align-top">
                    <td colSpan={7} className="!p-0">
                      <div
                        className="grid grid-cols-[minmax(240px,1.5fr)_120px_minmax(180px,1fr)_150px_90px_90px_160px] items-center px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                        onClick={() => toggleExpanded(row.rowKey)}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--text-muted)]">{isExpanded ? '▼' : '▶'}</span>
                            <span className="font-mono text-[var(--text-primary)] truncate">{row.canonicalModel}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)] truncate">
                            {[row.provider, row.family].filter(Boolean).join(' · ') || row.unknownReason || 'Unmatched model reference'}
                          </div>
                        </div>
                        <div>
                          <span className={`inline-flex px-2 py-0.5 rounded-md border text-xs font-medium ${statusClass(row.status)}`}>
                            {row.status}
                          </span>
                        </div>
                        <div className="font-mono text-xs text-[var(--text-secondary)] truncate">{row.currentModel || '-'}</div>
                        <div className="font-mono text-xs text-right text-[var(--text-secondary)]">{formatPrice(row.modelPrice)}</div>
                        <div className="font-mono text-right text-[var(--text-primary)]">{row.projectCount}</div>
                        <div className="font-mono text-right text-[var(--text-primary)]">{row.referenceCount}</div>
                        <div className="font-mono text-xs text-right text-[var(--text-muted)]">
                          {row.usedCount}/{row.availableOnlyCount}/{row.metadataCount}/{row.fileStringCount}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-8 pb-4 border-t border-[var(--border-default)]/60 bg-[var(--bg-surface)]">
                          <div className="py-2 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                            used / available / metadata / file
                          </div>
                          <div className="overflow-auto max-h-72">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-[var(--text-muted)]">
                                  <th className="py-1 text-left font-normal">Project</th>
                                  <th className="py-1 text-left font-normal">Source</th>
                                  <th className="py-1 text-left font-normal">Context</th>
                                  <th className="py-1 text-left font-normal">Raw ref</th>
                                  <th className="py-1 text-left font-normal">Confidence</th>
                                </tr>
                              </thead>
                              <tbody>
                                {refs.slice(0, 80).map((ref, index) => (
                                  <tr key={`${ref.projectKey}-${ref.source}-${ref.rawString}-${index}`} className="text-xs border-t border-[var(--border-default)]/30">
                                    <td className="py-1 pr-3">
                                      <div className="text-[var(--text-primary)]">{ref.projectName || ref.projectKey}</div>
                                      <div className="font-mono text-[var(--text-muted)]">{ref.projectKey}</div>
                                    </td>
                                    <td className="py-1 pr-3 text-[var(--text-secondary)]">{sourceLabel(ref.source)}</td>
                                    <td className="py-1 pr-3 text-[var(--text-muted)]">{ref.context || '-'}</td>
                                    <td className="py-1 pr-3 font-mono text-[var(--text-secondary)]">{ref.rawString}</td>
                                    <td className="py-1 text-[var(--text-muted)]">{ref.confidence}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {refs.length > 80 && (
                            <div className="mt-2 text-xs text-[var(--text-muted)]">
                              Showing first 80 of {refs.length} references.
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {audit && (
        <div className="px-4 py-2 border-t border-[var(--border-default)] text-xs text-[var(--text-muted)] flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <span>Pricing source: {audit.sourceUrl}</span>
          <span>Fetched: {formatFetchedAt(audit.fetchedAt)}</span>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'danger' | 'warning' | 'muted' | 'default';
}) {
  const color =
    tone === 'danger'
      ? 'text-[var(--danger)]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : tone === 'muted'
          ? 'text-[var(--text-tertiary)]'
          : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
      <div className={`text-xl font-mono ${color}`}>{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}
