import { useState, useMemo, useEffect } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { getRelativeSizeColor } from '../utils/formatters';
import { TetiGame } from './TetiGame';

type ViewMode = 'summary' | 'details';

function formatSizeGb(sizeBytes: number | undefined): string {
  const gb = (sizeBytes || 0) / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

export function CodeEnvsTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const codeEnvs = parsedData.codeEnvs || [];
  const loading = parsedData.analysisLoading;
  const isLoading = Boolean(loading?.active);
  const pythonVersionCounts = parsedData.pythonVersionCounts || {};
  const rVersionCounts = parsedData.rVersionCounts || {};

  const [viewMode, setViewMode] = useState<ViewMode>('details');
  const [showTetris, setShowTetris] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);

  // Easter egg: press 't' to toggle Tetris on/off
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (fadingOut) return;
      if (e.key === 't' || e.key === 'T') {
        if (showTetris) {
          setFadingOut(true);
        } else if (isLoading) {
          setShowTetris(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showTetris, fadingOut, isLoading]);

  // Auto-dismiss Tetris when loading finishes
  useEffect(() => {
    if (!isLoading && showTetris && !fadingOut) {
      const id = setTimeout(() => setFadingOut(true), 0);
      return () => clearTimeout(id);
    }
  }, [isLoading, showTetris, fadingOut]);

  // Handle fade-out completion
  useEffect(() => {
    if (!fadingOut) return;
    const id = setTimeout(() => {
      setShowTetris(false);
      setFadingOut(false);
    }, 600);
    return () => clearTimeout(id);
  }, [fadingOut]);

  const { pythonEnvs, rEnvs } = useMemo(() => {
    const python = codeEnvs.filter((env) => env.language === 'python');
    const r = codeEnvs.filter((env) => env.language === 'r');
    return { pythonEnvs: python, rEnvs: r };
  }, [codeEnvs]);

  const sortedCodeEnvs = useMemo(
    () =>
      [...codeEnvs].sort((a, b) => {
        const sizeA = a.sizeBytes || 0;
        const sizeB = b.sizeBytes || 0;
        if (sizeB !== sizeA) return sizeB - sizeA;
        return a.name.localeCompare(b.name);
      }),
    [codeEnvs],
  );
  const filteredCodeEnvs = useMemo(
    () =>
      ownerFilter
        ? sortedCodeEnvs.filter((env) => (env.owner || 'Unknown') === ownerFilter)
        : sortedCodeEnvs,
    [sortedCodeEnvs, ownerFilter],
  );

  const maxCodeEnvBytes = useMemo(
    () => sortedCodeEnvs.reduce((max, env) => Math.max(max, env.sizeBytes || 0), 0),
    [sortedCodeEnvs],
  );

  if (!isVisible('code-envs-table') || (codeEnvs.length === 0 && !isLoading)) {
    return null;
  }

  const sortedPythonVersions = Object.entries(pythonVersionCounts).sort((a, b) => b[1] - a[1]);
  const sortedRVersions = Object.entries(rVersionCounts).sort((a, b) => b[1] - a[1]);

  const pythonCount = pythonEnvs.length;
  const rCount = rEnvs.length;

  return (
    <div
      className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)] md:col-span-2"
      id="code-envs-table"
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <div className="flex items-center justify-between">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            {codeEnvs.length > 0
              ? ownerFilter
                ? `${filteredCodeEnvs.length} of ${codeEnvs.length} Code Envs`
                : `${codeEnvs.length} Code Envs`
              : 'Code Envs'}
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

      {ownerFilter && (
        <div className="px-4 py-2 border-b border-[var(--border-glass)] bg-[var(--bg-elevated)] flex items-center gap-2 text-sm">
          <span className="text-[var(--text-secondary)]">Filtered by owner:</span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/30 text-xs font-medium">
            {ownerFilter}
          </span>
          <button
            onClick={() => setOwnerFilter(null)}
            className="ml-1 px-2 py-0.5 text-xs rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {(showTetris || (isLoading && codeEnvs.length === 0)) &&
        (showTetris ? (
          <div
            className="transition-opacity duration-500 ease-out"
            style={{ opacity: fadingOut ? 0 : 1 }}
          >
            <TetiGame progressPct={loading?.progressPct || 0} />
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>{loading?.message || 'Analyzing...'}</span>
              <span className="font-mono">
                {Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[var(--bg-glass)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--neon-cyan)] to-[var(--neon-green)] transition-all duration-300 ease-out"
                style={{
                  width: `${Math.max(0, Math.min(100, Math.round(loading?.progressPct || 0)))}%`,
                }}
              />
            </div>
          </div>
        ))}

      {!showTetris && !(isLoading && codeEnvs.length === 0) && (
        <>
          <div>
            {codeEnvs.length === 0 ? (
              <div className="p-4 text-sm text-[var(--text-secondary)]">
                Waiting for code environment data...
              </div>
            ) : viewMode === 'summary' ? (
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
                              <span className="text-[var(--neon-purple)] font-medium">
                                {version}
                              </span>
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
                      Owner
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                      Version
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                      Language
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                      Size (GB)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-glass)]">
                  {filteredCodeEnvs.map((env, idx) => (
                    <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                      <td className="px-4 py-3 text-[var(--text-primary)]">{env.name}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setOwnerFilter(env.owner || 'Unknown')}
                          className="text-[var(--neon-cyan)] hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
                        >
                          {env.owner || 'Unknown'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {env.language === 'python' ? (
                          <PythonVersionBadge version={env.version} />
                        ) : (
                          <span className="text-[var(--neon-purple)] font-medium">
                            {env.version}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <LanguageBadge language={env.language} />
                      </td>
                      <td
                        className={`px-4 py-3 font-mono ${getRelativeSizeColor(env.sizeBytes || 0, maxCodeEnvBytes)}`}
                      >
                        {formatSizeGb(env.sizeBytes)}
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
        </>
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
