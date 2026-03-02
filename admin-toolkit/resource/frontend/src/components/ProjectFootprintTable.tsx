import { useMemo } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { useTableSort } from '../hooks/useTableSort';
import { getRelativeSizeColor } from '../utils/formatters';
import type { ProjectFootprintHealth, ProjectFootprintRow } from '../types';

type SortKey =
  | 'projectKey'
  | 'codeEnvCount'
  | 'codeStudioCount'
  | 'bundleBytes'
  | 'managedDatasetsBytes'
  | 'managedFoldersBytes'
  | 'otherBytes'
  | 'totalBytes';

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

export function ProjectFootprintTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const rows = state.parsedData.projectFootprint || [];
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

  const sortedRows = useMemo(() => {
    const clone = [...rows];
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
  }, [rows, sortKey, sortDir]);
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
            {rows.length > 0 ? rows.length : '...'}
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

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
          Waiting for project analysis data...
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
