import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type TooltipItem,
} from 'chart.js';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

ChartJS.register(ArcElement, Tooltip, Legend);

// Vibrant neon color palette
const COLORS = [
  'rgba(0, 245, 255, 0.7)',    // Neon cyan
  'rgba(255, 0, 255, 0.7)',    // Neon magenta
  'rgba(0, 255, 136, 0.7)',    // Neon green
  'rgba(255, 184, 0, 0.7)',    // Neon amber
  'rgba(168, 85, 247, 0.7)',   // Neon purple
  'rgba(255, 51, 102, 0.7)',   // Neon red
  'rgba(0, 200, 255, 0.7)',    // Light cyan
  'rgba(255, 100, 200, 0.7)',  // Pink
  'rgba(100, 255, 100, 0.7)',  // Light green
  'rgba(255, 150, 50, 0.7)',   // Orange
];

const BORDER_COLORS = COLORS.map((c) => c.replace('0.7)', '1)'));

export function ConnectionsChart() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const connections = parsedData.connections || {};

  const chartData = useMemo(() => {
    const sortedConnections = Object.entries(connections).sort(
      (a, b) => b[1] - a[1]
    );

    const total = sortedConnections.reduce((sum, [, count]) => sum + count, 0);

    // Truncate labels for pie chart display (longer threshold for JDBC types)
    const labels = sortedConnections.map(([type]) => {
      // For JDBC types with driver info, show a shorter version in the legend
      if (type.startsWith('JDBC (') && type.length > 24) {
        // Extract driver class and show just the last part
        const match = type.match(/JDBC \(([^)]+)\)/);
        if (match) {
          const driverParts = match[1].split('.');
          const shortDriver = driverParts[driverParts.length - 1];
          return `JDBC (${shortDriver.length > 16 ? shortDriver.substring(0, 13) + '...' : shortDriver})`;
        }
      }
      return type.length > 20 ? type.substring(0, 17) + '...' : type;
    });
    const data = sortedConnections.map(([, count]) => count);

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: COLORS.slice(0, data.length),
          borderColor: BORDER_COLORS.slice(0, data.length),
          borderWidth: 2,
        },
      ],
      total,
      sortedConnections,
    };
  }, [connections]);

  if (!isVisible('connections-chart') || Object.keys(connections).length === 0) {
    return null;
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          padding: 12,
          usePointStyle: true,
          pointStyle: 'circle',
          font: { size: 11, family: "'JetBrains Mono', monospace" },
          color: '#a0a0b0',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(18, 18, 26, 0.95)',
        titleFont: { size: 13, family: "'Inter', sans-serif" },
        bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
        padding: 12,
        cornerRadius: 8,
        borderColor: 'rgba(0, 245, 255, 0.3)',
        borderWidth: 1,
        titleColor: '#f0f0f5',
        bodyColor: '#a0a0b0',
        callbacks: {
          label: (context: TooltipItem<'pie'>) => {
            const fullName = chartData.sortedConnections[context.dataIndex][0];
            const raw = context.raw as number;
            const percentage = Math.round((raw / chartData.total) * 100);
            return `${fullName}: ${raw} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <motion.div
      className="chart-container"
      id="connections-chart"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chart-header">
        <div className="flex items-center gap-2">
          <h4>Connection Types</h4>
          <span className="badge badge-info font-mono">
            {chartData.sortedConnections.length} types
          </span>
        </div>
      </div>

      <div className="chart-body" style={{ height: '280px' }}>
        <Pie data={chartData} options={options} />
      </div>

      <ConnectionsSummaryTable
        sortedConnections={chartData.sortedConnections}
        total={chartData.total}
      />
    </motion.div>
  );
}

function ConnectionsSummaryTable({
  sortedConnections,
  total,
}: {
  sortedConnections: [string, number][];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleConnections = expanded ? sortedConnections : sortedConnections.slice(0, 10);
  const hiddenCount = sortedConnections.length - 10;

  return (
    <div className="chart-summary">
      <table>
        <tbody>
          {visibleConnections.map(([type, count], idx) => (
            <tr key={idx}>
              <td>{type}</td>
              <td className="text-right tabular-nums font-mono text-[var(--neon-cyan)]">{count}</td>
              <td className="text-right tabular-nums font-mono text-[var(--text-muted)] w-16">
                {Math.round((count / total) * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 py-1.5 text-xs font-medium text-[var(--neon-cyan)] hover:text-[var(--neon-cyan-bright)] transition-colors border-t border-[var(--border-glass)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
