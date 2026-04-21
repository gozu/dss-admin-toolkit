import type { HealthScore } from '../../../types';
import { SectionCard, ChangeBadge } from './trendsHelpers';

interface TrendsHealthSectionProps {
  run1Health: HealthScore | null;
  run2Health: HealthScore | null;
}

function ScoreCircle({ score, label, status }: {
  score: number | null;
  label: string;
  status?: HealthScore['status'];
}) {
  const size = 100;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const hasScore = score !== null && score !== undefined;
  const s = hasScore ? score! : 0;
  const color = !hasScore
    ? 'var(--text-muted)'
    : status === 'healthy'
      ? 'var(--neon-green)'
      : status === 'warning'
        ? 'var(--neon-amber)'
        : 'var(--neon-red)';
  const offset = hasScore ? circ * (1 - s / 100) : circ;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-glass)" strokeWidth="5" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth="5"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.7s' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-bold" style={{ color }}>
            {hasScore ? s : 'N/A'}
          </span>
        </div>
      </div>
      <span className="text-xs text-[var(--text-muted)] mt-1">{label}</span>
    </div>
  );
}

export function TrendsHealthSection({ run1Health, run2Health }: TrendsHealthSectionProps) {
  if (!run1Health && !run2Health) {
    return (
      <SectionCard title="Health Score">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">No health data available</div>
      </SectionCard>
    );
  }

  const score1 = run1Health?.overall ?? null;
  const score2 = run2Health?.overall ?? null;
  const delta = score1 !== null && score2 !== null ? score1 - score2 : null;

  // Category comparison
  const cats1 = new Map((run1Health?.categories ?? []).map(c => [c.category, c]));
  const cats2 = new Map((run2Health?.categories ?? []).map(c => [c.category, c]));
  const allCats = new Set([...cats1.keys(), ...cats2.keys()]);

  return (
    <SectionCard
      title="Health Score"
      badge={delta !== null ? <ChangeBadge delta={delta} /> : undefined}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score circles */}
        <div className="flex items-center justify-center gap-8">
          <ScoreCircle score={score2} label="Before" status={run2Health?.status} />
          <div className="flex flex-col items-center">
            <span className="text-lg text-[var(--text-muted)]">→</span>
            {delta !== null && <ChangeBadge delta={delta} />}
          </div>
          <ScoreCircle score={score1} label="After" status={run1Health?.status} />
        </div>

        {/* Category comparison */}
        <div className="space-y-3">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">Category Scores</div>
          {Array.from(allCats).map(cat => {
            const c1 = cats1.get(cat);
            const c2 = cats2.get(cat);
            const label = c1?.label ?? c2?.label ?? cat;
            const s1 = c1?.score ?? 0;
            const s2 = c2?.score ?? 0;
            const catDelta = s1 - s2;
            const barColor = (s: number) =>
              s >= 80 ? 'var(--neon-green)' : s >= 50 ? 'var(--neon-amber)' : 'var(--neon-red)';

            return (
              <div key={cat}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-secondary)] truncate">{label}</span>
                  <span className="font-mono text-[var(--text-muted)] flex items-center gap-2">
                    {catDelta !== 0
                      ? `${s2.toFixed(0)} → ${s1.toFixed(0)}`
                      : s1.toFixed(0)}
                    {catDelta !== 0 && (
                      <span
                        className="text-[10px] font-mono px-1 py-0.5 rounded"
                        style={{
                          color: catDelta > 0 ? 'var(--neon-green)' : 'var(--neon-red)',
                        }}
                      >
                        {catDelta > 0 ? '+' : ''}{catDelta.toFixed(0)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex gap-1 h-2">
                  <div className="flex-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full opacity-50"
                      style={{ width: `${s2}%`, background: barColor(s2) }}
                    />
                  </div>
                  <div className="flex-1 bg-[var(--bg-glass)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${s1}%`, background: barColor(s1) }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
