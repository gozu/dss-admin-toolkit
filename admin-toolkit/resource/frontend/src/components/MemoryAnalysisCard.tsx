import { motion } from 'framer-motion';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

export function MemoryAnalysisCard() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;

  if (!isVisible('memory-analysis')) return null;

  // Read raw values from parsedData
  const totalVmStr = parsedData.memoryInfo?.total || '';
  const jekStr = parsedData.javaMemorySettings?.JEK || '0g';
  const maxActivitiesRaw = parsedData.maxRunningActivities?.['Max Running Activities'];
  const cgroupLimitStr = String(parsedData.cgroupSettings?.['Memory Limit'] || '0');

  // Parse numeric values
  const totalVm = parseInt(totalVmStr.replace(/[^0-9]/g, '')) || 0;
  const jekGB = parseInt(jekStr.replace(/[^0-9]/g, '')) || 0;
  const maxActivities = typeof maxActivitiesRaw === 'number' ? maxActivitiesRaw : 0;
  const cgroupLimit = parseInt(cgroupLimitStr.replace(/[^0-9]/g, '')) || 0;
  const maxRunningJobs = parsedData.jekSettings?.maxRunningJobs ?? 0;

  // JEK is per-job. maxRunningJobs caps concurrent jobs when set; otherwise worst case
  // is one job per activity.
  const maxJobs = maxRunningJobs > 0 ? Math.min(maxRunningJobs, maxActivities) : maxActivities;

  // Calculate recommended max based on total memory
  let recommendedMax = 0;
  if (totalVm > 120) {
    recommendedMax = Math.floor(totalVm * 0.75);
  } else if (totalVm > 60) {
    recommendedMax = Math.floor(totalVm * 0.66);
  } else if (totalVm > 30) {
    recommendedMax = totalVm - 20;
  } else {
    recommendedMax = Math.floor(totalVm * 0.5);
  }

  // Calculate values
  const cgroupOverageGB = cgroupLimit - recommendedMax;
  const jekTotal = jekGB * maxJobs;
  const availableGB = cgroupLimit - jekTotal;

  // Need cgroup limit to show the card
  if (cgroupLimit === 0) return null;

  // Determine status for each check
  const cgroupStatus = cgroupOverageGB > 0 ? 'warning' : 'ok';
  const jekStatus = availableGB < 0 ? 'critical' : availableGB < 16 ? 'warning' : 'ok';

  const statusColors = { ok: 'var(--neon-green)', warning: 'var(--neon-yellow)', critical: 'var(--neon-red)' };
  const cgroupColor = statusColors[cgroupStatus];
  const jekColor = statusColors[jekStatus];

  return (
    <motion.div
      className="chart-container"
      id="memory-analysis"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chart-header">
        <h4>Memory Analysis</h4>
      </div>

      <div className="chart-summary" style={{ marginTop: '0.5rem' }}>
        {/* Check 1: CGroup Limit vs Recommended Max */}
        <div className="text-xs text-[var(--text-secondary)] mb-1 font-medium">CGroup Limit Check</div>
        <table>
          <tbody>
            <tr><td className="text-[var(--text-secondary)]">VM Total</td><td className="text-right font-mono">{totalVmStr}</td></tr>
            <tr><td className="text-[var(--text-secondary)]">Recommended Max</td><td className="text-right font-mono">{recommendedMax} GB</td></tr>
            <tr><td className="text-[var(--text-secondary)]">Configured Limit</td><td className="text-right font-mono" style={{ color: cgroupColor }}>{cgroupLimitStr}</td></tr>
          </tbody>
        </table>

        {cgroupStatus !== 'ok' && (
          <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: `color-mix(in srgb, ${cgroupColor} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${cgroupColor} 30%, transparent)`, color: cgroupColor }}>
            CGroup limit exceeds recommended max by {cgroupOverageGB}GB.
          </div>
        )}

        {/* Divider */}
        <div className="my-3 border-t border-[var(--border-color)] opacity-30" />

        {/* Check 2: JEK Allocation */}
        <div className="text-xs text-[var(--text-secondary)] mb-1 font-medium">JEK Allocation Check</div>
        <table>
          <tbody>
            <tr><td className="text-[var(--text-secondary)]">CGroup Limit</td><td className="text-right font-mono">{cgroupLimitStr}</td></tr>
            <tr><td colSpan={2} className="py-1"><div className="border-t border-[var(--border-color)] opacity-50" /></td></tr>
            <tr><td className="text-[var(--text-secondary)] pl-2">JEK × Max Jobs ({maxJobs})</td><td className="text-right font-mono text-[var(--neon-cyan)]">- {jekTotal} GB</td></tr>
            <tr><td colSpan={2} className="py-1"><div className="border-t border-[var(--border-color)] opacity-50" /></td></tr>
            <tr><td className="font-medium pt-1" style={{ color: jekColor }}>Available for Backend & Misc.</td><td className="text-right font-mono font-bold pt-1" style={{ color: jekColor }}>{availableGB} GB</td></tr>
          </tbody>
        </table>

        {jekStatus !== 'ok' && (
          <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: `color-mix(in srgb, ${jekColor} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${jekColor} 30%, transparent)`, color: jekColor }}>
            {jekStatus === 'critical' ? `JEK memory over-provisioned by ${Math.abs(availableGB)}GB. OOM kills likely.` : `Only ${availableGB}GB available in cgroup. Recommend ≥16GB headroom.`}
          </div>
        )}
      </div>
    </motion.div>
  );
}
