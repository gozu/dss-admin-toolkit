import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../utils/api';
import type { CodeEnvCompareResult } from '../types';

type SectionKey = 'green' | 'purple' | 'blue' | 'yellow';

const SECTION_META: Record<SectionKey, { label: string; description: string; color: string; badgeClass: string }> = {
  green: {
    label: 'Exact Duplicates',
    description: 'Same packages, same versions, same Python',
    color: 'var(--neon-green)',
    badgeClass: 'bg-[var(--neon-green)]/10 text-[var(--neon-green)] border-[var(--neon-green)]/30',
  },
  purple: {
    label: 'Different Python Version',
    description: 'Same packages and versions, different Python interpreter',
    color: 'var(--neon-purple)',
    badgeClass: 'bg-[var(--neon-purple)]/10 text-[var(--neon-purple)] border-[var(--neon-purple)]/30',
  },
  blue: {
    label: 'Version Mismatches',
    description: 'Same packages, at least one version difference',
    color: 'var(--neon-cyan)',
    badgeClass: 'bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] border-[var(--neon-cyan)]/30',
  },
  yellow: {
    label: 'Near Duplicates',
    description: '1–3 package difference',
    color: 'var(--neon-amber)',
    badgeClass: 'bg-[var(--neon-amber)]/10 text-[var(--neon-amber)] border-[var(--neon-amber)]/30',
  },
};

