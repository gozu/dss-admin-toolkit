import { useState } from 'react';
import type { ParsedData } from '../../../types';
import { SectionCard } from './trendsHelpers';

interface TrendsPluginsSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

interface PluginEntry {
  id: string;
  label: string;
  version?: string;
  isDev?: boolean;
}

function toPluginEntries(data: ParsedData): PluginEntry[] {
  if (data.pluginDetails && data.pluginDetails.length > 0) {
    return data.pluginDetails.map(p => ({
      id: p.id,
      label: p.label || p.id,
      version: p.installedVersion,
      isDev: p.isDev,
    }));
  }
  // Fallback: plain string list
  return (data.plugins ?? []).map(id => ({ id, label: id }));
}

export function TrendsPluginsSection({ run1, run2 }: TrendsPluginsSectionProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const after = toPluginEntries(run1);   // run1 = "after"
  const before = toPluginEntries(run2);  // run2 = "before"

  if (after.length === 0 && before.length === 0) {
    return (
      <SectionCard title="Plugins">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">No plugins found</div>
      </SectionCard>
    );
  }

  const beforeMap = new Map(before.map(p => [p.id, p]));
  const afterMap = new Map(after.map(p => [p.id, p]));
  const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const added: PluginEntry[] = [];
  const removed: PluginEntry[] = [];
  const changed: Array<{ b: PluginEntry; a: PluginEntry }> = [];
  const unchanged: PluginEntry[] = [];

  for (const id of allIds) {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    if (!b && a) { added.push(a); continue; }
    if (b && !a) { removed.push(b); continue; }
    if (b && a) {
      if (b.version !== a.version || b.isDev !== a.isDev) {
        changed.push({ b, a });
      } else {
        unchanged.push(a);
      }
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

  if (!hasChanges) {
    return (
      <SectionCard title="Plugins" subtitle={`${unchanged.length} plugins, no changes`}>
        <div className="text-sm text-[var(--text-muted)]">No plugin changes detected</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Plugins"
      badge={
        <>
          {added.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-green)]">+{added.length}</span>}
          {removed.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-red)]">-{removed.length}</span>}
          {changed.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-amber)]">~{changed.length}</span>}
        </>
      }
    >
      <div className="space-y-1">
        {added.map(p => (
          <div key={p.id} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-green)]/5">
            <span className="text-[10px] font-mono text-[var(--neon-green)] w-14">added</span>
            <span className="text-[var(--text-primary)] font-medium">{p.label}</span>
            {p.version && <span className="text-[var(--text-muted)] font-mono">{p.version}</span>}
            {p.isDev && <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--neon-amber)]/10 text-[var(--neon-amber)]">DEV</span>}
          </div>
        ))}
        {removed.map(p => (
          <div key={p.id} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-red)]/5">
            <span className="text-[10px] font-mono text-[var(--neon-red)] w-14">removed</span>
            <span className="text-[var(--text-primary)] font-medium">{p.label}</span>
            {p.version && <span className="text-[var(--text-muted)] font-mono">{p.version}</span>}
          </div>
        ))}
        {changed.map(({ b, a }) => (
          <div key={a.id} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-amber)]/5">
            <span className="text-[10px] font-mono text-[var(--neon-amber)] w-14">updated</span>
            <span className="text-[var(--text-primary)] font-medium">{a.label}</span>
            {b.version !== a.version && (
              <>
                <span className="text-[var(--text-muted)] font-mono line-through">{b.version ?? '?'}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <span className="text-[var(--neon-amber)] font-mono font-bold">{a.version ?? '?'}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {unchanged.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono px-2 py-1 rounded border border-[var(--border-glass)]"
          >
            {showUnchanged ? '▼' : '▶'} {unchanged.length} unchanged plugins
          </button>
          {showUnchanged && (
            <div className="mt-1 space-y-0.5 opacity-50">
              {unchanged.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-xs px-2 py-1">
                  <span className="text-[var(--text-primary)]">{p.label}</span>
                  {p.version && <span className="text-[var(--text-muted)] font-mono">{p.version}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
