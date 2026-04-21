import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTableFilter } from '../hooks/useTableFilter';
import { useTableSort } from '../hooks/useTableSort';
import { useMaximize } from '../hooks/useMaximize';
import { useProjectRows } from '../hooks/useProjectRows';
import { getRelativeSizeColor } from '../utils/formatters';
import {
  formatGb,
  formatAuto,
  healthCellClass,
  codeEnvCountClass,
  codeStudioCountClass,
} from '../utils/projectFootprintFormat';
import { MaximizeButton, MaximizePortal } from './MaximizePortal';
import type { Project, ProjectRow } from '../types';

interface ProjectsTableProps {
  onViewPermissions: (project: Project) => void;
  onViewAgentic?: (project: Project) => void;
}

type SortKey =
  | 'projectKey'
  | 'versions'
  | 'perms'
  | 'agentsTools'
  | 'llm'
  | 'codeEnvCount'
  | 'codeStudioCount'
  | 'bundleBytes'
  | 'managedDatasetsBytes'
  | 'managedFoldersBytes'
  | 'totalBytes';

function toProject(row: ProjectRow): Project {
  return {
    key: row.key,
    name: row.name,
    owner: row.owner,
    permissions: row.permissions,
    versionNumber: row.versionNumber,
    agenticFeatures: row.agenticFeatures,
  };
}

