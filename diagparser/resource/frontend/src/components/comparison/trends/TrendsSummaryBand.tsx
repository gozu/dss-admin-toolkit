import { motion } from 'framer-motion';
import type { ParsedData } from '../../../types';
import { fmtNum, deltaColor, deltaSign } from './trendsHelpers';

interface TrendsSummaryBandProps {
  run1: ParsedData;
  run2: ParsedData;
  run1Health: number | null;
  run2Health: number | null;
}

interface Chip {
  label: string;
  run1Val: number | null;
  run2Val: number | null;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function TrendsSummaryBand({ run1, run2, run1Health, run2Health }: TrendsSummaryBandProps) {
  const chips: Chip[] = [
    {
      label: 'Health',
      run1Val: run1Health,
      run2Val: run2Health,
    },
    {
      label: 'Users',
      run1Val: numOrNull(run1.users?.length ?? run1.userStats?.['Total users']),
      run2Val: numOrNull(run2.users?.length ?? run2.userStats?.['Total users']),
    },
    {
      label: 'Projects',
      run1Val: numOrNull(run1.projects?.length),
      run2Val: numOrNull(run2.projects?.length),
    },
    {
      label: 'Plugins',
      run1Val: numOrNull(run1.pluginsCount ?? run1.plugins?.length),
      run2Val: numOrNull(run2.pluginsCount ?? run2.plugins?.length),
    },
    {
      label: 'Connections',
      run1Val: run1.connectionCounts
        ? Object.values(run1.connectionCounts).reduce((s, v) => s + v, 0)
        : null,
      run2Val: run2.connectionCounts
        ? Object.values(run2.connectionCounts).reduce((s, v) => s + v, 0)
        : null,
    },
    {
      label: 'Code Envs',
      run1Val: numOrNull(run1.codeEnvs?.length),
      run2Val: numOrNull(run2.codeEnvs?.length),
    },
  ];

  return (
    <motion.div
      className="sticky top-0 z-10 glass-card border-[var(--border-glow)] shadow-[var(--glow-sm)] px-4 py-3 mb-5"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex flex-wrap gap-4 items-center">
        {chips.map(({ label, run1Val, run2Val }) => {
          const delta = run1Val !== null && run2Val !== null ? run1Val - run2Val : null;
          const color = deltaColor(delta);
          return (
            <div key={label} className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-muted)]">{label}</span>
              <span className="font-mono text-base font-bold text-[var(--text-primary)]">
                {run1Val !== null ? fmtNum(run1Val) : '--'}
              </span>
              {delta !== null && delta !== 0 && (
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded-full"
                  style={{ color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}
                >
                  {deltaSign(delta)}{fmtNum(delta)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
