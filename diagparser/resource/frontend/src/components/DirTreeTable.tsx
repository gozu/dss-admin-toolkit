import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DirEntry, DirTreeData } from '../types';
import { useMaximize } from '../hooks/useMaximize';
import { MaximizeButton, MaximizePortal } from './MaximizePortal';

interface DirTreeTableProps {
  data: DirTreeData;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function SizeBar({ size, maxSize }: { size: number; maxSize: number }) {
  const percentage = Math.min((size / maxSize) * 100, 100);
  const color = percentage > 50
    ? 'bg-[var(--neon-red)]'
    : percentage > 20
      ? 'bg-[var(--neon-amber)]'
      : 'bg-[var(--neon-green)]';

  return (
    <div className="w-20 h-2 bg-[var(--bg-glass)] rounded-full overflow-hidden">
      <motion.div
        className={`h-full ${color} rounded-full`}
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />
    </div>
  );
}

interface TreeRowProps {
  node: DirEntry;
  depth: number;
  maxSize: number;
  expanded: Set<string>;
  toggleExpand: (path: string) => void;
  visibleCount: { current: number };
  maxVisible: number;
}

function TreeRow({
  node,
  depth,
  maxSize,
  expanded,
  toggleExpand,
  visibleCount,
  maxVisible,
}: TreeRowProps) {
  if (visibleCount.current >= maxVisible) return null;
  visibleCount.current++;

  const isExpanded = expanded.has(node.path);
  const hasChildren = node.isDirectory && node.children.length > 0;
  const hasHiddenChildren = node.hasHiddenChildren;
  const indent = depth * 20;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.15 }}
        className="hover:bg-[var(--bg-glass-hover)] transition-colors group"
      >
        <td className="py-2 px-3">
          <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(node.path)}
                className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mr-2"
              >
                <motion.svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </motion.svg>
              </button>
            ) : (
              <span className="w-5 h-5 mr-2" />
            )}

            {/* Icon */}
            {node.isDirectory ? (
              <svg className="w-4 h-4 text-[var(--neon-amber)] mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[var(--text-muted)] mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
            )}

            <span className="truncate text-[var(--text-primary)] font-mono text-sm" title={node.name}>
              {node.name}
            </span>
          </div>
        </td>

        <td className="py-2 px-3 text-right">
          <span className="font-mono text-sm text-[var(--text-secondary)]">
            {formatSize(node.size)}
          </span>
        </td>

        <td className="py-2 px-3">
          <SizeBar size={node.size} maxSize={maxSize} />
        </td>

        <td className="py-2 px-3 text-right">
          <span className="font-mono text-sm text-[var(--text-muted)]">
            {node.isDirectory ? node.fileCount.toLocaleString() : '-'}
            {hasHiddenChildren && (
              <span className="text-[var(--neon-amber)] ml-1" title="Some children pruned">+</span>
            )}
          </span>
        </td>

        <td className="py-2 px-3 text-right">
          <span className="font-mono text-sm text-[var(--text-muted)]">
            {node.isDirectory ? (
              <>
                {node.children.length}
                {hasHiddenChildren && (
                  <span className="text-[var(--neon-amber)] ml-1" title="Some children pruned">+</span>
                )}
              </>
            ) : '-'}
          </span>
        </td>
      </motion.tr>

      {/* Render children if expanded */}
      <AnimatePresence>
        {isExpanded && hasChildren && node.children.map(child => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            maxSize={maxSize}
            expanded={expanded}
            toggleExpand={toggleExpand}
            visibleCount={visibleCount}
            maxVisible={maxVisible}
          />
        ))}
      </AnimatePresence>
    </>
  );
}

type SortField = 'name' | 'size' | 'files' | 'items';
type SortDirection = 'asc' | 'desc';