export function ProjectsTable({ onViewPermissions, onViewAgentic }: ProjectsTableProps) {
  const { isVisible } = useTableFilter();
  const { rows, footprintReady, avgProjectGB } = useProjectRows();

  const [searchText, setSearchText] = useState('');
  const [agenticOnly, setAgenticOnly] = useState(false);

  const { handleSort, sortKey, sortDir, sortIndicator: indicator } = useTableSort<SortKey>({
    defaultKey: 'versions',
    ascDefaultKeys: ['projectKey'],
  });

  const agenticCount = useMemo(
    () => rows.filter((r) => r.agenticFeatures).length,
    [rows],
  );

  const hasCodeStudios = useMemo(
    () => rows.some((r) => (r.footprint?.codeStudioCount ?? 0) > 0),
    [rows],
  );

  const maxBundleBytes = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.footprint?.bundleBytes || 0), 0),
    [rows],
  );
  const maxManagedDatasetsBytes = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.footprint?.managedDatasetsBytes || 0), 0),
    [rows],
  );
  const maxManagedFoldersBytes = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.footprint?.managedFoldersBytes || 0), 0),
    [rows],
  );

  const filteredRows = useMemo(() => {
    let filtered = rows.filter((r) =>
      r.name.toLowerCase().includes(searchText.toLowerCase()),
    );
    if (agenticOnly) {
      filtered = filtered.filter((r) => r.agenticFeatures);
    }
    return filtered;
  }, [rows, searchText, agenticOnly]);

  const sortedRows = useMemo(() => {
    const clone = [...filteredRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    clone.sort((a, b) => {
      if (sortKey === 'projectKey') {
        return a.key.localeCompare(b.key) * dir;
      }
      if (sortKey === 'versions') {
        return ((a.versionNumber || 0) - (b.versionNumber || 0)) * dir;
      }
      if (sortKey === 'perms') {
        return ((a.permissions?.length || 0) - (b.permissions?.length || 0)) * dir;
      }
      if (sortKey === 'agentsTools') {
        const af = a.agenticFeatures;
        const bf = b.agenticFeatures;
        const diff =
          (bf?.agents.length || 0) - (af?.agents.length || 0) ||
          (bf?.agentTools.length || 0) - (af?.agentTools.length || 0);
        return sortDir === 'asc' ? -diff : diff;
      }
      if (sortKey === 'llm') {
        const af = a.agenticFeatures;
        const bf = b.agenticFeatures;
        const diff =
          (bf?.chatUIs.length || 0) - (af?.chatUIs.length || 0) ||
          (bf?.knowledgeBanks || 0) - (af?.knowledgeBanks || 0) ||
          (bf?.agentReviews.length || 0) - (af?.agentReviews.length || 0);
        return sortDir === 'asc' ? -diff : diff;
      }
      // Footprint columns — rows without footprint collate as 0
      const af = a.footprint;
      const bf = b.footprint;
      const av = af ? af[sortKey as keyof typeof af] ?? 0 : 0;
      const bv = bf ? bf[sortKey as keyof typeof bf] ?? 0 : 0;
      return ((av as number) - (bv as number)) * dir;
    });
    return clone;
  }, [filteredRows, sortKey, sortDir]);

  const { isMaximized, open, close } = useMaximize();

  if (!isVisible('projects-table') || rows.length === 0) {
    return null;
  }

  const renderFootprintMissing = () => (
    <span className="text-[var(--text-muted)]">—</span>
  );

  const tableContent = (constrained: boolean) => (
    <>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search projects..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="input-glass w-full pl-10 pr-4"
            />
          </div>
          {agenticCount > 0 && (
            <button
              onClick={() => setAgenticOnly(!agenticOnly)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap
                transition-all duration-150 ease-out ${
                  agenticOnly
                    ? 'bg-[var(--neon-purple)]/15 text-[var(--neon-purple)] border border-[var(--neon-purple)]/30'
                    : 'bg-[var(--bg-glass)] text-[var(--text-secondary)] border border-[var(--border-glass)] hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]'
                }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Agentic
            </button>
          )}
        </div>
      </div>

      {footprintReady && (
        <div className="px-4 py-2 text-sm text-[var(--text-secondary)] border-b border-[var(--border-glass)]">
          Average project size on instance:{' '}
          <span className="font-mono text-[var(--text-primary)]">
            {avgProjectGB.toFixed(2)} GB
          </span>
        </div>
      )}

      <div className={constrained ? 'max-h-[500px] overflow-y-auto' : 'overflow-y-auto'}>
        <table className="table-dark">
          <thead>
            <tr>
              <th
                className="w-[24%] min-w-[180px] cursor-pointer hover:text-[var(--neon-cyan)] transition-colors"
                onClick={() => handleSort('projectKey')}
                title="Sort by project key"
              >
                Project{indicator('projectKey')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                onClick={() => handleSort('versions')}
                title="Sort by versions"
              >
                Versions{indicator('versions')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                onClick={() => handleSort('perms')}
                title="Sort by permissions"
              >
                Perms{indicator('perms')}
              </th>
              {agenticCount > 0 && (
                <>
                  <th
                    className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                    onClick={() => handleSort('agentsTools')}
                    title="Sort by agents and tools"
                  >
                    Agents & Tools{indicator('agentsTools')}
                  </th>
                  <th
                    className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                    onClick={() => handleSort('llm')}
                    title="Sort by LLM features (Chat UIs, KBs, Reviews)"
                  >
                    LLM{indicator('llm')}
                  </th>
                </>
              )}
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                onClick={() => handleSort('codeEnvCount')}
              >
                Code Envs{indicator('codeEnvCount')}
              </th>
              {hasCodeStudios && (
                <th
                  className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                  onClick={() => handleSort('codeStudioCount')}
                >
                  Code Studios{indicator('codeStudioCount')}
                </th>
              )}
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                onClick={() => handleSort('bundleBytes')}
              >
                Bundles{indicator('bundleBytes')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                onClick={() => handleSort('managedDatasetsBytes')}
              >
                Managed Datasets{indicator('managedDatasetsBytes')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                onClick={() => handleSort('managedFoldersBytes')}
              >
                Managed Folders{indicator('managedFoldersBytes')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors text-right whitespace-nowrap"
                onClick={() => handleSort('totalBytes')}
              >
                Total{indicator('totalBytes')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const fp = row.footprint;
              return (
                <motion.tr
                  key={row.key}
                  className="hover:bg-[var(--bg-glass)] transition-colors"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.02 }}
                >
                  <td className="max-w-[400px]">
                    <button
                      onClick={() => onViewPermissions(toProject(row))}
                      className="text-[var(--neon-cyan)] font-medium hover:underline text-left truncate block w-full"
                      title={row.name}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="font-mono text-[var(--text-secondary)] whitespace-nowrap">
                    {row.versionNumber}
                  </td>
                  <td className="font-mono text-[var(--text-secondary)] whitespace-nowrap">
                    {row.permissions.length} entries
                  </td>
                  {agenticCount > 0 && (
                    <>
                      <td className="whitespace-nowrap">
                        <AgentsToolsCell
                          row={row}
                          onView={onViewAgentic ? (p) => onViewAgentic(toProject(p)) : undefined}
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        <LlmCell
                          row={row}
                          onView={onViewAgentic ? (p) => onViewAgentic(toProject(p)) : undefined}
                        />
                      </td>
                    </>
                  )}
                  <td className="text-right font-mono font-semibold">
                    {fp ? (
                      <span className={codeEnvCountClass(fp.codeEnvCount || 0)}>
                        {fp.codeEnvCount}
                      </span>
                    ) : (
                      renderFootprintMissing()
                    )}
                  </td>
                  {hasCodeStudios && (
                    <td className="text-right font-mono font-semibold">
                      {fp ? (
                        <span className={codeStudioCountClass(fp.codeStudioCount || 0)}>
                          {fp.codeStudioCount ?? 0}
                        </span>
                      ) : (
                        renderFootprintMissing()
                      )}
                    </td>
                  )}
                  <td className="text-right font-mono">
                    {fp ? (
                      <>
                        <span className={getRelativeSizeColor(fp.bundleBytes || 0, maxBundleBytes)}>
                          {formatAuto(fp.bundleBytes)}
                        </span>
                        {(fp.bundleCount || 0) > 0 && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {fp.bundleCount} bundle(s)
                          </div>
                        )}
                      </>
                    ) : (
                      renderFootprintMissing()
                    )}
                  </td>
                  <td className="text-right font-mono">
                    {fp ? (
                      <span
                        className={getRelativeSizeColor(
                          fp.managedDatasetsBytes || 0,
                          maxManagedDatasetsBytes,
                        )}
                      >
                        {formatGb(fp.managedDatasetsBytes)}
                      </span>
                    ) : (
                      renderFootprintMissing()
                    )}
                  </td>
                  <td className="text-right font-mono">
                    {fp ? (
                      <span
                        className={getRelativeSizeColor(
                          fp.managedFoldersBytes || 0,
                          maxManagedFoldersBytes,
                        )}
                      >
                        {formatGb(fp.managedFoldersBytes)}
                      </span>
                    ) : (
                      renderFootprintMissing()
                    )}
                  </td>
                  <td className="text-right font-mono font-semibold">
                    {fp ? (
                      <span className={healthCellClass(fp.projectSizeHealth)}>
                        {formatGb(fp.totalBytes)}
                      </span>
                    ) : (
                      renderFootprintMissing()
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <>
      <motion.div
        className="glass-card overflow-hidden h-full"
        id="projects-table"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-[var(--text-primary)]">
              Projects
            </h4>
            <div className="flex items-center gap-2">
              <span className="badge badge-info font-mono">{rows.length}</span>
              {agenticCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--neon-purple)]/10 text-[var(--neon-purple)] border border-[var(--neon-purple)]/30">
                  {agenticCount} agentic
                </span>
              )}
              <MaximizeButton onClick={open} />
            </div>
          </div>
        </div>
        {tableContent(true)}
      </motion.div>

      <MaximizePortal isOpen={isMaximized} onClose={close} title="Projects">
        {tableContent(false)}
      </MaximizePortal>
    </>
  );
}

function AgentsToolsCell({ row, onView }: { row: ProjectRow; onView?: (r: ProjectRow) => void }) {
  const feat = row.agenticFeatures;
  if (!feat || (feat.agents.length === 0 && feat.agentTools.length === 0)) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }

  return (
    <button
      onClick={() => onView?.(row)}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      title="View agentic details"
    >
      {feat.agents.length > 0 && (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/25">
          {feat.agents.length} agent{feat.agents.length !== 1 ? 's' : ''}
        </span>
      )}
      {feat.agentTools.length > 0 && (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-[var(--neon-purple)]/15 text-[var(--neon-purple)] border border-[var(--neon-purple)]/25">
          {feat.agentTools.length} tool{feat.agentTools.length !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
}

function LlmCell({ row, onView }: { row: ProjectRow; onView?: (r: ProjectRow) => void }) {
  const feat = row.agenticFeatures;
  if (!feat || (feat.chatUIs.length === 0 && feat.knowledgeBanks === 0 && feat.agentReviews.length === 0)) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }

  return (
    <button
      onClick={() => onView?.(row)}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      title="View LLM details"
    >
      {feat.chatUIs.length > 0 && (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-[var(--neon-green)]/15 text-[var(--neon-green)] border border-[var(--neon-green)]/25">
          {feat.chatUIs.length} UI{feat.chatUIs.length !== 1 ? 's' : ''}
        </span>
      )}
      {feat.knowledgeBanks > 0 && (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-[var(--text-secondary)]/15 text-[var(--text-secondary)] border border-[var(--text-secondary)]/25">
          {feat.knowledgeBanks} KB{feat.knowledgeBanks !== 1 ? 's' : ''}
        </span>
      )}
      {feat.agentReviews.length > 0 && (
        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-[var(--neon-amber)]/15 text-[var(--neon-amber)] border border-[var(--neon-amber)]/25">
          {feat.agentReviews.length} rev
        </span>
      )}
    </button>
  );
}