export function CodeEnvCompareTable() {
  const [data, setData] = useState<CodeEnvCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    green: true,
    purple: true,
    blue: true,
    yellow: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<CodeEnvCompareResult>('/api/code-envs/compare');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key: SectionKey) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const totalGroups =
    (data?.green.length || 0) +
    (data?.purple.length || 0) +
    (data?.blue.length || 0) +
    (data?.yellow.length || 0);

  if (error) {
    return (
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]">
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            Code Env Comparison
          </h4>
        </div>
        <div className="p-4 text-sm text-[var(--neon-red)]">{error}</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]">
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            Code Env Comparison
          </h4>
        </div>
        <div className="p-4 text-sm text-[var(--text-secondary)]">
          Comparing code environments...
        </div>
      </div>
    );
  }

  if (!data || totalGroups === 0) {
    return (
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]">
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            Code Env Comparison
          </h4>
        </div>
        <div className="p-4 text-sm text-[var(--text-secondary)]">
          {data ? `${data.analyzedCount} environments analyzed — no duplicates or near-duplicates found.` : 'No data available.'}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]">
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <div className="flex items-center justify-between">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            Code Env Comparison
            <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
              ({data.analyzedCount} Python envs analyzed)
            </span>
          </h4>
          <div className="flex items-center gap-2">
            {data.green.length > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${SECTION_META.green.badgeClass}`}>
                {data.green.length} exact
              </span>
            )}
            {data.purple.length > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${SECTION_META.purple.badgeClass}`}>
                {data.purple.length} diff py
              </span>
            )}
            {data.blue.length > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${SECTION_META.blue.badgeClass}`}>
                {data.blue.length} ver mismatch
              </span>
            )}
            {data.yellow.length > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${SECTION_META.yellow.badgeClass}`}>
                {data.yellow.length} near
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="divide-y divide-[var(--border-glass)]">
        {/* GREEN — Exact Duplicates */}
        {data.green.length > 0 && (
          <CollapsibleSection
            sectionKey="green"
            count={data.green.length}
            expanded={expanded.green}
            onToggle={() => toggle('green')}
          >
            {data.green.map((group, idx) => (
              <div key={idx} className="px-4 py-2">
                <div className="text-xs text-[var(--text-muted)] mb-1">
                  Group {idx + 1} — {group.packageCount} packages, py{group.pythonVersion}
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.envNames.map((name) => (
                    <EnvBadge key={name} name={name} />
                  ))}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* PURPLE — Different Python */}
        {data.purple.length > 0 && (
          <CollapsibleSection
            sectionKey="purple"
            count={data.purple.length}
            expanded={expanded.purple}
            onToggle={() => toggle('purple')}
          >
            {data.purple.map((group, idx) => (
              <div key={idx} className="px-4 py-2">
                <div className="text-xs text-[var(--text-muted)] mb-1">
                  Group {idx + 1} — {group.packageCount} packages
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.envNames.map((name) => (
                    <span
                      key={name}
                      className="inline-block bg-[var(--bg-elevated)] px-2 py-0.5 rounded font-mono text-xs text-[var(--text-primary)]"
                    >
                      {name}
                      <span className="ml-1 text-[var(--neon-purple)] text-[0.7rem]">
                        py{group.pythonVersions[name]}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* BLUE — Version Mismatches */}
        {data.blue.length > 0 && (
          <CollapsibleSection
            sectionKey="blue"
            count={data.blue.length}
            expanded={expanded.blue}
            onToggle={() => toggle('blue')}
          >
            {data.blue.map((group, idx) => (
              <div key={idx} className="px-4 py-2">
                <div className="text-xs text-[var(--text-muted)] mb-1">
                  Group {idx + 1} — {group.packageCount} packages, {group.diffCount} differ
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {group.envNames.map((name) => (
                    <EnvBadge key={name} name={name} />
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg-elevated)]">
                        <th className="px-3 py-1.5 text-left font-medium text-[var(--text-muted)]">
                          Package
                        </th>
                        {group.envNames.map((name) => (
                          <th
                            key={name}
                            className="px-3 py-1.5 text-left font-medium text-[var(--text-muted)] font-mono"
                          >
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-glass)]">
                      {Object.entries(group.diffs)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([pkg, versions]) => (
                          <tr key={pkg} className="hover:bg-[var(--bg-glass-hover)]">
                            <td className="px-3 py-1 font-mono text-[var(--text-primary)]">
                              {pkg}
                            </td>
                            {group.envNames.map((name) => (
                              <td
                                key={name}
                                className="px-3 py-1 font-mono text-[var(--neon-amber)]"
                              >
                                {versions[name] || (
                                  <span className="text-[var(--text-muted)]">(none)</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </CollapsibleSection>
        )}

        {/* YELLOW — Near Duplicates */}
        {data.yellow.length > 0 && (
          <CollapsibleSection
            sectionKey="yellow"
            count={data.yellow.length}
            expanded={expanded.yellow}
            onToggle={() => toggle('yellow')}
          >
            {data.yellow.map((pair, idx) => (
              <div key={idx} className="px-4 py-2">
                <div className="flex items-center gap-1 mb-1">
                  <EnvBadge name={pair.envA} />
                  <span className="text-[var(--text-muted)] text-xs mx-1">&harr;</span>
                  <EnvBadge name={pair.envB} />
                </div>
                {pair.onlyInA.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)] ml-1">
                    <span className="inline-block bg-[var(--neon-amber)]/10 text-[var(--neon-amber)] px-1.5 py-0.5 rounded text-[0.7rem] mr-1">
                      only in {pair.envA}
                    </span>
                    <span className="font-mono">{pair.onlyInA.join(', ')}</span>
                  </div>
                )}
                {pair.onlyInB.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)] ml-1 mt-0.5">
                    <span className="inline-block bg-[var(--neon-amber)]/10 text-[var(--neon-amber)] px-1.5 py-0.5 rounded text-[0.7rem] mr-1">
                      only in {pair.envB}
                    </span>
                    <span className="font-mono">{pair.onlyInB.join(', ')}</span>
                  </div>
                )}
                {pair.versionDiffs.length > 0 && (
                  <div className="mt-1 ml-1 text-xs text-[var(--text-muted)]">
                    {pair.versionDiffs.map((d) => (
                      <div key={d.package} className="font-mono">
                        {d.package}: {d.versionA || '(none)'} vs {d.versionB || '(none)'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  sectionKey,
  count,
  expanded,
  onToggle,
  children,
}: {
  sectionKey: SectionKey;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const meta = SECTION_META[sectionKey];
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--bg-glass-hover)] transition-colors text-left cursor-pointer"
      >
        <span
          className="text-xs transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', color: meta.color }}
        >
          &#9654;
        </span>
        <span className="text-sm font-medium" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{meta.description}</span>
        <span className={`ml-auto px-2 py-0.5 text-xs font-medium rounded-full border ${meta.badgeClass}`}>
          {count}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-[var(--border-glass)]/50">{children}</div>
      )}
    </div>
  );
}

function EnvBadge({ name }: { name: string }) {
  return (
    <span className="inline-block bg-[var(--bg-elevated)] px-2 py-0.5 rounded font-mono text-xs text-[var(--text-primary)]">
      {name}
    </span>
  );
}
