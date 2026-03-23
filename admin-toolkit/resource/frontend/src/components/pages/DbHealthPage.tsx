import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../utils/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PgConnection {
  name: string;
  type: string;
  host: string;
  port: number;
  db: string;
}

interface DbOverview {
  dbSize: string;
  dbSizeBytes: number;
  version: string;
  tableCount: number;
  totalDeadTuples: number;
  totalLiveTuples: number;
  canWrite: boolean;
  queryMethod: string;
  warnings?: string[];
}

interface TableInfo {
  name: string;
  totalSize: string;
  totalSizeBytes: number;
  rowCount: number;
  deadTuples: number;
  bloatRatio: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
}

interface ProjectBreakdown {
  projectKey: string;
  sizeBytes: number;
  tableCount: number;
  rowCount: number;
}

interface SystemBucket {
  tables: { name: string; rowCount: number; sizeBytes: number }[];
  totalBytes: number;
}

interface PerProjectResponse {
  projects: ProjectBreakdown[];
  system: SystemBucket;
  isRuntimeDb: boolean;
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function bloatColor(ratio: number): string {
  if (ratio >= 0.5) return 'var(--neon-red, #ef4444)';
  if (ratio >= 0.2) return 'var(--neon-yellow, #eab308)';
  return 'var(--neon-green, #22c55e)';
}

function vacuumAgeColor(iso: string | null): string {
  if (!iso) return 'var(--neon-red, #ef4444)';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'var(--neon-red, #ef4444)';
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days > 7) return 'var(--neon-yellow, #eab308)';
  return 'var(--text-secondary)';
}

