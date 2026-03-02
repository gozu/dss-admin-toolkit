import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { useTableSort } from '../hooks/useTableSort';
import type { Project } from '../types';

interface ProjectsTableProps {
  onViewPermissions: (project: Project) => void;
}

type SortKey = 'versions' | 'perms';

export function ProjectsTable({ onViewPermissions }: ProjectsTableProps) {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const projects = parsedData.projects || [];

  const [searchText, setSearchText] = useState('');
  const { sortKey, sortDir, handleSort, sortIndicator: getSortIndicator } = useTableSort<SortKey>({
    defaultKey: 'versions',
  });

  const sortedProjects = useMemo(() => {
    const filtered = projects.filter((p) =>
      p.name.toLowerCase().includes(searchText.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      if (sortKey === 'versions') {
        const av = a.versionNumber || 0;
        const bv = b.versionNumber || 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      } else {
        const av = a.permissions?.length || 0;
        const bv = b.permissions?.length || 0;
        return sortDir === 'asc' ? av - bv : bv - av;
      }
    });
  }, [projects, searchText, sortKey, sortDir]);

  if (!isVisible('projects-table') || projects.length === 0) {
    return null;
  }

  return (
    <motion.div
      className="glass-card overflow-hidden flex flex-col flex-1 min-h-0"
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
          <span className="badge badge-info font-mono">
            {projects.length}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search projects..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="input-glass w-full"
            style={{ paddingLeft: '2.5rem', paddingRight: '1rem' }}
          />
        </div>
      </div>

      <div className="card-scroll-body">
        <table className="table-dark">
          <thead>
            <tr>
              <th className="w-[70%] min-w-[300px]">Project Name</th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                onClick={() => handleSort('versions')}
                title="Sort by versions"
              >
                Versions{getSortIndicator('versions')}
              </th>
              <th
                className="cursor-pointer hover:text-[var(--neon-cyan)] transition-colors whitespace-nowrap"
                onClick={() => handleSort('perms')}
                title="Sort by permissions"
              >
                Perms{getSortIndicator('perms')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project, idx) => (
              <motion.tr
                key={project.key}
                className="hover:bg-[var(--bg-glass)] transition-colors"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.02 }}
              >
                <td className="max-w-[400px]">
                  <button
                    onClick={() => onViewPermissions(project)}
                    className="text-[var(--neon-cyan)] font-medium hover:underline text-left break-words"
                  >
                    {project.name}
                  </button>
                  <div className="text-xs text-[var(--text-muted)] mt-1">Owner: {project.owner || 'Unknown'}</div>
                </td>
                <td className="font-mono text-[var(--text-secondary)] whitespace-nowrap">
                  {project.versionNumber}
                </td>
                <td className="font-mono text-[var(--text-secondary)] whitespace-nowrap">
                  {project.permissions.length} entries
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
