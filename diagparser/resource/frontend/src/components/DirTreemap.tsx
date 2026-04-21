import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Chart as ChartJS, Tooltip, Legend } from 'chart.js';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import { Chart } from 'react-chartjs-2';
import type { DirEntry, DirTreeData } from '../types';
import { useMaximize } from '../hooks/useMaximize';
import { MaximizeButton, MaximizePortal } from './MaximizePortal';

// Register treemap components
ChartJS.register(TreemapController, TreemapElement, Tooltip, Legend);

interface DirTreemapProps {
  data: DirTreeData;
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

export function DirTreemap({ data }: DirTreemapProps) {
  const [currentNode, setCurrentNode] = useState<DirEntry | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<DirEntry[]>([]);

  const activeNode = currentNode || data.root;

  const navigateTo = useCallback((node: DirEntry) => {
    if (!node.isDirectory || node.children.length === 0) return;
    setBreadcrumbs(prev => [...prev, activeNode!]);
    setCurrentNode(node);
  }, [activeNode]);

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

  const { isMaximized, open, close } = useMaximize();

  const chartData = useMemo(() => {
    if (!activeNode) return { datasets: [] };

    // Get children for treemap (or the node itself if no children)
    const items = activeNode.children.length > 0
      ? activeNode.children.map(child => ({
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
  }, [activeNode]);

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
      if (elements.length > 0 && activeNode) {
        const idx = elements[0].index;
        const children = activeNode.children.length > 0 ? activeNode.children : [activeNode];
        const clickedNode = children[idx];
        if (clickedNode && clickedNode.isDirectory && clickedNode.children.length > 0) {
          navigateTo(clickedNode);
        }
      }
    },
  }), [activeNode, navigateTo]);

  if (!data.root) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-[400px]">
        <span className="text-[var(--text-muted)]">No directory data available</span>
      </div>
    );
  }

  const treemapContent = (fill: boolean) => (
    <>
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
          {data.root?.name}
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
      <div style={fill ? { height: '100%' } : { height: '350px' }} className={`relative ${fill ? 'flex-1 min-h-0' : ''}`}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Chart type="treemap" data={chartData as any} options={options as any} />
      </div>
    </>
  );

  return (
    <>
      <motion.div
        className="glass-card p-5"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-neon-subtle">Treemap View</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Click directories to drill down</span>
            <MaximizeButton onClick={open} />
          </div>
        </div>
        {treemapContent(false)}
      </motion.div>

      <MaximizePortal isOpen={isMaximized} onClose={close} title="Treemap View">
        <div className="flex flex-col h-full">
          {treemapContent(true)}
        </div>
      </MaximizePortal>
    </>
  );
}
