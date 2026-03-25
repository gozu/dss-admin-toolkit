import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, type TooltipItem } from 'chart.js';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { parseNumericValue, formatMemory } from '../utils/formatters';

ChartJS.register(ArcElement, Tooltip, Legend);

// Neon chart colors
const CHART_COLORS = {
  used: 'rgba(255, 51, 102, 0.7)',       // Neon red
  usedBorder: 'rgba(255, 51, 102, 1)',
  free: 'rgba(0, 255, 136, 0.7)',        // Neon green
  freeBorder: 'rgba(0, 255, 136, 1)',
  buffers: 'rgba(0, 245, 255, 0.7)',     // Neon cyan
  buffersBorder: 'rgba(0, 245, 255, 1)',
};

export function MemoryChart() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const memoryInfo = parsedData.memoryInfo || {};

  const chartData = useMemo(() => {
    const parseMemory = (value: string | undefined): number => {
      if (!value) return 0;
      const numValue = parseNumericValue(value);
      if (value.includes('GB')) return numValue * 1024;
      return numValue;
    };

    const usedMemory = parseMemory(memoryInfo.used);
    const freeMemory = parseMemory(memoryInfo.free);
    const buffersMemory = parseMemory(memoryInfo['buff/cache']);

    return {
      labels: ['Used', 'Free', 'Buffers/Cache'],
      datasets: [
        {
          data: [usedMemory, freeMemory, buffersMemory],
          backgroundColor: [
            CHART_COLORS.used,
            CHART_COLORS.free,
            CHART_COLORS.buffers,
          ],
          borderColor: [
            CHART_COLORS.usedBorder,
            CHART_COLORS.freeBorder,
            CHART_COLORS.buffersBorder,
          ],
          borderWidth: 2,
        },
      ],
      total: usedMemory + freeMemory + buffersMemory,
    };
  }, [memoryInfo]);

  if (!isVisible('memory-chart') || Object.keys(memoryInfo).length === 0) {
    return null;
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle',
          font: {
            size: 12,
            family: "'JetBrains Mono', monospace",
          },
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
            const raw = context.raw as number;
            const percentage = Math.round((raw / chartData.total) * 100);
            return `${context.label}: ${formatMemory(raw)} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <motion.div
      className="chart-container"
      id="memory-chart"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chart-header">
        <h4>System Memory</h4>
      </div>

      <div className="chart-body" style={{ height: '280px' }}>
        <Pie data={chartData} options={options} />
      </div>

      {/* Summary table */}
      <div className="chart-summary">
        <table>
          <tbody>
            <MemoryRow label="Total Memory" value={memoryInfo.total} />
            <MemoryRow label="Used Memory" value={memoryInfo.used} color="text-[var(--neon-red)]" />
            <MemoryRow label="Free Memory" value={memoryInfo.free} color="text-[var(--neon-green)]" />
            <MemoryRow label="Available Memory" value={memoryInfo.available} />
            {memoryInfo['buff/cache'] && (
              <MemoryRow
                label="Buffers/Cache"
                value={memoryInfo['buff/cache']}
                color="text-[var(--neon-cyan)]"
              />
            )}
            {memoryInfo['Swap total'] &&
              memoryInfo['Swap total'] !== 'Not configured' && (
                <>
                  <MemoryRow label="Swap Total" value={memoryInfo['Swap total']} />
                  <MemoryRow label="Swap Used" value={memoryInfo['Swap used']} />
                  <MemoryRow label="Swap Free" value={memoryInfo['Swap free']} />
                </>
              )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

function MemoryRow({ label, value, color }: { label: string; value?: string; color?: string }) {
  if (!value) return null;
  return (
    <tr>
      <td>{label}</td>
      <td className={color}>{value}</td>
    </tr>
  );
}
