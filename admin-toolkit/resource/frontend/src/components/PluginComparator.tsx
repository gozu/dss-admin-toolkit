import { useState, useRef, useCallback } from 'react';
import { fetchJson } from '../utils/api';
import type { PluginCompareRow } from '../types';

type RowStatus = 'match' | 'minor' | 'major' | 'missing' | 'remote-only';

interface DeployResult {
  pluginId: string;
  label: string;
  ok: boolean;
  error?: string;
}

interface DeployProgress {
  completed: number;
  total: number;
  results: DeployResult[];
}

function compareVersions(local: string | null, remote: string | null): RowStatus {
  if (!remote) return 'missing';
  if (!local) return 'remote-only';
  if (local === remote) return 'match';
  const [lMajor, lMinor] = local.split('.').map(Number);
  const [rMajor, rMinor] = remote.split('.').map(Number);
  if (isNaN(lMajor) || isNaN(rMajor)) return local === remote ? 'match' : 'major';
  if (lMajor !== rMajor) return 'major';
  if (lMinor !== rMinor) return 'minor';
  return 'minor';
}

const STATUS_COLORS: Record<RowStatus, string> = {
  match: 'bg-emerald-500/10 text-emerald-400',
  minor: 'bg-yellow-500/10 text-yellow-400',
  major: 'bg-red-500/10 text-red-400',
  missing: 'bg-red-500/10 text-red-400',
  'remote-only': 'bg-orange-500/10 text-orange-400',
};

const STATUS_LABELS: Record<RowStatus, string> = {
  match: 'Match',
  minor: 'Minor drift',
  major: 'Major drift',
  missing: 'Missing',
  'remote-only': 'Remote only',
};