export function DirTreeTable({ data }: DirTreeTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand root
    if (data.root) return new Set([data.root.path]);
    return new Set();
  });
  const [sortField, setSortField] = useState<SortField>('size');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [maxVisible] = useState(200);
  const { isMaximized, open, close } = useMaximize();

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!data.root) return;
    const allPaths = new Set<string>();
    const collect = (node: DirEntry) => {
      if (node.isDirectory) {
        allPaths.add(node.path);
        node.children.forEach(collect);
      }
    };
    collect(data.root);
    setExpanded(allPaths);
  }, [data.root]);

  const collapseAll = useCallback(() => {
    if (!data.root) return;
    setExpanded(new Set([data.root.path]));
  }, [data.root]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
  }, [sortField]);

  // Sort the tree (only top-level children, keeps tree structure)
  const sortedRoot = useMemo(() => {
    if (!data.root) return null;

    const sortChildren = (node: DirEntry): DirEntry => {
      if (!node.isDirectory || node.children.length === 0) return node;

      const sortedChildren = [...node.children].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'name':
            cmp = a.name.localeCompare(b.name);
            break;
          case 'size':
            cmp = a.size - b.size;
            break;
          case 'files':
            cmp = a.fileCount - b.fileCount;
            break;
          case 'items':
            cmp = a.children.length - b.children.length;
            break;
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });

      return {
        ...node,
        children: sortedChildren.map(sortChildren),
      };
    };

    return sortChildren(data.root);
  }, [data.root, sortField, sortDirection]);

  if (!data.root) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-[400px]">
        <span className="text-[var(--text-muted)]">No directory data available</span>
      </div>
    );
  }

  const treeContent = (constrained: boolean) => (
    <>
      {/* Summary stats */}
      <div className="flex gap-4 mb-4 text-xs text-[var(--text-muted)]">
        <span>Total: <span className="text-[var(--neon-green)] font-mono">{formatSize(data.totalSize)}</span></span>
        <span>Files: <span className="text-[var(--neon-cyan)] font-mono">{data.totalFiles.toLocaleString()}</span></span>
        <span>Root: <span className="text-[var(--neon-amber)] font-mono">{data.rootPath}</span></span>
      </div>

      {/* Table */}
      <div className={`overflow-x-auto ${constrained ? 'max-h-[400px]' : ''} overflow-y-auto`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-[var(--bg-glass)] z-10">
            <tr className="border-b border-[var(--border-glass)]">
              <SortHeader field="name">Name</SortHeader>
              <SortHeader field="size">Size</SortHeader>
              <th className="py-2 px-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-24">
                Usage
              </th>
              <SortHeader field="files">Files</SortHeader>
              <SortHeader field="items">Items</SortHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-glass)]">
            {sortedRoot && (
              <TreeRow
                node={sortedRoot}
                depth={0}
                maxSize={data.totalSize}
                expanded={expanded}
                toggleExpand={toggleExpand}
                visibleCount={visibleCount}
                maxVisible={maxVisible}
              />
            )}
          </tbody>
        </table>
      </div>

      {visibleCount.current >= maxVisible && (
        <div className="mt-2 text-xs text-[var(--text-muted)] text-center">
          Showing {maxVisible} items. Expand fewer directories to see more.
        </div>
      )}
    </>
  );

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="py-2 px-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] transition-colors select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <span className="text-[var(--neon-cyan)]">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );

  const visibleCount = { current: 0 };

  return (
    <>
      <motion.div
        className="glass-card p-5"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-neon-subtle">Tree Table View</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="px-3 py-1 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-1 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
            >
              Collapse All
            </button>
            <MaximizeButton onClick={open} />
          </div>
        </div>
        {treeContent(true)}
      </motion.div>

      <MaximizePortal isOpen={isMaximized} onClose={close} title="Tree Table View">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={expandAll}
            className="px-3 py-1 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
          >
            Collapse All
          </button>
        </div>
        {treeContent(false)}
      </MaximizePortal>
    </>
  );
}
