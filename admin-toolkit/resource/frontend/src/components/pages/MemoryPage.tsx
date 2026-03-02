import { useDiag } from '../../context/DiagContext';
import { MemoryChart, MemoryAnalysisCard } from '../index';

export function MemoryPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const hasMemory = parsedData.memoryInfo && Object.keys(parsedData.memoryInfo).length > 0;

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {hasMemory ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MemoryChart />
          <MemoryAnalysisCard />
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">No memory data available.</p>
        </div>
      )}
    </div>
  );
}
