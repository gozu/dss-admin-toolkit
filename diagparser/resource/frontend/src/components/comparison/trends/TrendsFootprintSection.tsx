import type { ParsedData, ProjectFootprintRow } from '../../../types';
import { SectionCard, fmtBytes, deltaColor, deltaSign } from './trendsHelpers';

interface TrendsFootprintSectionProps {
  run1: ParsedData;
  run2: ParsedData;
}

export function TrendsFootprintSection({ run1, run2 }: TrendsFootprintSectionProps) {
  const after: ProjectFootprintRow[] = run1.projectFootprint ?? [];
  const before: ProjectFootprintRow[] = run2.projectFootprint ?? [];

  if (after.length === 0 && before.length === 0) {
    return (
      <SectionCard title="Project Footprint">
        <div className="text-sm text-[var(--text-muted)] text-center py-4">
          — not available offline —
        </div>
      </SectionCard>
    );
  }

  // Merge by projectKey
  const merged = new Map<string, { b?: ProjectFootprintRow; a?: ProjectFootprintRow }>();
  for (const p of before) {
    merged.set(p.projectKey, { b: p });
  }
  for (const p of after) {
    merged.set(p.projectKey, { ...merged.get(p.projectKey), a: p });
  }

  // Sort by biggest total byte delta descending
  const sorted = Array.from(merged.entries()).sort((x, y) => {
    const dX = Math.abs((x[1].a?.totalBytes ?? 0) - (x[1].b?.totalBytes ?? 0));
    const dY = Math.abs((y[1].a?.totalBytes ?? 0) - (y[1].b?.totalBytes ?? 0));
    return dY - dX;
  });

  return (
    <SectionCard title="Project Footprint" subtitle={`${sorted.length} projects`}>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-[var(--bg-surface)] z-10">
            <tr className="border-b border-[var(--border-glass)]">
              <th className="py-1.5 px-2 text-left text-[var(--text-muted)] font-normal">Project</th>
              <th className="py-1.5 px-2 text-right text-[var(--text-muted)] font-normal">Before</th>
              <th className="py-1.5 px-2 text-right text-[var(--text-muted)] font-normal">After</th>
              <th className="py-1.5 px-2 text-right text-[var(--text-muted)] font-normal">Delta</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 50).map(([key, { b, a }]) => {
              const bSize = b?.totalBytes ?? null;
              const aSize = a?.totalBytes ?? null;
              const delta = aSize !== null && bSize !== null ? aSize - bSize : null;
              const hasChange = delta !== null && delta !== 0;
              return (
                <tr
                  key={key}
                  className={`border-b border-[var(--border-glass)] ${hasChange ? 'bg-[var(--neon-amber)]/5' : ''}`}
                >
                  <td className="py-1 px-2 text-[var(--text-primary)] truncate max-w-[200px]">
                    {a?.name || b?.name || key}
                  </td>
                  <td className="py-1 px-2 text-right text-[var(--text-muted)]">{fmtBytes(bSize)}</td>
                  <td className="py-1 px-2 text-right text-[var(--text-primary)]">{fmtBytes(aSize)}</td>
                  <td className="py-1 px-2 text-right">
                    {delta !== null && delta !== 0 ? (
                      <span style={{ color: deltaColor(delta) }}>
                        {deltaSign(delta)}{fmtBytes(Math.abs(delta))}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
