import { Fragment, useState, useMemo } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { useMaximize } from '../hooks/useMaximize';
import { useCodeEnvSizes } from '../hooks/useCodeEnvSizes';
import { MaximizeButton, MaximizePortal } from './MaximizePortal';
import type { CodeEnvUsage } from '../types';

type ViewMode = 'summary' | 'details';

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return mb.toFixed(1) + ' MB';
  const kb = bytes / 1024;
  return kb.toFixed(0) + ' KB';
}

export function CodeEnvsTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const codeEnvs = parsedData.codeEnvs || [];
  const pythonVersionCounts = parsedData.pythonVersionCounts || {};
  const rVersionCounts = parsedData.rVersionCounts || {};
  const codeEnvSizes = useCodeEnvSizes();
  const codeEnvUsages = parsedData.codeEnvUsages || {};

  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { isMaximized, open: openMax, close } = useMaximize();
  const open = () => { setViewMode('details'); openMax(); };

  const { pythonEnvs, rEnvs } = useMemo(() => {
    const python = codeEnvs.filter((env) => env.language === 'python');
    const r = codeEnvs.filter((env) => env.language === 'r');
    return { pythonEnvs: python, rEnvs: r };
  }, [codeEnvs]);

  if (!isVisible('code-envs-table') || codeEnvs.length === 0) {
    return null;
  }

  const sortedPythonVersions = Object.entries(pythonVersionCounts).sort(
    (a, b) => b[1] - a[1]
  );
  const sortedRVersions = Object.entries(rVersionCounts).sort(
    (a, b) => b[1] - a[1]
  );

  const pythonCount = pythonEnvs.length;
  const rCount = rEnvs.length;
  const hasSizes = Object.keys(codeEnvSizes).length > 0;
  const hasUsages = Object.keys(codeEnvUsages).length > 0;

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const envsContent = (constrained: boolean) => (
    <>
      <div className={constrained ? 'max-h-[400px] overflow-y-auto' : 'overflow-y-auto'}>
        {viewMode === 'summary' ? (
          <div className="divide-y divide-[var(--border-glass)]">
            {sortedPythonVersions.length > 0 && (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <LanguageBadge language="python" />
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    Python Environments
                  </span>
                </div>
                <table className="w-full">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">Version</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-glass)]">
                    {sortedPythonVersions.map(([version, count], idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                        <td className="px-4 py-2"><PythonVersionBadge version={version} /></td>
                        <td className="px-4 py-2 text-[var(--text-primary)]">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sortedRVersions.length > 0 && (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <LanguageBadge language="r" />
                  <span className="text-sm font-medium text-[var(--text-secondary)]">R Environments</span>
                </div>
                <table className="w-full">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">Type</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-glass)]">
                    {sortedRVersions.map(([version, count], idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                        <td className="px-4 py-2"><span className="text-[var(--neon-purple)] font-medium">{version}</span></td>
                        <td className="px-4 py-2 text-[var(--text-primary)]">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)] sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">Name</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">Version</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">Language</th>
                {hasSizes && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-[var(--text-secondary)]">Size</th>
                )}
                {hasUsages && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-[var(--text-secondary)]">Usage</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-glass)]">
              {codeEnvs.map((env, idx) => {
                const usage = codeEnvUsages[env.name] || [];
                const isExpanded = expanded.has(env.name);
                const canExpand = usage.length > 0;
                return (
                  <Fragment key={idx}>
                    <tr className="hover:bg-[var(--bg-glass-hover)]">
                      <td className="px-4 py-3 text-[var(--text-primary)]">
                        {canExpand ? (
                          <button
                            onClick={() => toggleExpand(env.name)}
                            className="mr-2 text-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]/80"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        ) : (
                          <span className="mr-2 text-[var(--text-secondary)]/30">·</span>
                        )}
                        {env.name}
                      </td>
                      <td className="px-4 py-3">
                        {env.language === 'python' ? (
                          <PythonVersionBadge version={env.version} />
                        ) : (
                          <span className="text-[var(--neon-purple)] font-medium">{env.version}</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><LanguageBadge language={env.language} /></td>
                      {hasSizes && (
                        <td className="px-4 py-3 text-right text-[var(--text-primary)] font-mono text-sm">
                          {formatBytes(codeEnvSizes[env.name])}
                        </td>
                      )}
                      {hasUsages && (
                        <td className="px-4 py-3 text-right text-[var(--text-primary)] font-mono text-sm">
                          {usage.length || '—'}
                        </td>
                      )}
                    </tr>
                    {canExpand && isExpanded && (
                      <tr>
                        <td colSpan={3 + (hasSizes ? 1 : 0) + (hasUsages ? 1 : 0)}
                          className="px-4 py-3 bg-[var(--bg-elevated)]/40">
                          <UsageList usages={usage} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {codeEnvs.length > 0 && (
        <div className="px-4 py-3 border-t border-[var(--border-glass)]">
          <button
            onClick={() => setViewMode(viewMode === 'summary' ? 'details' : 'summary')}
            className="px-4 py-2 text-sm font-medium text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/10 rounded-lg transition-colors"
          >
            {viewMode === 'details' ? 'Show Summary' : 'View All Environments'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <div
        className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]"
        id="code-envs-table"
      >
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-[var(--text-primary)]">
              {codeEnvs.length} Code Environments
            </h4>
            <div className="flex items-center gap-2">
              {pythonCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/30">
                  {pythonCount} Python
                </span>
              )}
              {rCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--neon-purple)]/10 text-[var(--neon-purple)] border border-[var(--neon-purple)]/30">
                  {rCount} R
                </span>
              )}
              <MaximizeButton onClick={open} />
            </div>
          </div>
        </div>
        {envsContent(true)}
      </div>

      <MaximizePortal isOpen={isMaximized} onClose={close} title="Code Environments">
        {envsContent(false)}
      </MaximizePortal>
    </>
  );
}

function UsageList({ usages }: { usages: CodeEnvUsage[] }) {
  const projectDefaults = usages.filter(
    (u) => u.usageType === 'project-default-python' || u.usageType === 'project-default-r'
  );
  const recipes = usages.filter((u) => u.usageType === 'recipe');

  return (
    <div className="text-xs text-[var(--text-secondary)] space-y-2">
      {projectDefaults.length > 0 && (
        <div>
          <div className="font-semibold text-[var(--text-primary)] mb-1">
            Project defaults ({projectDefaults.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {projectDefaults.map((u, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] font-mono">
                {u.projectKey}
              </span>
            ))}
          </div>
        </div>
      )}
      {recipes.length > 0 && (
        <div>
          <div className="font-semibold text-[var(--text-primary)] mb-1">
            Recipe overrides ({recipes.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {recipes.map((u, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] font-mono">
                {u.projectKey}/{u.recipeName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LanguageBadge({ language }: { language: 'python' | 'r' }) {
  if (language === 'python') {
    return (
      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[var(--neon-cyan)]/20 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/30">
        Python
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[var(--neon-purple)]/20 text-[var(--neon-purple)] border border-[var(--neon-purple)]/30">
      R
    </span>
  );
}

function PythonVersionBadge({ version }: { version: string }) {
  const versionMatch = version.match(/(\d+)\.(\d+)/);
  let colorClass = 'text-[var(--text-secondary)]';

  if (versionMatch) {
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);

    if (major < 3) {
      colorClass = 'text-[var(--neon-pure-red)] font-bold';
    } else if (major === 3) {
      if (minor >= 10)      colorClass = 'text-[var(--neon-green)]';
      else if (minor === 9) colorClass = 'text-[var(--neon-yellow)]';
      else if (minor === 8) colorClass = 'text-[var(--neon-orange)]';
      else if (minor === 7) colorClass = 'text-[var(--neon-orange-red)]';
      else if (minor === 6) colorClass = 'text-[var(--neon-deep-red)]';
      else                  colorClass = 'text-[var(--neon-pure-red)] font-bold';
    }
  }

  return <span className={colorClass}>{version}</span>;
}
