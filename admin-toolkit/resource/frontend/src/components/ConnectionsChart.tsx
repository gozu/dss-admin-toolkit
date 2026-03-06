import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type TooltipItem,
  type Plugin,
} from 'chart.js';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { BASE_TOOLTIP_STYLE, baseLegendLabels } from '../utils/chartConfig';

ChartJS.register(ArcElement, Tooltip, Legend);

// Muted categorical palette for readability
const COLORS = [
  'rgba(109, 163, 224, 0.8)',  // blue
  'rgba(153, 123, 224, 0.8)',  // violet
  'rgba(99, 198, 157, 0.8)',   // mint
  'rgba(224, 181, 97, 0.8)',   // amber
  'rgba(224, 109, 131, 0.8)',  // rose
  'rgba(101, 194, 217, 0.8)',  // cyan
  'rgba(132, 205, 116, 0.8)',  // green
  'rgba(224, 146, 106, 0.8)',  // orange
  'rgba(132, 149, 220, 0.8)',  // indigo
  'rgba(189, 130, 204, 0.8)',  // orchid
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

  const centerTextPlugin: Plugin<'doughnut'> = useMemo(() => ({
    id: 'connectionsCenterText',
    afterDraw(chart) {
      const { ctx } = chart;
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const { left, right, top, bottom } = chart.chartArea;
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;

      // Main value
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.fillStyle = isDark ? '#ffffff' : '#1a1a2e';
      if (isDark) {
        ctx.shadowColor = 'rgba(0, 168, 157, 0.4)';
        ctx.shadowBlur = 8;
      }
      ctx.fillText(String(chartData.total), centerX, centerY - 8);

      // Label
      ctx.shadowBlur = 0;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
      ctx.fillText('Total', centerX, centerY + 14);

      ctx.restore();
    },
  }), [chartData.total]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'right' as const,
        labels: baseLegendLabels({ padding: 12, font: { size: 11, family: "'JetBrains Mono', monospace" } }),
      },
      tooltip: {
        ...BASE_TOOLTIP_STYLE,
        callbacks: {
          label: (context: TooltipItem<'doughnut'>) => {
            const fullName = chartData.sortedConnections[context.dataIndex][0];
            const raw = context.raw as number;
            const percentage = Math.round((raw / chartData.total) * 100);
            return `${fullName}: ${raw} (${percentage}%)`;
          },
        },
      },
    },
    hoverOffset: 8,
  };

  return (
    <motion.div
      className="chart-container"
      id="connections-chart"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
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
        <Doughnut data={chartData} options={options} plugins={[centerTextPlugin]} />
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
  const [expanded, setExpanded] = useState(true);
  const visibleConnections = expanded ? sortedConnections : sortedConnections.slice(0, 10);
  const hiddenCount = sortedConnections.length - 10;

  return (
    <div className="chart-summary">
      <table>
        <tbody>
          {visibleConnections.map(([type, count], idx) => (
            <tr key={idx}>
              <td>{type}</td>
              <td className="text-right tabular-nums font-mono text-[#7fb3ea]">{count}</td>
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
          className="w-full mt-2 py-1.5 text-xs font-medium text-[#7fb3ea] hover:text-[#c9d2de] transition-colors border-t border-[var(--border-glass)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
