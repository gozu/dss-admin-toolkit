import type { ParsedData } from '../../../types';
import { SectionCard, CompareValue } from './trendsHelpers';

interface TrendsSystemSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsSystemSection({ run1, run2 }: TrendsSystemSectionProps) {
  const fields = [
    { label: 'DSS Version', before: run2.dssVersion, after: run1.dssVersion },
    { label: 'Python Version', before: run2.pythonVersion, after: run1.pythonVersion },
    { label: 'CPU Cores', before: run2.cpuCores, after: run1.cpuCores },
    { label: 'Memory', before: run2.memoryInfo?.['MemTotal'], after: run1.memoryInfo?.['MemTotal'] },
    { label: 'OS', before: run2.osInfo, after: run1.osInfo },
    { label: 'Company', before: run2.company, after: run1.company },
    { label: 'Last Restart', before: run2.lastRestartTime, after: run1.lastRestartTime },
  ].filter(f => f.before || f.after);

  const changedCount = fields.filter(f => f.before !== f.after).length;

  return (
    <SectionCard
      title="System Overview"
      badge={
        changedCount > 0 ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--status-warning-bg)] text-[var(--neon-amber)]">
            {changedCount} change{changedCount !== 1 ? 's' : ''}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {fields.map(({ label, before, after }) => (
          <CompareValue key={label} label={label} before={before ?? '--'} after={after ?? '--'} />
        ))}
      </div>
    </SectionCard>
  );
}
