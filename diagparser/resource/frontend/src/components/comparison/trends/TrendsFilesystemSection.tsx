import type { ParsedData, FilesystemInfo } from '../../../types';
import { SectionCard, ChangeBadge } from './trendsHelpers';

interface TrendsFilesystemSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsFilesystemSection({ run1, run2 }: TrendsFilesystemSectionProps) {
  const mountsBefore: FilesystemInfo[] = run2.filesystemInfo ?? [];
  const mountsAfter: FilesystemInfo[] = run1.filesystemInfo ?? [];

  if (mountsBefore.length === 0 && mountsAfter.length === 0) {
    return (
      <SectionCard title="Filesystem">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">
          — not available offline —
        </div>
      </SectionCard>
    );
  }

  // Merge by mount point
  const allMounts = new Map<string, { before?: FilesystemInfo; after?: FilesystemInfo }>();
  for (const m of mountsBefore) {
    const key = m['Mounted on'] || '';
    allMounts.set(key, { before: m });
  }
  for (const m of mountsAfter) {
    const key = m['Mounted on'] || '';
    allMounts.set(key, { ...allMounts.get(key), after: m });
  }

  return (
    <SectionCard title="Filesystem" subtitle={`${allMounts.size} mount points`}>
      <div className="space-y-3">
        {Array.from(allMounts.entries()).map(([mount, { before, after }]) => {
          const bPct = parseFloat(before?.['Use%'] ?? '0');
          const aPct = parseFloat(after?.['Use%'] ?? '0');
          const changed = Math.abs(bPct - aPct) > 0.5;
          const pctDelta = aPct - bPct;
          const barColor = aPct >= 90
            ? 'var(--neon-red)'
            : aPct >= 70
              ? 'var(--neon-amber)'
              : 'var(--neon-green)';

          return (
            <div key={mount}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--text-secondary)] truncate max-w-[300px]">{mount || '(unknown)'}</span>
                <span className="font-mono text-[var(--text-muted)] flex items-center gap-2">
                  {after?.Size || before?.Size}
                  {changed && <ChangeBadge delta={pctDelta} suffix="%" />}
                </span>
              </div>
              <div className="relative h-4 rounded-full bg-[var(--bg-glass)] overflow-hidden">
                {changed && bPct > 0 && (
                  <div
                    className="absolute inset-y-0 rounded-full opacity-30"
                    style={{ width: `${bPct}%`, background: 'var(--neon-cyan)' }}
                  />
                )}
                <div
                  className="absolute inset-y-0 rounded-full"
                  style={{ width: `${aPct}%`, background: barColor }}
                />
                <div className="absolute inset-0 flex items-center justify-end pr-2">
                  <span className="text-[10px] font-mono text-[var(--text-primary)]">
                    {aPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              {(before === undefined || after === undefined) && (
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {before === undefined ? '+ added' : '- removed'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