type SortKey = 'name' | 'totalSizeBytes' | 'rowCount' | 'deadTuples' | 'bloatRatio' | 'lastVacuum' | 'lastAutovacuum' | 'lastAnalyze';
type SortDir = 'asc' | 'desc';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DbHealthPage() {
  // Connection state
  const [connections, setConnections] = useState<PgConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<string>('');
  const [connLoading, setConnLoading] = useState(true);
  const [connError, setConnError] = useState<string | null>(null);

  // Data state
  const [overview, setOverview] = useState<DbOverview | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [perProject, setPerProject] = useState<PerProjectResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Action state
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('totalSizeBytes');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Load connections on mount
  useEffect(() => {
    setConnLoading(true);
    fetchJson<{ connections: PgConnection[] }>('/api/tools/db-health/connections')
      .then((data) => {
        setConnections(data.connections || []);
        if (data.connections?.length) {
          setSelectedConn(data.connections[0].name);
        }
        setConnError(null);
      })
      .catch((err) => setConnError(String(err)))
      .finally(() => setConnLoading(false));
  }, []);

  // Load data when connection changes
  useEffect(() => {
    if (!selectedConn) return;
    setDataLoading(true);
    setDataError(null);
    setWarnings([]);
    const q = encodeURIComponent(selectedConn);
    Promise.all([
      fetchJson<DbOverview>(`/api/tools/db-health/overview?connection=${q}`),
      fetchJson<{ tables: TableInfo[]; warnings?: string[] }>(`/api/tools/db-health/tables?connection=${q}`),
      fetchJson<PerProjectResponse>(`/api/tools/db-health/per-project?connection=${q}`),
    ])
      .then(([ov, tb, pp]) => {
        setOverview(ov);
        setTables(tb.tables || []);
        setPerProject(pp);
        const w = [...(ov.warnings || []), ...(tb.warnings || []), ...(pp.warnings || [])];
        setWarnings(w);
      })
      .catch((err) => setDataError(String(err)))
      .finally(() => setDataLoading(false));
  }, [selectedConn]);

  // Sort tables
  const sortedTables = useMemo(() => {
    const sorted = [...tables].sort((a, b) => {
      let av: string | number = a[sortKey] ?? '';
      let bv: string | number = b[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [tables, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  // Actions
  const handleAction = useCallback(async (action: 'vacuum' | 'analyze', tableName: string, password?: string) => {
    if (!selectedConn) return;
    if (!password) {
      const confirmed = window.confirm(
        `Run ${action.toUpperCase()} on table "${tableName}"?\n\nThis may take a moment on large tables.`,
      );
      if (!confirmed) return;
    }

    const key = `${action}-${tableName}`;
    setActionLoading((prev) => ({ ...prev, [key]: action }));
    try {
      const payload: Record<string, string> = { connection: selectedConn, table: tableName };
      if (password) payload.password = password;
      const res = await fetchJson<{ success?: boolean; error?: string; needsPassword?: boolean; reason?: string }>(
        `/api/tools/db-health/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (res.needsPassword) {
        // psycopg2 unavailable — ask user for the DB password to use psql
        const pw = window.prompt(
          `${res.reason || 'psycopg2 not available'}\n\nEnter the unencrypted PostgreSQL password:`,
        );
        if (pw) {
          setActionLoading((prev) => { const next = { ...prev }; delete next[key]; return next; });
          return handleAction(action, tableName, pw);
        }
        alert(`${action.toUpperCase()} cancelled — password required.`);
      } else if (res.error) {
        alert(`${action.toUpperCase()} failed: ${res.error}`);
      } else {
        // Refresh table data
        const q = encodeURIComponent(selectedConn);
        const tb = await fetchJson<{ tables: TableInfo[] }>(`/api/tools/db-health/tables?connection=${q}`);
        setTables(tb.tables || []);
      }
    } catch (err) {
      alert(`${action.toUpperCase()} failed: ${String(err)}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [selectedConn]);

  // Per-project bar widths
  const maxProjectSize = useMemo(() => {
    if (!perProject) return 1;
    const allSizes = [
      ...perProject.projects.map((p) => p.sizeBytes),
      perProject.system?.totalBytes ?? 0,
    ];
    return Math.max(...allSizes, 1);
  }, [perProject]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <span className="opacity-30 ml-1">{'\u21C5'}</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };

  const colTips: Record<string, string> = {
    name: 'PostgreSQL table name',
    totalSizeBytes: 'Total disk space including indexes and TOAST data',
    rowCount: 'Estimated number of live rows (from pg_stat_user_tables)',
    deadTuples: 'Rows marked for deletion but not yet reclaimed by VACUUM',
    bloatRatio: 'Dead tuples as a percentage of total tuples — high values indicate VACUUM is needed',
    lastVacuum: 'Last time a manual VACUUM was run on this table',
    lastAutovacuum: 'Last time PostgreSQL autovacuum processed this table',
    lastAnalyze: 'Last time table statistics were updated (ANALYZE)',
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">
      {/* Connection Selector */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium text-[var(--text-secondary)]">PostgreSQL Connection</label>
          {overview && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-glass)] border border-[var(--border-default)] text-[var(--text-secondary)]" title="Query method used to connect to the database">
              via {overview.queryMethod}
              {overview.canWrite ? ' (read/write)' : ' (read-only)'}
            </span>
          )}
          {connLoading ? (
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          ) : connError ? (
            <span className="text-sm text-[var(--neon-red)]">Failed to load connections: {connError}</span>
          ) : connections.length === 0 ? (
            <span className="text-sm text-[var(--text-secondary)]">No PostgreSQL connections found</span>
          ) : (
            <select
              value={selectedConn}
              onChange={(e) => setSelectedConn(e.target.value)}
              className="bg-[var(--bg-glass)] border border-[var(--border-default)] rounded px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {connections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.host || 'localhost'}:{c.port || 5432}/{c.db})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Warnings Banner */}
      {warnings.length > 0 && (
        <div className="glass-card p-3 border border-[var(--neon-yellow)] text-sm text-[var(--neon-yellow)]">
          <strong>Warnings:</strong>
          <ul className="list-disc ml-5 mt-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Loading / Error states */}
      {dataLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-[var(--text-secondary)] text-sm">Querying database...</span>
        </div>
      )}

      {dataError && !dataLoading && (
        <div className="glass-card p-6 border border-[var(--neon-red)] text-center">
          <p className="text-[var(--neon-red)] text-sm">{dataError}</p>
        </div>
      )}

      {/* Summary Cards */}
      {overview && !dataLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Database Size</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{overview.dbSize}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Tables</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{overview.tableCount}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">PG Version</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{overview.version}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Dead Tuples</div>
            <div className="text-2xl font-bold" style={{ color: overview.totalDeadTuples > 10000 ? 'var(--neon-red)' : 'var(--text-primary)' }}>
              {overview.totalDeadTuples.toLocaleString()}
            </div>
            {overview.totalLiveTuples > 0 && (
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                {((overview.totalDeadTuples / (overview.totalLiveTuples + overview.totalDeadTuples)) * 100).toFixed(1)}% bloat
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tables Table */}
      {tables.length > 0 && !dataLoading && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Table Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                  <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => handleSort('name')} title={colTips.name}>
                    Table {sortIcon('name')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none text-right" onClick={() => handleSort('totalSizeBytes')} title={colTips.totalSizeBytes}>
                    Size {sortIcon('totalSizeBytes')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none text-right" onClick={() => handleSort('rowCount')} title={colTips.rowCount}>
                    Rows {sortIcon('rowCount')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none text-right" onClick={() => handleSort('deadTuples')} title={colTips.deadTuples}>
                    Dead Tuples {sortIcon('deadTuples')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none text-right" onClick={() => handleSort('bloatRatio')} title={colTips.bloatRatio}>
                    Bloat % {sortIcon('bloatRatio')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => handleSort('lastVacuum')} title={colTips.lastVacuum}>
                    Vacuum {sortIcon('lastVacuum')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => handleSort('lastAutovacuum')} title={colTips.lastAutovacuum}>
                    Autovacuum {sortIcon('lastAutovacuum')}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer select-none" onClick={() => handleSort('lastAnalyze')} title={colTips.lastAnalyze}>
                    Analyze {sortIcon('lastAnalyze')}
                  </th>
                  <th className="pb-2" title="Run VACUUM or ANALYZE on this table">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTables.map((t) => (
                  <tr key={t.name} className="border-b border-[var(--border-default)]/30 hover:bg-[var(--bg-glass-hover)]">
                    <td className="py-1.5 pr-4 font-mono text-xs text-[var(--text-primary)]">{t.name}</td>
                    <td className="py-1.5 pr-4 text-right text-[var(--text-secondary)]">{t.totalSize}</td>
                    <td className="py-1.5 pr-4 text-right text-[var(--text-secondary)]">{t.rowCount.toLocaleString()}</td>
                    <td className="py-1.5 pr-4 text-right" style={{ color: t.deadTuples > 1000 ? 'var(--neon-yellow)' : 'var(--text-secondary)' }}>
                      {t.deadTuples.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono" style={{ color: bloatColor(t.bloatRatio) }}>
                      {(t.bloatRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-1.5 pr-4 text-xs" style={{ color: vacuumAgeColor(t.lastVacuum) }}>
                      {relativeTime(t.lastVacuum)}
                    </td>
                    <td className="py-1.5 pr-4 text-xs" style={{ color: vacuumAgeColor(t.lastAutovacuum) }}>
                      {relativeTime(t.lastAutovacuum)}
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-[var(--text-secondary)]">
                      {relativeTime(t.lastAnalyze)}
                    </td>
                    <td className="py-1.5">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleAction('vacuum', t.name)}
                          disabled={!overview?.canWrite || !!actionLoading[`vacuum-${t.name}`]}
                          title={!overview?.canWrite ? 'No write access on this connection' : overview?.queryMethod === 'SQLExecutor2' ? 'VACUUM may fail via SQLExecutor2 (needs psycopg2 for autocommit)' : `Run VACUUM on ${t.name}`}
                          className="px-2 py-0.5 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`vacuum-${t.name}`] ? '...' : 'VACUUM'}
                        </button>
                        <button
                          onClick={() => handleAction('analyze', t.name)}
                          disabled={!overview?.canWrite || !!actionLoading[`analyze-${t.name}`]}
                          title={overview?.canWrite ? `Run ANALYZE on ${t.name}` : 'No write access on this connection'}
                          className="px-2 py-0.5 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`analyze-${t.name}`] ? '...' : 'ANALYZE'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Project Breakdown */}
      {perProject && !dataLoading && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Per-Project Space Usage</h3>
          {!perProject.isRuntimeDb ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Per-project breakdown is only available for RuntimeDB connections.
              All tables are shown in the table breakdown above.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {/* System bucket first */}
              {perProject.system && (
                <ProjectBar
                  label="System / Shared"
                  size={formatBytes(perProject.system.totalBytes)}
                  sizeBytes={perProject.system.totalBytes}
                  tableCount={perProject.system.tables.length}
                  rowCount={perProject.system.tables.reduce((s, t) => s + t.rowCount, 0)}
                  maxBytes={maxProjectSize}
                  isSystem
                />
              )}
              {/* Projects sorted by size */}
              {[...perProject.projects]
                .sort((a, b) => b.sizeBytes - a.sizeBytes)
                .map((p) => (
                  <ProjectBar
                    key={p.projectKey}
                    label={p.projectKey}
                    size={formatBytes(p.sizeBytes)}
                    sizeBytes={p.sizeBytes}
                    tableCount={p.tableCount}
                    rowCount={p.rowCount}
                    maxBytes={maxProjectSize}
                  />
                ))}
              {perProject.projects.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)]">
                  No project-attributed data found. All tables are in the System / Shared bucket.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProjectBar({
  label,
  size,
  sizeBytes,
  tableCount,
  rowCount,
  maxBytes,
  isSystem,
}: {
  label: string;
  size: string;
  sizeBytes: number;
  tableCount: number;
  rowCount: number;
  maxBytes: number;
  isSystem?: boolean;
}) {
  const pct = Math.max((sizeBytes / maxBytes) * 100, 2);
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 text-xs font-mono text-[var(--text-primary)] truncate" title={label}>
        {label}
      </div>
      <div className="flex-1 h-5 bg-[var(--bg-glass)] rounded overflow-hidden">
        <div
          className="h-full rounded transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: isSystem ? 'var(--text-secondary)' : 'var(--accent)',
            opacity: isSystem ? 0.5 : 0.8,
          }}
        />
      </div>
      <div className="w-48 shrink-0 text-xs text-[var(--text-secondary)] text-right">
        {size} &middot; {tableCount} tables &middot; {rowCount.toLocaleString()} rows
      </div>
    </div>
  );
}