export function PluginComparator() {
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [rows, setRows] = useState<PluginCompareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowStatus | 'all'>('all');
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState<DeployProgress | null>(null);
  const [concurrency, setConcurrency] = useState(1);
  const [deployingIds, setDeployingIds] = useState<Set<string>>(new Set());
  const abortRef = useRef(false);

  const compare = useCallback(async () => {
    if (!url.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      const data = await fetchJson<{ rows: PluginCompareRow[] }>(
        '/api/tools/plugins/compare',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), apiKey: apiKey.trim() }),
        },
      );
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url, apiKey]);

  const enrichedRows = rows.map((row) => ({
    ...row,
    status: compareVersions(row.localVersion, row.remoteVersion),
  }));

  const filteredRows =
    filter === 'all' ? enrichedRows : enrichedRows.filter((r) => r.status === filter);

  const counts = enrichedRows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<RowStatus, number>,
  );

  const missingOnRemote = enrichedRows.filter((r) => r.status === 'missing');

  /** Deploy a single plugin — used by both per-row buttons and batch deploy */
  const deploySinglePlugin = useCallback(
    async (pluginId: string): Promise<DeployResult> => {
      const row = rows.find((r) => r.id === pluginId);
      const label = row?.label || pluginId;
      try {
        await fetchJson('/api/tools/plugins/deploy-one', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), apiKey: apiKey.trim(), pluginId }),
        });
        return { pluginId, label, ok: true };
      } catch (err) {
        return { pluginId, label, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [url, apiKey, rows],
  );

  /** Deploy a single plugin from a per-row button */
  const deployOneRow = useCallback(
    async (pluginId: string) => {
      setDeployingIds((prev) => new Set(prev).add(pluginId));
      const result = await deploySinglePlugin(pluginId);
      setDeployingIds((prev) => {
        const next = new Set(prev);
        next.delete(pluginId);
        return next;
      });
      // Show result briefly, then re-compare to refresh
      if (result.ok) {
        await compare();
      } else {
        setError(`Failed to deploy ${result.label}: ${result.error}`);
      }
    },
    [deploySinglePlugin, compare],
  );

  /** Batch deploy all missing plugins with concurrency control */
  const deployMissing = async () => {
    if (missingOnRemote.length === 0) return;
    abortRef.current = false;
    setDeploying(true);
    const progress: DeployProgress = { completed: 0, total: missingOnRemote.length, results: [] };
    setDeployProgress({ ...progress });

    const queue = [...missingOnRemote];
    let idx = 0;

    const worker = async () => {
      while (idx < queue.length) {
        if (abortRef.current) return;
        const row = queue[idx++];
        setDeployingIds((prev) => new Set(prev).add(row.id));
        const result = await deploySinglePlugin(row.id);
        setDeployingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        progress.completed++;
        progress.results.push(result);
        setDeployProgress({ ...progress, results: [...progress.results] });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);

    setDeploying(false);
    if (!abortRef.current) await compare();
  };

  return (
    <div className="space-y-4">
      {/* Input form */}
      <section className="glass-card p-4 space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Plugin Comparator</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Compare plugins installed on this Design node against a remote Automation node.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label className="text-sm text-[var(--text-secondary)]">
            Remote URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://auto-node.example.com"
              className="mt-1 w-full input-glass"
            />
          </label>
          <label className="text-sm text-[var(--text-secondary)]">
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key for remote node"
              className="mt-1 w-full input-glass"
            />
          </label>
          <button
            onClick={compare}
            disabled={loading || !url.trim() || !apiKey.trim()}
            className="px-4 py-2 rounded btn-primary disabled:opacity-50 h-[38px]"
          >
            {loading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
      </section>

      {error && (
        <section className="glass-card p-3 border border-[var(--status-critical-border)] text-[var(--neon-red)] text-sm">
          {error}
        </section>
      )}

      {/* Results */}
      {enrichedRows.length > 0 && (
        <section className="glass-card p-4 space-y-3">
          {/* Filter pills + deploy/abort button */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                  : 'bg-[var(--bg-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)]'
              }`}
            >
              All ({enrichedRows.length})
            </button>
            {(['match', 'minor', 'major', 'missing', 'remote-only'] as RowStatus[]).map((s) =>
              (counts[s] || 0) > 0 ? (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    filter === s
                      ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                      : 'bg-[var(--bg-glass)] text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)]'
                  }`}
                >
                  {STATUS_LABELS[s]} ({counts[s]})
                </button>
              ) : null,
            )}

            {/* Concurrency slider + Deploy/Abort button */}
            {missingOnRemote.length > 0 && (
              <div className="ml-auto flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                  <span className="whitespace-nowrap">Parallel:</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    disabled={deploying}
                    className="w-16 h-1 accent-[var(--accent)]"
                  />
                  <span className="font-mono w-3 text-center">{concurrency}</span>
                </label>
                {deploying ? (
                  <button
                    onClick={() => { abortRef.current = true; }}
                    className="px-3 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    Abort
                  </button>
                ) : (
                  <button
                    onClick={deployMissing}
                    disabled={loading}
                    className="px-3 py-1 rounded text-xs font-medium btn-primary disabled:opacity-50"
                  >
                    Deploy Missing ({missingOnRemote.length})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Deploy progress */}
          {deployProgress && (
            <div className="space-y-2">
              {deploying && (
                <div className="space-y-1.5">
                  <div className="text-sm text-[var(--text-secondary)]">
                    Deploying... ({deployProgress.completed}/{deployProgress.total})
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-glass)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--neon-cyan)] to-[var(--accent)] transition-all duration-300"
                      style={{ width: `${(deployProgress.completed / deployProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              {!deploying && deployProgress.results.length > 0 && (() => {
                const okCount = deployProgress.results.filter((r) => r.ok).length;
                const failCount = deployProgress.results.length - okCount;
                return (
                  <div className="space-y-1.5">
                    <div className={`text-sm font-medium ${failCount > 0 ? 'text-[var(--neon-red)]' : 'text-emerald-400'}`}>
                      Deployed {okCount}/{deployProgress.results.length} plugins successfully
                      {failCount > 0 && ` (${failCount} failed)`}
                    </div>
                    {deployProgress.results.filter((r) => !r.ok).map((r) => (
                      <div key={r.pluginId} className="text-xs text-[var(--neon-red)]">
                        {r.label}: {r.error}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Table */}
          <div className="overflow-auto max-h-[60vh] border border-[var(--border-glass)] rounded-lg">
            <table className="table-dark w-full">
              <thead className="sticky top-0 bg-[var(--bg-surface)] z-10">
                <tr>
                  <th className="text-left">Plugin Name</th>
                  <th className="text-left">Design Node</th>
                  <th className="text-left">Automation Node</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isRowDeploying = deployingIds.has(row.id);
                  return (
                    <tr key={row.id} className="hover:bg-[var(--bg-glass)]">
                      <td className="text-[var(--text-primary)]">
                        {row.label || row.id}
                        {row.isDev && (
                          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded bg-[var(--accent-muted)] text-[var(--accent)]">
                            DEV
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-sm text-[var(--text-secondary)]">
                        {row.localVersion || '\u2014'}
                      </td>
                      <td className="font-mono text-sm text-[var(--text-secondary)]">
                        {row.remoteVersion || '\u2014'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status]}`}
                          >
                            {STATUS_LABELS[row.status]}
                          </span>
                          {row.status === 'missing' && (
                            <button
                              onClick={() => deployOneRow(row.id)}
                              disabled={isRowDeploying || deploying}
                              title={`Deploy ${row.label || row.id} to remote`}
                              className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {isRowDeploying ? (
                                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 5v14m-7-7l7 7 7-7" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
