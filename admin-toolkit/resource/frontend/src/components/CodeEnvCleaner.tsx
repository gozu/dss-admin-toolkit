import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useModal } from '../hooks/useModal';
import { useDiag } from '../context/DiagContext';
import { fetchJson, getBackendUrl } from '../utils/api';
import type { CodeEnv, ProvisionalCodeEnv } from '../types';

interface ManagedFolder {
  id: string;
  name: string;
}

// ── Sort helpers ──

type SortField = 'name' | 'owner' | 'usages';
type SortDir = 'asc' | 'desc';

interface EnvRow {
  env?: CodeEnv;
  provisional?: ProvisionalCodeEnv;
  envKey: string;
  name: string;
  owner: string;
  usageCount: number;
  isProvisional: boolean;
}

type RealEnvRow = EnvRow & { env: CodeEnv; isProvisional: false };

function sortRows(rows: EnvRow[], field: SortField, dir: SortDir): EnvRow[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aUnused = a.usageCount === 0;
    const bUnused = b.usageCount === 0;
    if (aUnused !== bUnused) return aUnused ? -1 : 1;

    switch (field) {
      case 'name':
        return m * a.name.localeCompare(b.name);
      case 'owner':
        return m * (a.owner || '').localeCompare(b.owner || '');
      case 'usages':
        if (a.usageCount !== b.usageCount) {
          return m * (a.usageCount - b.usageCount);
        }
        return a.name.localeCompare(b.name);
    }
  });
}

function defaultSort(rows: EnvRow[]): EnvRow[] {
  return sortRows(rows, 'name', 'asc');
}

// ── Component ──

