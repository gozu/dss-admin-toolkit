import { useMemo, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { useTableSort } from '../hooks/useTableSort';
import { getRelativeSizeColor } from '../utils/formatters';
import type { ProjectFootprintHealth, ProjectFootprintRow } from '../types';

type SortKey =
  | 'projectKey'
  | 'codeEnvCount'
  | 'codeStudioCount'
  | 'savedModelCount'
  | 'bundleBytes'
  | 'managedDatasetsBytes'
  | 'managedFoldersBytes'
  | 'otherBytes'
  | 'totalBytes';

type ModelFilter =
  | 'all'
  | 'prediction'
  | 'binary'
  | 'multiclass'
  | 'regression'
  | 'timeseries'
  | 'clustering'
  | 'unknown';

function formatGb(bytes: number | undefined): string {
  const gb = (bytes || 0) / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

function formatAuto(bytes: number | undefined): string {
  const value = bytes || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[idx]}`;
}

function healthCellClass(value: ProjectFootprintHealth | undefined): string {
  if (!value) return 'text-[var(--text-secondary)]';
  if (value === 'green') {
    return 'text-[var(--neon-green)]';
  }
  if (value === 'yellow') {
    return 'text-[#facc15]';
  }
  if (value === 'orange') {
    return 'text-[var(--neon-amber)]';
  }
  if (value === 'red') {
    return 'text-[var(--neon-red)]';
  }
  return 'text-[var(--neon-red)] font-bold pulse-glow';
}

function codeEnvCountClass(count: number): string {
  if (count >= 5) return 'text-[var(--neon-red)] font-bold pulse-glow';
  if (count === 4) return 'text-[var(--neon-red)]';
  if (count === 3) return 'text-[var(--neon-amber)]';
  if (count === 2) return 'text-[#facc15]';
  return 'text-[var(--neon-green)]';
}

function codeStudioCountClass(count: number): string {
  if (count > 10) return 'text-[var(--neon-red)] font-bold pulse-glow';
  if (count > 7) return 'text-[var(--neon-red)]';
  if (count > 4) return 'text-[var(--neon-amber)]';
  if (count > 2) return 'text-[#facc15]';
  return 'text-[var(--neon-green)]';
}

const MODEL_FILTERS: Array<{ key: ModelFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'prediction', label: 'Prediction' },
  { key: 'binary', label: 'Binary' },
  { key: 'multiclass', label: 'Multiclass' },
  { key: 'regression', label: 'Regression' },
  { key: 'timeseries', label: 'Time series' },
  { key: 'clustering', label: 'Clustering' },
  { key: 'unknown', label: 'Unknown' },
];

function normalizeModelValue(value: string | undefined): string {
  return String(value || '').trim().toUpperCase();
}

function modelMatchesFilter(row: ProjectFootprintRow, filter: ModelFilter): boolean {
  if (filter === 'all') return true;
  const models = row.savedModels || [];
  if (models.length === 0) return false;
  return models.some((model) => {
    const type = normalizeModelValue(model.type);
    const predictionType = normalizeModelValue(model.predictionType);
    if (filter === 'prediction') return type === 'PREDICTION';
    if (filter === 'clustering') return type === 'CLUSTERING';
    if (filter === 'binary') return predictionType === 'BINARY_CLASSIFICATION';
    if (filter === 'multiclass') {
      return predictionType === 'MULTICLASS' || predictionType === 'MULTICLASS_CLASSIFICATION';
    }
    if (filter === 'regression') return predictionType === 'REGRESSION';
    if (filter === 'timeseries') {
      return predictionType === 'TIMESERIES_FORECAST' || predictionType === 'TIME_SERIES_FORECAST';
    }
    return type === 'UNKNOWN' || (!type && !predictionType);
  });
}

function formatSavedModelSummary(row: ProjectFootprintRow): string {
  if (row.savedModelSummary) return row.savedModelSummary;
  const models = row.savedModels || [];
  if (models.length === 0) return 'None';
  const counts = new Map<string, number>();
  for (const model of models) {
    const type = normalizeModelValue(model.type);
    const predictionType = normalizeModelValue(model.predictionType);
    let label = 'Unknown';
    if (type === 'CLUSTERING') label = 'Clustering';
    else if (predictionType === 'BINARY_CLASSIFICATION') label = 'Binary classification';
    else if (predictionType === 'MULTICLASS' || predictionType === 'MULTICLASS_CLASSIFICATION') label = 'Multiclass';
    else if (predictionType === 'REGRESSION') label = 'Regression';
    else if (predictionType === 'TIMESERIES_FORECAST' || predictionType === 'TIME_SERIES_FORECAST') label = 'Time series forecast';
    else if (type === 'PREDICTION') label = 'Prediction';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => (count === 1 ? label : `${count} ${label}`))
    .join(', ');
}

export function ProjectFootprintTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const rows = state.parsedData.projectFootprint || [];
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const loading = state.parsedData.projectFootprintLoading;
  const isLoading = Boolean(loading?.active);
  const avgProjectGb =
    state.parsedData.projectFootprintSummary?.instanceAvgProjectGB ??
    rows[0]?.instanceAvgProjectGB ??
    0;

  const {
    sortKey,
    sortDir,
    handleSort,
    sortIndicator: indicator,
  } = useTableSort<SortKey>({
    defaultKey: 'totalBytes',
    ascDefaultKeys: ['projectKey'],
  });

  const computeOtherBytes = (row: ProjectFootprintRow) => {
    const known = (row.bundleBytes || 0) + (row.managedDatasetsBytes || 0) + (row.managedFoldersBytes || 0);
    return Math.max(0, (row.totalBytes || 0) - known);
  };

  const modelFilterCounts = useMemo(() => {
    const counts: Record<ModelFilter, number> = {
      all: rows.length,
      prediction: 0,
      binary: 0,
      multiclass: 0,
      regression: 0,
      timeseries: 0,
      clustering: 0,
      unknown: 0,
    };
    for (const row of rows) {
      for (const filter of MODEL_FILTERS) {
        if (filter.key === 'all') continue;
        if (modelMatchesFilter(row, filter.key)) counts[filter.key] += 1;
      }
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter((row) => modelMatchesFilter(row, modelFilter)),
    [rows, modelFilter],
  );

  const sortedRows = useMemo(() => {
    const clone = [...filteredRows];
    clone.sort((a, b) => {
      if (sortKey === 'projectKey') {
        const result = a.projectKey.localeCompare(b.projectKey);
        return sortDir === 'asc' ? result : -result;
      }
      if (sortKey === 'otherBytes') {
        const aVal = computeOtherBytes(a);
        const bVal = computeOtherBytes(b);
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aVal = a[sortKey] || 0;
      const bVal = b[sortKey] || 0;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return clone;
  }, [filteredRows, sortKey, sortDir]);
  const hasCodeStudios = useMemo(() => rows.some((row) => (row.codeStudioCount ?? 0) > 0), [rows]);

  const maxBundleBytes = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.bundleBytes || 0), 0),
    [rows],
  );
  const maxManagedDatasetsBytes = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.managedDatasetsBytes || 0), 0),
    [rows],
  );
  const maxManagedFoldersBytes = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.managedFoldersBytes || 0), 0),
    [rows],
  );
  const maxOtherBytes = useMemo(
    () => rows.reduce((max, row) => Math.max(max, computeOtherBytes(row)), 0),
    [rows],
  );
  if (!isVisible('project-footprint-table') || (rows.length === 0 && !isLoading)) {
    return null;
  }

  return (
    <div className="col-span-full chart-container flex flex-col flex-1 min-h-0" id="project-footprint-table">
      <div className="chart-header">
        <div className="flex items-center justify-between gap-3">
          <h4>Project Footprint & Code Env Usage</h4>
          <span className="badge badge-info font-mono">
            {rows.length > 0 ? (modelFilter === 'all' ? rows.length : `${filteredRows.length}/${rows.length}`) : '...'}
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{loading?.message || 'Analyzing...'}</span>
            <span className="font-mono">
              {Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%
            </span>
          </div>
          <div
            className={`mt-2 rounded-full bg-[var(--bg-glass)] overflow-hidden ${rows.length > 0 ? 'h-2' : 'h-3'}`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--neon-cyan)] to-[var(--neon-green)] transition-all duration-300 ease-out"
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%`,
              }}
            />
          </div>
          {rows.length === 0 && loading?.phase && (
            <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {loading.phase.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}

      <div className="px-4 py-2 text-sm text-[var(--text-secondary)] border-b border-[var(--border-glass)]">
        Average project size on instance:{' '}
        <span className="font-mono text-[var(--text-primary)]">{avgProjectGb.toFixed(2)} GB</span>
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-glass)] flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--text-muted)] mr-1">Models</span>
        {MODEL_FILTERS.map((filter) => {
          const active = modelFilter === filter.key;
          const count = modelFilterCounts[filter.key] || 0;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setModelFilter(filter.key)}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                active
                  ? 'bg-[var(--neon-cyan)]/15 border-[var(--neon-cyan)] text-[var(--neon-cyan)]'
                  : 'border-[var(--border-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass)]'
              }`}
            >
              {filter.label}
              <span className="ml-1 font-mono text-[10px] opacity-75">{count}</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
          Waiting for project analysis data...
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
          No projects match the selected model filter.
        </div>
      ) : (
        <div className="card-scroll-body">
          <table className="table-dark">
            <thead>
              <tr>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)]"
                  onClick={() => handleSort('projectKey')}
                >
                  Project{indicator('projectKey')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('codeEnvCount')}
                >
                  Code Envs{indicator('codeEnvCount')}
                </th>
                {hasCodeStudios && (
                  <th
                    className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                    onClick={() => handleSort('codeStudioCount')}
                  >
                    Code Studios{indicator('codeStudioCount')}
                  </th>
                )}
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('savedModelCount')}
                >
                  Models{indicator('savedModelCount')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('bundleBytes')}
                >
                  Bundles{indicator('bundleBytes')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('managedDatasetsBytes')}
                >
                  Managed Datasets{indicator('managedDatasetsBytes')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('managedFoldersBytes')}
                >
                  Managed Folders{indicator('managedFoldersBytes')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('otherBytes')}
                >
                  Other{indicator('otherBytes')}
                </th>
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] text-right"
                  onClick={() => handleSort('totalBytes')}
                >
                  Total{indicator('totalBytes')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row: ProjectFootprintRow) => (
                <tr key={row.projectKey} className="hover:bg-[var(--bg-glass)] transition-colors">
                  <td>
                    <div className="text-[var(--text-primary)] font-medium">{row.name}</div>
                    <div className="text-xs text-[var(--text-muted)] font-mono">
                      {row.projectKey}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Owner: {row.owner || 'Unknown'}
                    </div>
                  </td>
                  <td className="text-right font-mono font-semibold">
                    <span className={codeEnvCountClass(row.codeEnvCount || 0)}>
                      {row.codeEnvCount}
                    </span>
                  </td>
                  {hasCodeStudios && (
                    <td className="text-right font-mono font-semibold">
                      <span className={codeStudioCountClass(row.codeStudioCount || 0)}>
                        {row.codeStudioCount ?? 0}
                      </span>
                    </td>
                  )}
                  <td className="text-right">
                    <div className="font-mono font-semibold text-[var(--text-primary)]">
                      {row.savedModelCount ?? 0}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] max-w-[180px] ml-auto">
                      {formatSavedModelSummary(row)}
                    </div>
                  </td>
                  <td className="text-right font-mono">
                    <span className={getRelativeSizeColor(row.bundleBytes || 0, maxBundleBytes)}>
                      {formatAuto(row.bundleBytes)}
                    </span>
                    {(row.bundleCount || 0) > 0 && (
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {row.bundleCount} bundle(s)
                      </div>
                    )}
                  </td>
                  <td className="text-right font-mono">
                    <span
                      className={getRelativeSizeColor(
                        row.managedDatasetsBytes || 0,
                        maxManagedDatasetsBytes,
                      )}
                    >
                      {formatGb(row.managedDatasetsBytes)}
                    </span>
                  </td>
                  <td className="text-right font-mono">
                    <span
                      className={getRelativeSizeColor(
                        row.managedFoldersBytes || 0,
                        maxManagedFoldersBytes,
                      )}
                    >
                      {formatGb(row.managedFoldersBytes)}
                    </span>
                  </td>
                  <td className="text-right font-mono">
                    <span
                      className={getRelativeSizeColor(
                        computeOtherBytes(row),
                        maxOtherBytes,
                      )}
                    >
                      {formatAuto(computeOtherBytes(row))}
                    </span>
                  </td>
                  <td className="text-right font-mono font-semibold">
                    <span className={healthCellClass(row.projectSizeHealth)}>
                      {formatGb(row.totalBytes)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
