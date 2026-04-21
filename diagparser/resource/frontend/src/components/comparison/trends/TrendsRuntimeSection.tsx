import { useState } from 'react';
import type { ParsedData } from '../../../types';
import { SectionCard } from './trendsHelpers';

interface TrendsRuntimeSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

type SettingsMap = Record<string, unknown>;

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') {
    if ('value' in (v as Record<string, unknown>)) {
      return String((v as { value: unknown }).value);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

interface SettingsCategory {
  label: string;
  before: SettingsMap;
  after: SettingsMap;
}

function CategoryTable({
  cat,
  entries,
  defaultShowUnchanged,
}: {
  cat: string;
  entries: Array<{ key: string; b: unknown; a: unknown; changed: boolean }>;
  defaultShowUnchanged: boolean;
}) {
  const [showUnchanged, setShowUnchanged] = useState(defaultShowUnchanged);
  const changed = entries.filter(e => e.changed);
  const unchanged = entries.filter(e => !e.changed);

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-glass)] bg-[var(--bg-glass)]">
        <span className="text-xs font-semibold text-[var(--text-secondary)]">{cat}</span>
        {changed.length > 0 && (
          <span className="ml-2 text-[10px] font-mono text-[var(--neon-amber)]">
            {changed.length} changed
          </span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <tbody>
            {changed.map(({ key, b, a }) => (
              <tr key={key} className="border-b border-[var(--border-glass)] bg-[var(--neon-amber)]/5">
                <td className="py-1 px-2 text-[var(--text-secondary)] font-mono truncate max-w-[120px]">{key}</td>
                <td className="py-1 px-2 text-[var(--text-muted)] font-mono line-through">{fmtVal(b)}</td>
                <td className="py-1 px-2 text-xs text-[var(--text-muted)]">→</td>
                <td className="py-1 px-2 text-[var(--neon-amber)] font-mono font-bold">{fmtVal(a)}</td>
              </tr>
            ))}
            {showUnchanged && unchanged.map(({ key, a }) => (
              <tr key={key} className="border-b border-[var(--border-glass)]">
                <td className="py-1 px-2 text-[var(--text-muted)] font-mono truncate max-w-[120px]">{key}</td>
                <td colSpan={3} className="py-1 px-2 text-[var(--text-primary)] font-mono">{fmtVal(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unchanged.length > 0 && !defaultShowUnchanged && (
        <button
          onClick={() => setShowUnchanged(!showUnchanged)}
          className="w-full py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono border-t border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]"
        >
          {showUnchanged ? '▼' : '▶'} {unchanged.length} unchanged
        </button>
      )}
    </div>
  );
}

export function TrendsRuntimeSection({ run1, run2 }: TrendsRuntimeSectionProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Collect all named settings tables from parsedData
  const categories: SettingsCategory[] = [
    { label: 'Enabled Settings', before: (run2.enabledSettings ?? {}) as SettingsMap, after: (run1.enabledSettings ?? {}) as SettingsMap },
    { label: 'Spark Settings', before: (run2.sparkSettings ?? {}) as SettingsMap, after: (run1.sparkSettings ?? {}) as SettingsMap },
    { label: 'Auth Settings', before: (run2.authSettings ?? {}) as SettingsMap, after: (run1.authSettings ?? {}) as SettingsMap },
    { label: 'Container Settings', before: (run2.containerSettings ?? {}) as SettingsMap, after: (run1.containerSettings ?? {}) as SettingsMap },
    { label: 'Integration Settings', before: (run2.integrationSettings ?? {}) as SettingsMap, after: (run1.integrationSettings ?? {}) as SettingsMap },
    { label: 'Resource Limits', before: (run2.resourceLimits ?? {}) as SettingsMap, after: (run1.resourceLimits ?? {}) as SettingsMap },
    { label: 'CGroup Settings', before: (run2.cgroupSettings ?? {}) as SettingsMap, after: (run1.cgroupSettings ?? {}) as SettingsMap },
    { label: 'Proxy Settings', before: (run2.proxySettings ?? {}) as SettingsMap, after: (run1.proxySettings ?? {}) as SettingsMap },
    { label: 'Max Running Activities', before: (run2.maxRunningActivities ?? {}) as SettingsMap, after: (run1.maxRunningActivities ?? {}) as SettingsMap },
    { label: 'Java Memory Settings', before: (run2.javaMemorySettings ?? {}) as SettingsMap, after: (run1.javaMemorySettings ?? {}) as SettingsMap },
    { label: 'Java Memory Limits', before: (run2.javaMemoryLimits ?? {}) as SettingsMap, after: (run1.javaMemoryLimits ?? {}) as SettingsMap },
    { label: 'System Limits', before: (run2.systemLimits ?? {}) as SettingsMap, after: (run1.systemLimits ?? {}) as SettingsMap },
  ].filter(c => Object.keys(c.before).length > 0 || Object.keys(c.after).length > 0);

  if (categories.length === 0) {
    return (
      <SectionCard title="Runtime Config">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">
          — not available offline —
        </div>
      </SectionCard>
    );
  }

  // Build entries per category
  const categorized = categories.map(({ label, before, after }) => {
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const entries = Array.from(allKeys).map(key => ({
      key,
      b: before[key],
      a: after[key],
      changed: fmtVal(before[key]) !== fmtVal(after[key]),
    }));
    return { label, entries };
  });

  const changedCats = categorized.filter(c => c.entries.some(e => e.changed));
  const unchangedCats = categorized.filter(c => !c.entries.some(e => e.changed));

  return (
    <SectionCard
      title="Runtime Config"
      subtitle={`${changedCats.length} changed, ${unchangedCats.length} unchanged`}
    >
      {changedCats.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">No configuration changes detected</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {changedCats.map(({ label, entries }) => (
            <CategoryTable key={label} cat={label} entries={entries} defaultShowUnchanged={false} />
          ))}
        </div>
      )}
      {unchangedCats.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono px-2 py-1 rounded border border-[var(--border-glass)] hover:bg-[var(--bg-glass-hover)]"
          >
            {showUnchanged ? '▼' : '▶'} Show {unchangedCats.length} unchanged categories
          </button>
          {showUnchanged && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 opacity-60">
              {unchangedCats.map(({ label, entries }) => (
                <CategoryTable key={label} cat={label} entries={entries} defaultShowUnchanged={true} />
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
