import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type TooltipItem,
} from 'chart.js';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { parseNumericValue } from '../utils/formatters';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Neon chart colors
const CHART_COLORS = {
  used: 'rgba(255, 51, 102, 0.7)',       // Neon red
  usedBorder: 'rgba(255, 51, 102, 1)',
  available: 'rgba(0, 255, 136, 0.7)',   // Neon green
  availableBorder: 'rgba(0, 255, 136, 1)',
};

export function FilesystemChart() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const filesystemInfo = parsedData.filesystemInfo || [];

  const chartData = useMemo(() => {
    // Filter and sort filesystems
    const sortedFilesystems = [...filesystemInfo]
      .filter((fs) => parseInt(fs['Use%']) > 0 && fs['Size'])
      .sort((a, b) => parseInt(b['Use%']) - parseInt(a['Use%']));

    const parseSize = (sizeStr: string): number => {
      if (!sizeStr) return 0;
      const value = parseNumericValue(sizeStr);
      if (sizeStr.includes('T')) return value * 1024;
      if (sizeStr.includes('G')) return value;
      if (sizeStr.includes('M')) return value / 1024;
      if (sizeStr.includes('K')) return value / (1024 * 1024);
      return value;
    };

    const labels: string[] = [];
    const usedData: number[] = [];
    const availableData: number[] = [];

    for (const fs of sortedFilesystems) {
      const sizeGB = parseSize(fs['Size']);
      if (sizeGB < 0.1) continue;

      const usedGB = parseSize(fs['Used']);
      const availableGB = parseSize(fs['Available']);

      labels.push(`${fs['Mounted on'] || fs['Filesystem']} (${fs['Use%']})`);
      usedData.push(usedGB);
      availableData.push(availableGB);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Used Space (GB)',
          data: usedData,
          backgroundColor: CHART_COLORS.used,
          borderColor: CHART_COLORS.usedBorder,
          borderWidth: 2,
        },
        {
          label: 'Available Space (GB)',
          data: availableData,
          backgroundColor: CHART_COLORS.available,
          borderColor: CHART_COLORS.availableBorder,
          borderWidth: 2,
        },
      ],
      raw: sortedFilesystems,
    };
  }, [filesystemInfo]);

  if (!isVisible('filesystem-table') || filesystemInfo.length === 0) {
    return null;
  }

  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true,
        title: {
          display: true,
          text: 'Size (GB)',
          font: { size: 12, family: "'JetBrains Mono', monospace" },
          color: '#606070',
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
        ticks: {
          color: '#a0a0b0',
          font: { family: "'JetBrains Mono', monospace" },
        },
      },
      y: {
        stacked: true,
        title: {
          display: true,
          text: 'Filesystem',
          font: { size: 12, family: "'JetBrains Mono', monospace" },
          color: '#606070',
        },
        grid: {
          display: false,
        },
        ticks: {
          color: '#f0f0f5',
          font: { family: "'JetBrains Mono', monospace" },
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle',
          font: { size: 12, family: "'JetBrains Mono', monospace" },
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
          label: (context: TooltipItem<'bar'>) => {
            const fs = chartData.raw[context.dataIndex];
            const raw = context.raw as number;
            const label = context.dataset.label || '';
            if (label.includes('Used')) {
              return [
                `${label}: ${raw.toFixed(2)} GB`,
                `Usage: ${fs['Use%']}`,
                `Size: ${fs['Size']}`,
              ];
            }
            return `${label}: ${raw.toFixed(2)} GB`;
          },
        },
      },
    },
  };

  return (
    <motion.div
      className="chart-container card-2x1"
      id="filesystem-table"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chart-header">
        <h4>Filesystem Usage</h4>
      </div>

      <div className="chart-body" style={{ height: '380px' }}>
        <Bar data={chartData} options={options} />
      </div>
    </motion.div>
  );
}
