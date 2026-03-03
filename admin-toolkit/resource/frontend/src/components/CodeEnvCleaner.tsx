import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useModal } from '../hooks/useModal';
import { useDiag } from '../context/DiagContext';
import { fetchJson, getBackendUrl } from '../utils/api';
import type { CodeEnv } from '../types';

interface ManagedFolder {
  id: string;
  name: string;
}

// ── Sort helpers ──

type SortField = 'name' | 'owner' | 'usages';
type SortDir = 'asc' | 'desc';

interface EnvRow {
  env: CodeEnv;
  envKey: string;
  projectCount: number;
  projectKeys: string[];
}

function sortRows(rows: EnvRow[], field: SortField, dir: SortDir): EnvRow[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (field) {
      case 'name':
        return m * a.env.name.localeCompare(b.env.name);
      case 'owner':
        return m * (a.env.owner || '').localeCompare(b.env.owner || '');
      case 'usages':
        return m * (a.projectCount - b.projectCount);
    }
  });
}

function defaultSort(rows: EnvRow[]): EnvRow[] {
  return [...rows].sort((a, b) => {
    if (a.projectCount === 0 && b.projectCount !== 0) return -1;
    if (a.projectCount !== 0 && b.projectCount === 0) return 1;
    return a.env.name.localeCompare(b.env.name);
  });
}

// ── Component ──

export function CodeEnvCleaner() {
  const { state } = useDiag();
  const { parsedData } = state;

  const codeEnvs = parsedData.codeEnvs || [];
  const projectRows = parsedData.projectFootprint || [];

  // Compute which envs are used by cross-referencing project footprint codeEnvKeys
  const rows = useMemo(() => {
    const envProjectMap = new Map<string, Set<string>>();
    for (const row of projectRows) {
      const rowAny = row as unknown as { codeEnvKeys?: string[] };
      const projectKey = String(row.projectKey || '');
      for (const ek of rowAny.codeEnvKeys || []) {
        if (!ek) continue;
        if (!envProjectMap.has(String(ek))) envProjectMap.set(String(ek), new Set());
        envProjectMap.get(String(ek))!.add(projectKey);
      }
    }

    return codeEnvs.map((env): EnvRow => {
      const envKey = `${env.language}:${env.name}`;
      const projects = envProjectMap.get(envKey);
      return {
        env,
        envKey,
        projectCount: projects?.size || 0,
        projectKeys: projects ? Array.from(projects).sort() : [],
      };
    });
  }, [codeEnvs, projectRows]);

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

  // Usage detail modal
  const usageModal = useModal();
  const [usageRow, setUsageRow] = useState<EnvRow | null>(null);

  // Delete confirmation modal
  const deleteModal = useModal();
  const [deleteTarget, setDeleteTarget] = useState<EnvRow | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visibleRows = useMemo(
    () => rows.filter((r) => !deletedKeys.has(r.envKey)),
    [rows, deletedKeys],
  );

  const sortedRows = useMemo(() => {
    if (!sortField) return defaultSort(visibleRows);
    return sortRows(visibleRows, sortField, sortDir);
  }, [visibleRows, sortField, sortDir]);

  const unusedCount = useMemo(() => visibleRows.filter((r) => r.projectCount === 0).length, [visibleRows]);
  const inUseCount = useMemo(() => visibleRows.filter((r) => r.projectCount > 0).length, [visibleRows]);

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

  const openUsageDetail = useCallback(
    (row: EnvRow) => {
      setUsageRow(row);
      usageModal.open();
    },
    [usageModal],
  );

  const openDeleteConfirm = useCallback(
    (row: EnvRow) => {
      setDeleteTarget(row);
      setDeleteInput('');
      setDeleteError(null);
      deleteModal.open();
    },
    [deleteModal],
  );

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

  if (codeEnvs.length === 0) {
    return (
      <div className="space-y-4">
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Code Env Cleaner</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            No code environment data available. Load a diagnostic or wait for the analysis to complete.
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Code Env Cleaner</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Code environments with zero project references. Delete unused envs to free up resources. A
            backup is uploaded to the selected managed folder before deletion.
          </p>
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
              <div className="text-2xl font-mono text-[var(--text-primary)]">{visibleRows.length}</div>
              <div className="text-xs text-[var(--text-muted)]">Total</div>
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

        {/* Env table */}
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[60vh]">
            <table className="table-dark w-full">
              <thead>
                <tr>
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
                {sortedRows.map((row) => {
                  const isUnused = row.projectCount === 0;
                  const langLabel =
                    row.env.language === 'python'
                      ? row.env.version
                        ? `Python ${row.env.version}`
                        : 'Python'
                      : 'R';
                  return (
                    <tr key={row.envKey} className="hover:bg-[var(--bg-glass)]">
                      <td>
                        <a
                          href={`${dssBaseUrl}/admin/code-envs/design/${row.env.language}/${row.env.name}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--neon-cyan)] hover:underline"
                        >
                          {row.env.name}
                        </a>
                      </td>
                      <td className="text-[var(--text-secondary)]">{langLabel}</td>
                      <td className="text-[var(--text-secondary)]">{row.env.owner || 'Unknown'}</td>
                      <td>
                        {isUnused ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-400/20 text-amber-400">
                            Unused
                          </span>
                        ) : (
                          <button
                            onClick={() => openUsageDetail(row)}
                            className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[var(--neon-green)]/20 text-[var(--neon-green)] hover:bg-[var(--neon-green)]/30 transition-colors cursor-pointer"
                          >
                            {row.projectCount} project{row.projectCount !== 1 ? 's' : ''}
                          </button>
                        )}
                      </td>
                      <td>
                        {isUnused && (
                          <button
                            onClick={() => openDeleteConfirm(row)}
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

      {/* Usage Detail Modal — shows which projects reference this env */}
      <Modal
        isOpen={usageModal.isOpen}
        onClose={usageModal.close}
        title={`Projects using: ${usageRow?.env.name || ''}`}
      >
        {usageRow && (
          <div className="overflow-auto">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {usageRow.projectKeys.map((pk) => (
                  <tr key={pk} className="hover:bg-[var(--bg-glass)]">
                    <td className="font-mono text-xs">{pk}</td>
                    <td>
                      {dssBaseUrl && (
                        <a
                          href={`${dssBaseUrl}/projects/${pk}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--neon-cyan)] hover:underline text-xs"
                        >
                          Open
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