export function CodeEnvCleaner() {
  const { state } = useDiag();
  const { parsedData } = state;

  const codeEnvs = parsedData.codeEnvs || [];
  const provisionalCodeEnvs = parsedData.provisionalCodeEnvs || [];
  const totalEnvCount = parsedData.totalEnvCount;
  const skippedEnvCount = parsedData.skippedEnvCount;

  const rows = useMemo(() => {
    const realRows = codeEnvs.map((env): EnvRow => ({
      env,
      envKey: `${env.language}:${env.name}`,
      name: env.name,
      owner: env.owner || 'Unknown',
      usageCount: env.usageCount || 0,
      isProvisional: false,
    }));
    const realNames = new Set(realRows.map((row) => row.name));
    const provisionalRows = provisionalCodeEnvs
      .filter((row) => !realNames.has(row.name))
      .map((row): EnvRow => ({
        provisional: row,
        envKey: `provisional:${row.name}`,
        name: row.name,
        owner: 'Pending details',
        usageCount: row.usageCount,
        isProvisional: true,
      }));
    return [...realRows, ...provisionalRows];
  }, [codeEnvs, provisionalCodeEnvs]);

  // Managed folder state
  const [folders, setFolders] = useState<ManagedFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [folderId, setFolderId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJson<{ folders: ManagedFolder[] }>('/api/managed-folders');
        if (!cancelled) {
          setFolders(res.folders);
          if (res.folders.length > 0) setFolderId(res.folders[0].id);
        }
      } catch {
        // silently handle — dropdown will show "No managed folders"
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());


  // Delete confirmation modal (single)
  const deleteModal = useModal();
  const [deleteTarget, setDeleteTarget] = useState<RealEnvRow | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bulk delete modal
  const bulkDeleteModal = useModal();
  const [bulkDeleteInput, setBulkDeleteInput] = useState('');
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState('');

  const visibleRows = useMemo(
    () => rows.filter((r) => !deletedKeys.has(r.envKey)),
    [rows, deletedKeys],
  );

  const sortedRows = useMemo(() => {
    if (!sortField) return defaultSort(visibleRows);
    return sortRows(visibleRows, sortField, sortDir);
  }, [visibleRows, sortField, sortDir]);

  const unusedCount = useMemo(() => visibleRows.filter((r) => r.usageCount === 0).length, [visibleRows]);
  const inUseCount = useMemo(() => visibleRows.filter((r) => r.usageCount > 0).length, [visibleRows]);
  const expectedTotalCount = useMemo(() => {
    if (
      typeof parsedData.codeEnvsExpectedCount === 'number' &&
      Number.isFinite(parsedData.codeEnvsExpectedCount) &&
      parsedData.codeEnvsExpectedCount > 0
    ) {
      return parsedData.codeEnvsExpectedCount;
    }
    if (
      typeof totalEnvCount === 'number' &&
      Number.isFinite(totalEnvCount) &&
      totalEnvCount > 0
    ) {
      if (
        typeof skippedEnvCount === 'number' &&
        Number.isFinite(skippedEnvCount) &&
        skippedEnvCount >= 0
      ) {
        return Math.max(0, totalEnvCount - skippedEnvCount);
      }
      return totalEnvCount;
    }
    const scanTotal = provisionalCodeEnvs.reduce((maxSeen, row) => {
      if (typeof row.scanTotal === 'number' && Number.isFinite(row.scanTotal) && row.scanTotal > maxSeen) {
        return row.scanTotal;
      }
      return maxSeen;
    }, 0);
    return scanTotal > 0 ? scanTotal : null;
  }, [parsedData.codeEnvsExpectedCount, totalEnvCount, skippedEnvCount, provisionalCodeEnvs]);
  const totalDisplay = expectedTotalCount ? `${visibleRows.length}/${expectedTotalCount}` : `${visibleRows.length}`;

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField],
  );

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const openDeleteConfirm = useCallback(
    (row: RealEnvRow) => {
      setDeleteTarget(row);
      setDeleteInput('');
      setDeleteError(null);
      deleteModal.open();
    },
    [deleteModal],
  );

  const toggleSelect = useCallback((envKey: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(envKey)) next.delete(envKey);
      else next.add(envKey);
      return next;
    });
  }, []);

  const selectableUnusedRows = useMemo(
    () => visibleRows.filter((r): r is RealEnvRow => !r.isProvisional && r.usageCount === 0 && !!r.env),
    [visibleRows],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedKeys((prev) => {
      const allUnusedKeys = selectableUnusedRows.map((r) => r.envKey);
      const allSelected = allUnusedKeys.every((k) => prev.has(k));
      if (allSelected) return new Set();
      return new Set(allUnusedKeys);
    });
  }, [selectableUnusedRows]);

  const selectedRows = useMemo(() =>
    visibleRows.filter(
      (r): r is RealEnvRow => selectedKeys.has(r.envKey) && !r.isProvisional && !!r.env,
    ),
    [visibleRows, selectedKeys],
  );

  const openBulkDelete = useCallback(() => {
    setBulkDeleteInput('');
    setBulkDeleteError(null);
    setBulkDeleteProgress('');
    bulkDeleteModal.open();
  }, [bulkDeleteModal]);

  const confirmBulkDelete = useCallback(async () => {
    const count = selectedRows.length;
    if (count === 0) return;
    const expected = `delete ${count} envs`;
    if (bulkDeleteInput !== expected) return;
    if (!folderId) return;

    setBulkDeleteLoading(true);
    setBulkDeleteError(null);
    try {
      for (let i = 0; i < selectedRows.length; i++) {
        const row = selectedRows[i];
        setBulkDeleteProgress(`Deleting ${i + 1} of ${count}: ${row.env.name}...`);
        await fetchJson(
          `/api/tools/code-env-cleaner/${row.env.language.toUpperCase()}/${row.env.name}?folderId=${encodeURIComponent(folderId)}`,
          {
            method: 'DELETE',
            headers: { 'X-Confirm-Name': row.env.name },
          },
        );
        setDeletedKeys((prev) => new Set([...prev, row.envKey]));
      }
      setSelectedKeys(new Set());
      bulkDeleteModal.close();
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkDeleteLoading(false);
      setBulkDeleteProgress('');
    }
  }, [selectedRows, bulkDeleteInput, bulkDeleteModal, folderId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const expected = `delete ${deleteTarget.env.name}`;
    if (deleteInput !== expected) return;
    if (!folderId) return;

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await fetchJson(
        `/api/tools/code-env-cleaner/${deleteTarget.env.language.toUpperCase()}/${deleteTarget.env.name}?folderId=${encodeURIComponent(folderId)}`,
        {
          method: 'DELETE',
          headers: { 'X-Confirm-Name': deleteTarget.env.name },
        },
      );
      setDeletedKeys((prev) => new Set([...prev, deleteTarget.envKey]));
      deleteModal.close();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, deleteInput, deleteModal, folderId]);

  const dssBaseUrl = useMemo(() => {
    const bUrl = getBackendUrl('/');
    try {
      const u = new URL(bUrl, window.location.origin);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }, []);

  const analysisLoading = parsedData.analysisLoading;
  const progressPct = Math.max(0, Math.min(100, Math.round(analysisLoading?.progressPct || 0)));
  const showProgress = Boolean(analysisLoading?.active);

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Code Env Cleaner
            {skippedEnvCount != null && skippedEnvCount > 0 && totalEnvCount != null && (
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                ({codeEnvs.length} of {totalEnvCount} — {skippedEnvCount} plugin-managed excluded)
              </span>
            )}
          </h3>
          <p className="text-sm text-[var(--text-muted)]">
            Code environments with zero usages. Delete unused envs to free up resources. A
            backup is uploaded to the selected managed folder before deletion.
          </p>
          {showProgress && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>{progressPct >= 99 ? 'Finalizing results...' : (analysisLoading?.message || 'Analyzing code environments...')}</span>
                <span className="font-mono">{progressPct}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[var(--bg-glass)] overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r from-[var(--neon-cyan)] to-[var(--neon-green)] transition-all duration-300 ease-out${progressPct >= 99 ? ' animate-pulse' : ''}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {analysisLoading?.phase && (
                <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {progressPct >= 99 ? 'finalizing' : analysisLoading.phase.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          )}
          {!showProgress && visibleRows.length === 0 && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Waiting for code environment analysis rows...
            </p>
          )}
          {provisionalCodeEnvs.length > 0 && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Showing {provisionalCodeEnvs.length} provisional row{provisionalCodeEnvs.length !== 1 ? 's' : ''} from usage scan.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)] whitespace-nowrap" htmlFor="ce-folder-select">
              Backup destination
            </label>
            <select
              id="ce-folder-select"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              disabled={foldersLoading || folders.length === 0}
              className="input-glass text-sm py-1 px-2 rounded min-w-[200px]"
            >
              {foldersLoading ? (
                <option value="">Loading...</option>
              ) : folders.length === 0 ? (
                <option value="">No managed folders in project</option>
              ) : (
                folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))
              )}
            </select>
          </div>
        </section>

        {/* Stats bar */}
        <section className="glass-card p-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-primary)]">{totalDisplay}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {expectedTotalCount ? 'Loaded / Total' : 'Total'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-amber-400">{unusedCount}</div>
              <div className="text-xs text-[var(--text-muted)]">Unused</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-green)]">{inUseCount}</div>
              <div className="text-xs text-[var(--text-muted)]">In Use</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-red)]">{deletedKeys.size}</div>
              <div className="text-xs text-[var(--text-muted)]">Backed Up & Deleted</div>
            </div>
          </div>
        </section>

        {/* Bulk action bar */}
        {selectedKeys.size > 0 && (
          <section className="glass-card p-3 flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">
              {selectedKeys.size} env{selectedKeys.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedKeys(new Set())}
                className="px-3 py-1 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)] transition-colors"
              >
                Clear
              </button>
              <button
                onClick={openBulkDelete}
                disabled={!folderId}
                className="px-3 py-1 rounded-md text-xs font-medium border border-[var(--neon-red)]/30 bg-[var(--neon-red)]/10 text-[var(--neon-red)] hover:bg-[var(--neon-red)]/20 hover:border-[var(--neon-red)]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete Selected
              </button>
            </div>
          </section>
        )}

        {/* Env table */}
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[60vh]">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={selectableUnusedRows.length > 0 && selectableUnusedRows.every((r) => selectedKeys.has(r.envKey))}
                      onChange={toggleSelectAll}
                      className="accent-[var(--neon-cyan)]"
                      title="Select all unused envs"
                    />
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    Name{sortIndicator('name')}
                  </th>
                  <th>Language</th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('owner')}>
                    Owner{sortIndicator('owner')}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('usages')}>
                    Usages{sortIndicator('usages')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-[var(--text-muted)]">
                      {showProgress
                        ? 'Scanning usages. Rows will appear as usage checks and env details stream in.'
                        : 'No code environments available yet.'}
                    </td>
                  </tr>
                )}
                {sortedRows.map((row) => {
                  const isUnused = row.usageCount === 0;
                  const langLabel =
                    row.env?.language === 'python'
                      ? row.env.version
                        ? `Python ${row.env.version}`
                        : 'Python'
                      : row.env?.language === 'r'
                        ? 'R'
                        : 'Pending details';
                  return (
                    <tr key={row.envKey} className="hover:bg-[var(--bg-glass)]">
                      <td>
                        {!row.isProvisional && isUnused ? (
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(row.envKey)}
                            onChange={() => toggleSelect(row.envKey)}
                            className="accent-[var(--neon-cyan)]"
                          />
                        ) : null}
                      </td>
                      <td>
                        {row.env ? (
                          <a
                            href={`${dssBaseUrl}/admin/code-envs/design/${row.env.language}/${row.env.name}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--neon-cyan)] hover:underline"
                          >
                            {row.name}
                          </a>
                        ) : (
                          <span className="text-[var(--text-primary)]">
                            {row.name}
                            <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-[var(--neon-cyan)]/20 text-[var(--neon-cyan)]">
                              provisional
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="text-[var(--text-secondary)]">{langLabel}</td>
                      <td className="text-[var(--text-secondary)]">{row.owner}</td>
                      <td>
                        {row.isProvisional ? (
                          row.provisional?.isSkipped ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--bg-glass)] text-[var(--text-muted)]">
                              {row.provisional?.statusLabel || 'Skipped'}
                            </span>
                          ) : row.usageCount === 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-400/20 text-amber-400">
                              Unused
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--neon-green)]/20 text-[var(--neon-green)]">
                              {row.provisional?.statusLabel || `${row.usageCount} usage${row.usageCount !== 1 ? 's' : ''}`}
                            </span>
                          )
                        ) : isUnused ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-400/20 text-amber-400">
                            Unused
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--neon-green)]/20 text-[var(--neon-green)]">
                            {row.usageCount} usage{row.usageCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                      <td>
                        {!row.isProvisional && isUnused && row.env && (
                          <button
                            onClick={() => openDeleteConfirm(row as RealEnvRow)}
                            disabled={!folderId}
                            title={!folderId ? 'Select a backup destination first' : undefined}
                            className="px-3 py-1 rounded-md text-xs font-medium border border-[var(--neon-red)]/30 bg-[var(--neon-red)]/10 text-[var(--neon-red)] hover:bg-[var(--neon-red)]/20 hover:border-[var(--neon-red)]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        isOpen={bulkDeleteModal.isOpen}
        onClose={bulkDeleteModal.close}
        title="Confirm Bulk Deletion"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={bulkDeleteModal.close}
              className="px-3 py-1.5 rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={confirmBulkDelete}
              disabled={bulkDeleteLoading || bulkDeleteInput !== `delete ${selectedRows.length} envs`}
              className="px-4 py-1.5 rounded bg-[var(--neon-red)]/20 text-[var(--neon-red)] hover:bg-[var(--neon-red)]/30 disabled:opacity-50 transition-colors"
            >
              {bulkDeleteLoading ? 'Deleting...' : `Delete ${selectedRows.length} Envs`}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            Are you sure you want to delete {selectedRows.length} code environment{selectedRows.length !== 1 ? 's' : ''}?
          </p>
          <div className="max-h-32 overflow-y-auto rounded bg-[var(--bg-glass)] p-2">
            {selectedRows.map((r) => (
              <div key={r.envKey} className="text-xs font-mono text-[var(--neon-red)] py-0.5">{r.env.name}</div>
            ))}
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            A backup will be uploaded to the selected managed folder before each deletion.
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Type{' '}
            <code className="px-1.5 py-0.5 rounded bg-[var(--bg-glass)] text-[var(--text-primary)]">
              delete {selectedRows.length} envs
            </code>{' '}
            to confirm.
          </p>
          <input
            type="text"
            value={bulkDeleteInput}
            onChange={(e) => setBulkDeleteInput(e.target.value)}
            placeholder={`delete ${selectedRows.length} envs`}
            className="w-full input-glass font-mono text-sm"
            autoFocus
          />
          {bulkDeleteProgress && (
            <div className="text-sm text-[var(--text-secondary)]">{bulkDeleteProgress}</div>
          )}
          {bulkDeleteError && (
            <div className="text-sm text-[var(--neon-red)]">{bulkDeleteError}</div>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.close}
        title="Confirm Deletion"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={deleteModal.close}
              className="px-3 py-1.5 rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleteLoading || deleteInput !== `delete ${deleteTarget?.env.name || ''}`}
              className="px-4 py-1.5 rounded bg-[var(--neon-red)]/20 text-[var(--neon-red)] hover:bg-[var(--neon-red)]/30 disabled:opacity-50 transition-colors"
            >
              {deleteLoading ? 'Backing up & deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-[var(--text-secondary)]">
              Are you sure you want to delete code environment{' '}
              <span className="font-mono text-[var(--neon-red)]">{deleteTarget.env.name}</span>?
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              A backup will be uploaded to the selected managed folder before deletion.
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Type{' '}
              <code className="px-1.5 py-0.5 rounded bg-[var(--bg-glass)] text-[var(--text-primary)]">
                delete {deleteTarget.env.name}
              </code>{' '}
              to confirm.
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder={`delete ${deleteTarget.env.name}`}
              className="w-full input-glass font-mono text-sm"
              autoFocus
            />
            {deleteError && (
              <div className="text-sm text-[var(--neon-red)]">{deleteError}</div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
