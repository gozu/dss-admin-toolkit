import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useModal } from '../hooks/useModal';
import { fetchJson, getBackendUrl } from '../utils/api';

interface ManagedFolder {
  id: string;
  name: string;
}

// ── Types ──

interface ProjectRow {
  projectKey: string;
  name: string;
  owner: string;
  daysInactive: number;
}

// ── Sort helpers ──

type SortField = 'name' | 'owner' | 'daysInactive';
type SortDir = 'asc' | 'desc';

function sortRows(rows: ProjectRow[], field: SortField, dir: SortDir): ProjectRow[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (field) {
      case 'name':
        return m * a.name.localeCompare(b.name);
      case 'owner':
        return m * a.owner.localeCompare(b.owner);
      case 'daysInactive':
        return m * (a.daysInactive - b.daysInactive);
    }
  });
}

function defaultSort(rows: ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => b.daysInactive - a.daysInactive);
}

// ── Component ──

export function InactiveProjectCleaner() {
  // Fetch inactive projects from dedicated fast endpoint
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJson<{ projects: ProjectRow[] }>('/api/tools/inactive-projects');
        if (!cancelled) setRows(res.projects);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Delete confirmation modal
  const deleteModal = useModal();
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visibleRows = useMemo(
    () => rows.filter((r) => !deletedKeys.has(r.projectKey)),
    [rows, deletedKeys],
  );

  const sortedRows = useMemo(() => {
    if (!sortField) return defaultSort(visibleRows);
    return sortRows(visibleRows, sortField, sortDir);
  }, [visibleRows, sortField, sortDir]);

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
    (row: ProjectRow) => {
      setDeleteTarget(row);
      setDeleteInput('');
      setDeleteError(null);
      deleteModal.open();
    },
    [deleteModal],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const expected = `delete ${deleteTarget.projectKey}`;
    if (deleteInput !== expected) return;
    if (!folderId) return;

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await fetchJson(`/api/tools/project-cleaner/${deleteTarget.projectKey}?folderId=${encodeURIComponent(folderId)}`, {
        method: 'DELETE',
        headers: { 'X-Confirm-Name': deleteTarget.projectKey },
      });
      setDeletedKeys((prev) => new Set([...prev, deleteTarget.projectKey]));
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Inactive Project Cleaner</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">Loading inactive project data...</p>
        </section>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="space-y-4">
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Inactive Project Cleaner</h3>
          <p className="text-sm text-[var(--neon-red)] mt-1">Failed to load inactive projects: {fetchError}</p>
        </section>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <section className="glass-card p-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Inactive Project Cleaner</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            No inactive projects found. Projects with 1+ days of inactivity, no active scenarios, and no deployed bundles will appear here.
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
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Inactive Project Cleaner</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Projects inactive for 1+ days with no active scenarios or deployed bundles. A backup is uploaded to the selected managed folder before deletion.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)] whitespace-nowrap" htmlFor="pc-folder-select">
              Backup destination
            </label>
            <select
              id="pc-folder-select"
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
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--text-primary)]">{visibleRows.length}</div>
              <div className="text-xs text-[var(--text-muted)]">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono text-[var(--neon-green)]">{deletedKeys.size}</div>
              <div className="text-xs text-[var(--text-muted)]">Backed Up &amp; Deleted</div>
            </div>
          </div>
        </section>

        {/* Project table */}
        <section className="glass-card p-4">
          <div className="overflow-auto max-h-[60vh]">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    Project Name{sortIndicator('name')}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('owner')}>
                    Owner{sortIndicator('owner')}
                  </th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort('daysInactive')}>
                    Days Inactive{sortIndicator('daysInactive')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.projectKey} className="hover:bg-[var(--bg-glass)]">
                    <td>
                      <a
                        href={`${dssBaseUrl}/projects/${row.projectKey}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--neon-cyan)] hover:underline"
                      >
                        {row.name}
                      </a>
                    </td>
                    <td className="text-[var(--text-secondary)]">{row.owner}</td>
                    <td>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          row.daysInactive >= 365
                            ? 'bg-[var(--neon-red)]/20 text-[var(--neon-red)]'
                            : 'bg-amber-400/20 text-amber-400'
                        }`}
                      >
                        {row.daysInactive}d
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => openDeleteConfirm(row)}
                        disabled={!folderId}
                        title={!folderId ? 'Select a backup destination first' : undefined}
                        className="px-3 py-1 rounded-md text-xs font-medium border border-[var(--neon-red)]/30 bg-[var(--neon-red)]/10 text-[var(--neon-red)] hover:bg-[var(--neon-red)]/20 hover:border-[var(--neon-red)]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

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
              disabled={deleteLoading || deleteInput !== `delete ${deleteTarget?.projectKey || ''}`}
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
              Are you sure you want to delete project{' '}
              <span className="font-mono text-[var(--neon-red)]">{deleteTarget.projectKey}</span>?
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              A backup will be uploaded to the selected managed folder before deletion.
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Type{' '}
              <code className="px-1.5 py-0.5 rounded bg-[var(--bg-glass)] text-[var(--text-primary)]">
                delete {deleteTarget.projectKey}
              </code>{' '}
              to confirm.
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder={`delete ${deleteTarget.projectKey}`}
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
