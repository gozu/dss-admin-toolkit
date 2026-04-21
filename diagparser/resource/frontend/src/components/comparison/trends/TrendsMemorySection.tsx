import type { ParsedData } from '../../../types';
import { SectionCard, CompareValue, ChangeBadge, parseMemMB } from './trendsHelpers';

interface TrendsMemorySectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

function MemoryCircle({ pct, totalLabel, label }: {
  pct: number | null;
  totalLabel: string;
  label: string;
}) {
  const size = 100;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const hasData = pct !== null;
  const offset = hasData ? circ * (1 - pct! / 100) : circ;
  const color = !hasData
    ? 'var(--text-muted)'
    : pct! >= 90
      ? 'var(--neon-red)'
      : pct! >= 70
        ? 'var(--neon-amber)'
        : 'var(--neon-green)';

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
          <span className="font-mono text-sm font-bold" style={{ color }}>
            {hasData ? `${pct!.toFixed(0)}%` : 'N/A'}
          </span>
          <span className="text-[9px] text-[var(--text-muted)]">{totalLabel}</span>
        </div>
      </div>
      <span className="text-xs text-[var(--text-muted)] mt-1">{label}</span>
    </div>
  );
}

export function TrendsMemorySection({ run1, run2 }: TrendsMemorySectionProps) {
  // Parse memory fields from memoryInfo (Record<string, string>)
  const mi1 = run1.memoryInfo ?? {};
  const mi2 = run2.memoryInfo ?? {};

  const totalMB1 = parseMemMB(mi1['MemTotal']);
  const totalMB2 = parseMemMB(mi2['MemTotal']);
  const freeMB1 = parseMemMB(mi1['MemFree']);
  const freeMB2 = parseMemMB(mi2['MemFree']);
  const availMB1 = parseMemMB(mi1['MemAvailable'] ?? mi1['MemFree']);
  const availMB2 = parseMemMB(mi2['MemAvailable'] ?? mi2['MemFree']);

  const usedMB1 = totalMB1 !== null && freeMB1 !== null ? totalMB1 - freeMB1 : null;
  const usedMB2 = totalMB2 !== null && freeMB2 !== null ? totalMB2 - freeMB2 : null;

  const pct1 = totalMB1 && usedMB1 !== null ? (usedMB1 / totalMB1) * 100 : null;
  const pct2 = totalMB2 && usedMB2 !== null ? (usedMB2 / totalMB2) * 100 : null;

  const fmtMB = (mb: number | null): string =>
    mb !== null ? `${(mb / 1024).toFixed(1)} GB` : '--';

  const hasAnyMemory = totalMB1 !== null || totalMB2 !== null;

  // Java memory settings
  const jm1 = run1.javaMemorySettings ?? {};
  const jm2 = run2.javaMemorySettings ?? {};
  const allJavaKeys = new Set([...Object.keys(jm1), ...Object.keys(jm2)]);

  if (!hasAnyMemory && allJavaKeys.size === 0) {
    return (
      <SectionCard title="Memory">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">
          — not available offline —
        </div>
      </SectionCard>
    );
  }

  const pctDelta = pct1 !== null && pct2 !== null ? pct1 - pct2 : null;

  return (
    <SectionCard title="Memory">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hasAnyMemory && (
          <div className="flex items-center justify-center gap-8">
            <MemoryCircle pct={pct2} totalLabel={fmtMB(totalMB2)} label="Before" />
            <div className="flex flex-col items-center">
              <span className="text-lg text-[var(--text-muted)]">→</span>
              {pctDelta !== null && <ChangeBadge delta={pctDelta} suffix="%" />}
            </div>
            <MemoryCircle pct={pct1} totalLabel={fmtMB(totalMB1)} label="After" />
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">Memory Analysis</div>
          {hasAnyMemory && (
            <>
              <CompareValue label="Total Memory" before={fmtMB(totalMB2)} after={fmtMB(totalMB1)} />
              <CompareValue label="Available" before={fmtMB(availMB2)} after={fmtMB(availMB1)} />
            </>
          )}
          {allJavaKeys.size > 0 && (
            <>
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide mt-3 mb-1">Java Heap Settings</div>
              {Array.from(allJavaKeys).map(k => (
                <CompareValue key={k} label={k} before={jm2[k] ?? '--'} after={jm1[k] ?? '--'} />
              ))}
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
