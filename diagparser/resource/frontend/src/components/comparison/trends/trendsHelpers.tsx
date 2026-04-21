/**
 * Shared helpers for all Trends section components.
 * All math is pure arithmetic on two ParsedData trees — no backend, no DB.
 */

import { motion } from 'framer-motion';

// ─── Formatters ────────────────────────────────────────────────────────────

export function fmtNum(v: unknown): string {
  if (v === null || v === undefined || v === '') return '--';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function fmtGB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '--';
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

/** Parse a memory string like "31.2 GB" or "32000 MB" into MB number */
export function parseMemMB(val: string | undefined): number | null {
  if (!val) return null;
  const m = val.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'GB') return n * 1024;
  if (unit === 'MB') return n;
  if (unit === 'KB') return n / 1024;
  return n / (1024 * 1024);
}

export function deltaColor(delta: number | null | undefined): string {
  if (!delta || delta === 0) return 'var(--text-muted)';
  return delta > 0 ? 'var(--neon-green)' : 'var(--neon-red)';
}

export function deltaSign(delta: number | null | undefined): string {
  if (!delta || delta === 0) return '';
  return delta > 0 ? '+' : '';
}

// ─── Shared UI atoms ────────────────────────────────────────────────────────

export function SectionCard({ title, children, subtitle, badge }: {
  title: string;
  children: React.ReactNode;
  subtitle?: string;
  badge?: React.ReactNode;
}) {
  return (
    <motion.div
      className="glass-card overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3 }}
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)] flex items-center gap-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {badge}
        <span className="flex-1" />
        {subtitle && <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </motion.div>
  );
}

export function ChangeBadge({ delta, suffix }: { delta: number | null | undefined; suffix?: string }) {
  if (!delta || delta === 0) return null;
  const color = deltaColor(delta);
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
      style={{ color, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {deltaSign(delta)}{fmtNum(delta)}{suffix || ''}
    </span>
  );
}

export function CompareValue({ label, before, after }: {
  label: string;
  before: unknown;
  after: unknown;
}) {
  const changed = String(before) !== String(after);
  return (
    <div className={`rounded-lg px-3 py-2 ${changed ? 'bg-[var(--neon-amber)]/5 border border-[var(--neon-amber)]/15' : 'bg-[var(--bg-glass)]'}`}>
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">{label}</div>
      {changed ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-[var(--text-muted)] line-through">{fmtNum(before)}</span>
          <span className="text-xs text-[var(--text-muted)]">→</span>
          <span className="font-mono text-sm text-[var(--neon-amber)] font-bold">{fmtNum(after)}</span>
        </div>
      ) : (
        <span className="font-mono text-sm text-[var(--text-primary)]">{fmtNum(after)}</span>
      )}
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-2">
      <h2 className="text-base font-semibold text-[var(--text-secondary)] tracking-wide uppercase">{label}</h2>
      <div className="flex-1 h-px bg-[var(--border-default)]" />
    </div>
  );
}
