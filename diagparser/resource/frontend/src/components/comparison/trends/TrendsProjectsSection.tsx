import { useState } from 'react';
import type { ParsedData, Project } from '../../../types';
import { SectionCard } from './trendsHelpers';

interface TrendsProjectsSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsProjectsSection({ run1, run2 }: TrendsProjectsSectionProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const after = run1.projects ?? [];
  const before = run2.projects ?? [];

  if (after.length === 0 && before.length === 0) {
    return (
      <SectionCard title="Projects">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">No projects found</div>
      </SectionCard>
    );
  }

  const beforeMap = new Map<string, Project>(before.map(p => [p.key, p]));
  const afterMap = new Map<string, Project>(after.map(p => [p.key, p]));
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const added: Project[] = [];
  const removed: Project[] = [];
  const changed: Array<{ b: Project; a: Project; diffs: string[] }> = [];
  const unchanged: Project[] = [];

  for (const key of allKeys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    if (!b && a) { added.push(a); continue; }
    if (b && !a) { removed.push(b); continue; }
    if (b && a) {
      const diffs: string[] = [];
      if (b.owner !== a.owner) diffs.push('owner');
      if (b.versionNumber !== a.versionNumber) diffs.push('version');
      if (JSON.stringify(b.permissions) !== JSON.stringify(a.permissions)) diffs.push('permissions');
      if (diffs.length > 0) { changed.push({ b, a, diffs }); } else { unchanged.push(a); }
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

  return (
    <SectionCard
      title="Projects"
      subtitle={`${allKeys.size} total`}
      badge={
        hasChanges ? (
          <>
            {added.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-green)]">+{added.length}</span>}
            {removed.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-red)]">-{removed.length}</span>}
            {changed.length > 0 && <span className="text-[10px] font-mono text-[var(--neon-amber)]">~{changed.length}</span>}
          </>
        ) : undefined
      }
    >
      {!hasChanges ? (
        <div className="text-sm text-[var(--text-muted)]">No project changes detected</div>
      ) : (
        <div className="space-y-1">
          {added.map(p => (
            <div key={p.key} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-green)]/5">
              <span className="text-[10px] font-mono text-[var(--neon-green)] w-14">added</span>
              <span className="text-[var(--text-primary)] font-medium">{p.name}</span>
              <span className="text-[var(--text-muted)]">({p.key})</span>
              <span className="text-[var(--text-muted)] ml-auto">owner: {p.owner}</span>
            </div>
          ))}
          {removed.map(p => (
            <div key={p.key} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-red)]/5">
              <span className="text-[10px] font-mono text-[var(--neon-red)] w-14">removed</span>
              <span className="text-[var(--text-primary)] font-medium">{p.name}</span>
              <span className="text-[var(--text-muted)]">({p.key})</span>
              <span className="text-[var(--text-muted)] ml-auto">owner: {p.owner}</span>
            </div>
          ))}
          {changed.map(({ a, b, diffs }) => (
            <div key={a.key} className="rounded px-2 py-1.5 bg-[var(--neon-amber)]/5 text-xs space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[var(--neon-amber)] w-14">changed</span>
                <span className="text-[var(--text-primary)] font-medium">{a.name}</span>
                <span className="text-[var(--text-muted)] ml-auto">{diffs.join(', ')}</span>
              </div>
              {diffs.includes('owner') && (
                <div className="pl-16 text-[var(--text-muted)]">
                  owner: <span className="line-through">{b.owner}</span> → <span className="text-[var(--text-primary)]">{a.owner}</span>
                </div>
              )}
              {diffs.includes('version') && (
                <div className="pl-16 text-[var(--text-muted)]">
                  v<span className="line-through">{b.versionNumber}</span> → v<span className="text-[var(--text-primary)]">{a.versionNumber}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {unchanged.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono px-2 py-1 rounded border border-[var(--border-glass)]"
          >
            {showUnchanged ? '▼' : '▶'} {unchanged.length} unchanged
          </button>
        </div>
      )}
    </SectionCard>
  );
}
