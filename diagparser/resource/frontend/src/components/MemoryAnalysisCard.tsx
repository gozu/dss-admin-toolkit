import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { ChartContainer } from './ChartContainer';

export function MemoryAnalysisCard() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;

  if (!isVisible('memory-analysis')) return null;

  // Read raw values from parsedData
  const totalVmStr = parsedData.memoryInfo?.total || '';
  const backendStr = parsedData.javaMemorySettings?.BACKEND || '0g';
  const jekStr = parsedData.javaMemorySettings?.JEK || '0g';
  const maxActivitiesRaw = parsedData.maxRunningActivities?.['Max Running Activities'];
  const maxActivitiesPerJobRaw = parsedData.maxRunningActivities?.['Max Running Activities Per Job'];
  const cgroupLimitStr = String(parsedData.cgroupSettings?.['Memory Limit'] || '0');

  // Parse numeric values (all to GB)
  const totalVm = parseInt(totalVmStr.replace(/[^0-9]/g, '')) || 0;
  const backendGB = parseInt(backendStr.replace(/[^0-9]/g, '')) || 0;
  const jekGB = parseInt(jekStr.replace(/[^0-9]/g, '')) || 0;
  const cgroupLimit = parseInt(cgroupLimitStr.replace(/[^0-9]/g, '')) || 0;
  const maxActivities = typeof maxActivitiesRaw === 'number' ? maxActivitiesRaw : 0;
  const maxActivitiesPerJob = typeof maxActivitiesPerJobRaw === 'number' && maxActivitiesPerJobRaw > 0 ? maxActivitiesPerJobRaw : 1;

  // Max concurrent JEKs = max concurrent jobs
  const maxJobs = Math.ceil(maxActivities / maxActivitiesPerJob);

  // Memory model: VM Total - Backend (outside cgroup) - Workloads CGroup = Available for JEK
  const jekTotal = jekGB * maxJobs;
  const availableForJEK = totalVm - backendGB - cgroupLimit;
  const jekHeadroom = availableForJEK - jekTotal;

  // Need both VM total and cgroup limit to show the card
  if (totalVm === 0 || cgroupLimit === 0) return null;

  // Status based on JEK headroom
  const status = availableForJEK < 0 ? 'critical'
    : jekHeadroom < 0 ? 'critical'
    : jekHeadroom < 4 ? 'warning'
    : jekHeadroom < 10 ? 'info'
    : 'ok';

  const statusColors = { ok: 'var(--neon-green)', warning: 'var(--neon-yellow)', info: 'var(--neon-yellow)', critical: 'var(--neon-red)' };
  const resultColor = statusColors[status];

  return (
    <ChartContainer id="memory-analysis" title="Memory Analysis">
      <div className="chart-summary" style={{ marginTop: '0.5rem' }}>
        <table>
          <tbody>
            <tr><td className="text-[var(--text-secondary)]">VM Total</td><td className="text-right font-mono">{totalVmStr}</td></tr>
            <tr><td colSpan={2} className="py-1"><div className="border-t border-[var(--border-color)] opacity-50" /></td></tr>
            <tr><td className="text-[var(--text-secondary)] pl-2">Backend (Xmx)</td><td className="text-right font-mono text-[var(--neon-cyan)]">- {backendGB} GB</td></tr>
            <tr><td className="text-[var(--text-secondary)] pl-2">Workloads CGroup</td><td className="text-right font-mono text-[var(--neon-cyan)]">- {cgroupLimitStr}</td></tr>
            <tr><td colSpan={2} className="py-1"><div className="border-t border-[var(--border-color)] opacity-50" /></td></tr>
            <tr><td className="text-[var(--text-secondary)]">Available for JEK</td><td className="text-right font-mono" style={{ color: availableForJEK <= 0 ? 'var(--neon-red)' : 'var(--text-primary)' }}>{availableForJEK} GB</td></tr>
            {maxJobs > 0 && jekGB > 0 && (
              <>
                <tr><td className="text-[var(--text-secondary)] pl-2">JEK {jekGB}g × {maxJobs} jobs</td><td className="text-right font-mono text-[var(--neon-cyan)]">- {jekTotal} GB</td></tr>
                <tr><td colSpan={2} className="py-1"><div className="border-t border-[var(--border-color)] opacity-50" /></td></tr>
                <tr><td className="font-medium pt-1" style={{ color: resultColor }}>Headroom</td><td className="text-right font-mono font-bold pt-1" style={{ color: resultColor }}>{jekHeadroom} GB</td></tr>
              </>
            )}
          </tbody>
        </table>

        {status === 'critical' && (
          <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--neon-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--neon-red) 30%, transparent)', color: 'var(--neon-red)' }}>
            {availableForJEK < 0
              ? `Backend + workloads cgroup exceed VM total by ${Math.abs(availableForJEK)}GB.`
              : `JEK allocation exceeds available memory by ${Math.abs(jekHeadroom)}GB. OOM kills likely under full load.`}
          </div>
        )}

        {status === 'warning' && (
          <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--neon-yellow) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--neon-yellow) 30%, transparent)', color: 'var(--neon-yellow)' }}>
            Only {jekHeadroom}GB headroom after JEK allocation. Recommend at least 4GB.
          </div>
        )}
      </div>
    </ChartContainer>
  );
}
