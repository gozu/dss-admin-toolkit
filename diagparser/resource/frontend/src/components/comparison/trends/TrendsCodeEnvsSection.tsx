import { useState } from 'react';
import type { ParsedData, CodeEnv } from '../../../types';
import { SectionCard } from './trendsHelpers';

interface TrendsCodeEnvsSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsCodeEnvsSection({ run1, run2 }: TrendsCodeEnvsSectionProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const after: CodeEnv[] = run1.codeEnvs ?? [];
  const before: CodeEnv[] = run2.codeEnvs ?? [];

  if (after.length === 0 && before.length === 0) {
    return (
      <SectionCard title="Code Environments">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">No code environments found</div>
      </SectionCard>
    );
  }

  const beforeMap = new Map<string, CodeEnv>(before.map(e => [`${e.name}:${e.language}`, e]));
  const afterMap = new Map<string, CodeEnv>(after.map(e => [`${e.name}:${e.language}`, e]));
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const added: CodeEnv[] = [];
  const removed: CodeEnv[] = [];
  const changed: Array<{ b: CodeEnv; a: CodeEnv }> = [];
  const unchanged: CodeEnv[] = [];

  for (const key of allKeys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    if (!b && a) { added.push(a); continue; }
    if (b && !a) { removed.push(b); continue; }
    if (b && a) {
      if (b.version !== a.version) { changed.push({ b, a }); } else { unchanged.push(a); }
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

  return (
    <SectionCard
      title="Code Environments"
      subtitle={`${allKeys.size} environments`}
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
        <div className="text-sm text-[var(--text-muted)]">No code environment changes detected</div>
      ) : (
        <div className="space-y-1">
          {added.map(e => (
            <div key={`${e.name}:${e.language}`} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-green)]/5">
              <span className="text-[10px] font-mono text-[var(--neon-green)] w-14">added</span>
              <span className="text-[var(--text-primary)] font-medium">{e.name}</span>
              <span className="text-[var(--text-muted)]">{e.language} {e.version}</span>
            </div>
          ))}
          {removed.map(e => (
            <div key={`${e.name}:${e.language}`} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-red)]/5">
              <span className="text-[10px] font-mono text-[var(--neon-red)] w-14">removed</span>
              <span className="text-[var(--text-primary)] font-medium">{e.name}</span>
              <span className="text-[var(--text-muted)]">{e.language} {e.version}</span>
            </div>
          ))}
          {changed.map(({ b, a }) => (
            <div key={`${a.name}:${a.language}`} className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-[var(--neon-amber)]/5">
              <span className="text-[10px] font-mono text-[var(--neon-amber)] w-14">changed</span>
              <span className="text-[var(--text-primary)] font-medium">{a.name}</span>
              <span className="text-[var(--text-muted)]">{a.language}</span>
              <span className="text-[var(--text-muted)] font-mono line-through">{b.version}</span>
              <span className="text-[var(--text-muted)]">→</span>
              <span className="text-[var(--neon-amber)] font-mono font-bold">{a.version}</span>
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
            {showUnchanged ? '▼' : '▶'} {unchanged.length} unchanged environments
          </button>
          {showUnchanged && (
            <div className="mt-1 space-y-0.5 opacity-50">
              {unchanged.map(e => (
                <div key={`${e.name}:${e.language}`} className="flex items-center gap-2 text-xs px-2 py-1">
                  <span className="text-[var(--text-primary)]">{e.name}</span>
                  <span className="text-[var(--text-muted)]">{e.language} {e.version}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
