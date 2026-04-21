import type { ParsedData } from '../../../types';
import { SectionCard, ChangeBadge } from './trendsHelpers';

interface TrendsConnectionsSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsConnectionsSection({ run1, run2 }: TrendsConnectionsSectionProps) {
  const counts1 = run1.connectionCounts ?? run1.connections ?? {};
  const counts2 = run2.connectionCounts ?? run2.connections ?? {};

  const hasBefore = Object.keys(counts2).length > 0;
  const hasAfter = Object.keys(counts1).length > 0;

  if (!hasBefore && !hasAfter) {
    return (
      <SectionCard title="Connections">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">
          — not available offline —
        </div>
      </SectionCard>
    );
  }

  const totalBefore = hasBefore ? Object.values(counts2).reduce((s, v) => s + v, 0) : null;
  const totalAfter = hasAfter ? Object.values(counts1).reduce((s, v) => s + v, 0) : null;
  const totalDelta = totalBefore !== null && totalAfter !== null ? totalAfter - totalBefore : null;

  // Merge connection types
  const allTypes = new Set([...Object.keys(counts2), ...Object.keys(counts1)]);
  const sorted = Array.from(allTypes).sort(
    (a, b) => (counts1[b] || 0) - (counts1[a] || 0)
  );

  return (
    <SectionCard
      title="Connections"
      badge={totalDelta !== null ? <ChangeBadge delta={totalDelta} /> : undefined}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Totals side by side */}
        <div className="flex items-center justify-center gap-8">
          <div className="flex flex-col items-center">
            <div
              className="w-20 h-20 rounded-full border-4 flex items-center justify-center"
              style={{ borderColor: 'var(--neon-cyan)' }}
            >
              <span className="font-mono text-xl font-bold text-[var(--text-primary)]">
                {totalBefore ?? 'N/A'}
              </span>
            </div>
            <span className="text-xs text-[var(--text-muted)] mt-1">Before</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-lg text-[var(--text-muted)]">→</span>
            {totalDelta !== null && <ChangeBadge delta={totalDelta} />}
          </div>
          <div className="flex flex-col items-center">
            <div
              className="w-20 h-20 rounded-full border-4 flex items-center justify-center"
              style={{ borderColor: 'var(--neon-purple)' }}
            >
              <span className="font-mono text-xl font-bold text-[var(--text-primary)]">
                {totalAfter ?? 'N/A'}
              </span>
            </div>
            <span className="text-xs text-[var(--text-muted)] mt-1">After</span>
          </div>
        </div>

        {/* By type */}
        <div className="space-y-1.5">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">By Type</div>
          {sorted.map((type) => {
            const b = counts2[type] || 0;
            const a = counts1[type] || 0;
            const changed = b !== a;
            return (
              <div
                key={type}
                className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${changed ? 'bg-[var(--neon-amber)]/5' : ''}`}
              >
                <span className="text-[var(--text-secondary)] flex-1 truncate">{type}</span>
                {changed ? (
                  <>
                    <span className="font-mono text-[var(--text-muted)]">{b}</span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span className="font-mono text-[var(--text-primary)]">{a}</span>
                    <ChangeBadge delta={a - b} />
                  </>
                ) : (
                  <span className="font-mono text-[var(--text-primary)]">{a}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
