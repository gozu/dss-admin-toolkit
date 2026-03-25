import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Chart as ChartJS, Tooltip, Legend } from 'chart.js';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import { Chart } from 'react-chartjs-2';
import type { DirEntry, DirTreeData } from '../types';

// Register treemap components
ChartJS.register(TreemapController, TreemapElement, Tooltip, Legend);

interface DirTreemapProps {
  data: DirTreeData;
  onExpand?: (dirPath: string) => Promise<DirEntry | null>;
  expandedNodes?: Map<string, DirEntry>;
  isExpanding?: boolean;
}

// Color palette for different depths
const DEPTH_COLORS = [
  { bg: 'rgba(0, 245, 255, 0.8)', border: 'rgba(0, 245, 255, 1)' },     // Cyan
  { bg: 'rgba(0, 255, 136, 0.7)', border: 'rgba(0, 255, 136, 1)' },     // Green
  { bg: 'rgba(255, 184, 0, 0.7)', border: 'rgba(255, 184, 0, 1)' },     // Amber
  { bg: 'rgba(255, 51, 102, 0.7)', border: 'rgba(255, 51, 102, 1)' },   // Red
  { bg: 'rgba(138, 43, 226, 0.7)', border: 'rgba(138, 43, 226, 1)' },   // Purple
  { bg: 'rgba(0, 191, 255, 0.7)', border: 'rgba(0, 191, 255, 1)' },     // Deep sky blue
];

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function DirTreemap({ data, onExpand, expandedNodes, isExpanding }: DirTreemapProps) {
  const [currentNode, setCurrentNode] = useState<DirEntry | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<DirEntry[]>([]);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const activeNode = currentNode || data.root;

  const navigateTo = useCallback(async (node: DirEntry) => {
    if (!node.isDirectory) return;

    // Check if we already have expanded data for this node
    const expandedData = expandedNodes?.get(node.path);

    // If has hidden children and no expanded data, trigger lazy expand
    if (node.hasHiddenChildren && !expandedData && onExpand) {
      setLoadingPath(node.path);
      const expanded = await onExpand(node.path);
      setLoadingPath(null);

      if (expanded) {
        setBreadcrumbs(prev => [...prev, activeNode!]);
        // Use the expanded node data
        setCurrentNode({ ...node, children: expanded.children });
        return;
      }
    }

    // Use expanded data if available
    if (expandedData) {
      setBreadcrumbs(prev => [...prev, activeNode!]);
      setCurrentNode({ ...node, children: expandedData.children });
      return;
    }

    // Normal navigation
    if (node.children.length > 0) {
      setBreadcrumbs(prev => [...prev, activeNode!]);
      setCurrentNode(node);
    }
  }, [activeNode, onExpand, expandedNodes]);

  const navigateUp = useCallback(() => {
    if (breadcrumbs.length > 0) {
      const newBreadcrumbs = [...breadcrumbs];
      const parent = newBreadcrumbs.pop();
      setBreadcrumbs(newBreadcrumbs);
      setCurrentNode(parent === data.root ? null : parent!);
    }
  }, [breadcrumbs, data.root]);

  const resetNavigation = useCallback(() => {
    setBreadcrumbs([]);
    setCurrentNode(null);
  }, []);

  const chartData = useMemo(() => {
    if (!activeNode) return { datasets: [] };

    // Check if we have expanded data for children with hidden children
    const getEffectiveChildren = (node: DirEntry): DirEntry[] => {
      const expanded = expandedNodes?.get(node.path);
      return expanded?.children || node.children;
    };

    // Get children for treemap (or the node itself if no children)
    const effectiveChildren = getEffectiveChildren(activeNode);
    const items = effectiveChildren.length > 0
      ? effectiveChildren.map(child => ({
          name: child.name,
          size: child.size,
          depth: child.depth,
          isDir: child.isDirectory,
          fileCount: child.fileCount,
          fullPath: child.path,
          hasHiddenChildren: child.hasHiddenChildren,
          _node: child,
        }))
      : [{
          name: activeNode.name,
          size: activeNode.size,
          depth: activeNode.depth,
          isDir: activeNode.isDirectory,
          fileCount: activeNode.fileCount,
          fullPath: activeNode.path,
          hasHiddenChildren: activeNode.hasHiddenChildren,
          _node: activeNode,
        }];

    return {
      datasets: [{
        tree: items,
        key: 'size',
        groups: ['name'],
        backgroundColor: (ctx: { dataIndex: number; raw?: { _data?: { depth?: number; isDir?: boolean } } }) => {
          const item = items[ctx.dataIndex];
          if (!item) return DEPTH_COLORS[0].bg;
          const colorIdx = (item.depth || 0) % DEPTH_COLORS.length;
          return item.isDir ? DEPTH_COLORS[colorIdx].bg : 'rgba(128, 128, 128, 0.5)';
        },
        borderColor: (ctx: { dataIndex: number }) => {
          const item = items[ctx.dataIndex];
          if (!item) return DEPTH_COLORS[0].border;
          const colorIdx = (item.depth || 0) % DEPTH_COLORS.length;
          return item.isDir ? DEPTH_COLORS[colorIdx].border : 'rgba(128, 128, 128, 0.8)';
        },
        borderWidth: 2,
        spacing: 2,
        labels: {
          display: true,
          align: 'center' as const,
          position: 'middle' as const,
          formatter: (ctx: { raw?: { _data?: { name?: string; size?: number } } }) => {
            const raw = ctx.raw?._data;
            if (!raw) return '';
            return raw.name || '';
          },
          color: '#f0f0f5',
          font: {
            family: "'JetBrains Mono', monospace",
            size: 11,
            weight: 'bold' as const,
          },
        },
      }],
    };
  }, [activeNode, expandedNodes]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(18, 18, 26, 0.95)',
        titleFont: { size: 13, family: "'Inter', sans-serif" },
        bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
        padding: 12,
        cornerRadius: 8,
        borderColor: 'rgba(0, 245, 255, 0.3)',
        borderWidth: 1,
        callbacks: {
          title: () => '',
          label: (ctx: { raw?: { _data?: { name?: string; size?: number; isDir?: boolean; fileCount?: number; hasHiddenChildren?: boolean } } }) => {
            const raw = ctx.raw?._data;
            if (!raw) return '';
            const lines = [
              raw.name || 'Unknown',
              `Size: ${formatSize(raw.size || 0)}`,
            ];
            if (raw.isDir) {
              lines.push(`Files: ${raw.fileCount?.toLocaleString() || 0}${raw.hasHiddenChildren ? '+' : ''}`);
              lines.push('Click to drill down');
            }
            return lines;
          },
        },
      },
    },
    onClick: (_event: unknown, elements: Array<{ index: number }>) => {
      if (elements.length > 0 && activeNode && !loadingPath) {
        const idx = elements[0].index;
        const effectiveChildren = expandedNodes?.get(activeNode.path)?.children || activeNode.children;
        const children = effectiveChildren.length > 0 ? effectiveChildren : [activeNode];
        const clickedNode = children[idx];
        if (clickedNode && clickedNode.isDirectory && (clickedNode.children.length > 0 || clickedNode.hasHiddenChildren)) {
          navigateTo(clickedNode);
        }
      }
    },
  }), [activeNode, navigateTo, loadingPath, expandedNodes]);

  if (!data.root) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-[400px]">
        <span className="text-[var(--text-muted)]">No directory data available</span>
      </div>
    );
  }

  return (
    <motion.div
      className="glass-card p-5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-neon-subtle">Treemap View</h3>
        <div className="text-xs text-[var(--text-muted)]">
          Click directories to drill down
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-2 mb-4 text-sm overflow-x-auto">
        <button
          onClick={resetNavigation}
          className={`px-2 py-1 rounded transition-colors ${
            breadcrumbs.length === 0
              ? 'text-[var(--neon-cyan)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {data.root.name}
        </button>
        {breadcrumbs.map((node, idx) => (
          <span key={node.path} className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">/</span>
            <button
              onClick={() => {
                const newBreadcrumbs = breadcrumbs.slice(0, idx + 1);
                setBreadcrumbs(newBreadcrumbs.slice(0, -1));
                setCurrentNode(node);
              }}
              className="px-2 py-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {node.name}
            </button>
          </span>
        ))}
        {currentNode && (
          <span className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">/</span>
            <span className="px-2 py-1 text-[var(--neon-cyan)]">{currentNode.name}</span>
          </span>
        )}
        {breadcrumbs.length > 0 && (
          <button
            onClick={navigateUp}
            className="ml-auto px-3 py-1 text-xs rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
          >
            ↑ Up
          </button>
        )}
      </div>

      {/* Current directory info */}
      {activeNode && (
        <div className="flex gap-4 mb-4 text-xs text-[var(--text-muted)]">
          <span>Total: <span className="text-[var(--neon-green)] font-mono">{formatSize(activeNode.size)}</span></span>
          <span>Files: <span className="text-[var(--neon-cyan)] font-mono">{activeNode.fileCount.toLocaleString()}</span></span>
          <span>Items: <span className="text-[var(--neon-amber)] font-mono">{activeNode.children.length}</span></span>
        </div>
      )}

      {/* Chart */}
      <div style={{ height: '350px' }} className="relative">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Chart type="treemap" data={chartData as any} options={options as any} />
        {/* Loading overlay */}
        {(loadingPath || isExpanding) && (
          <div className="absolute inset-0 bg-[var(--bg-void)]/50 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <motion.div
                className="w-8 h-8 border-2 border-[var(--neon-cyan)] border-t-transparent rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
              <span className="mt-2 text-sm text-[var(--text-muted)]">Loading...</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
