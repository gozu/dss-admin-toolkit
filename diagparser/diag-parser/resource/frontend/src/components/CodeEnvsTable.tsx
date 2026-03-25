import { useState, useMemo } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

type ViewMode = 'summary' | 'details';

export function CodeEnvsTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const codeEnvs = parsedData.codeEnvs || [];
  const pythonVersionCounts = parsedData.pythonVersionCounts || {};
  const rVersionCounts = parsedData.rVersionCounts || {};

  const [viewMode, setViewMode] = useState<ViewMode>('summary');

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

  return (
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
          </div>
        </div>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {viewMode === 'summary' ? (
          <div className="divide-y divide-[var(--border-glass)]">
            {/* Python Versions Summary */}
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
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">
                        Version
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-glass)]">
                    {sortedPythonVersions.map(([version, count], idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                        <td className="px-4 py-2">
                          <PythonVersionBadge version={version} />
                        </td>
                        <td className="px-4 py-2 text-[var(--text-primary)]">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* R Versions Summary */}
            {sortedRVersions.length > 0 && (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <LanguageBadge language="r" />
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    R Environments
                  </span>
                </div>
                <table className="w-full">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">
                        Type
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-glass)]">
                    {sortedRVersions.map(([version, count], idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                        <td className="px-4 py-2">
                          <span className="text-[var(--neon-purple)] font-medium">{version}</span>
                        </td>
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
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Version
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Language
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-glass)]">
              {codeEnvs.map((env, idx) => (
                <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                  <td className="px-4 py-3 text-[var(--text-primary)]">{env.name}</td>
                  <td className="px-4 py-3">
                    {env.language === 'python' ? (
                      <PythonVersionBadge version={env.version} />
                    ) : (
                      <span className="text-[var(--neon-purple)] font-medium">{env.version}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <LanguageBadge language={env.language} />
                  </td>
                </tr>
              ))}
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
      // Python 2.x - red (EOL)
      colorClass = 'text-[var(--neon-red)] font-bold';
    } else if (major === 3 && minor >= 9) {
      // Python 3.9+ - green (current)
      colorClass = 'text-[var(--neon-green)]';
    } else {
      // Python 3.6-3.8 - amber (outdated but supported)
      colorClass = 'text-[var(--neon-amber)]';
    }
  }

  return <span className={colorClass}>{version}</span>;
}
