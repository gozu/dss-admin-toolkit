import { useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { DirTreemap } from './DirTreemap';
import { DirTreeTable } from './DirTreeTable';
import { useApiDirTree } from '../hooks';
import { useDiag } from '../context/DiagContext';
import type { FootprintScope } from '../types';

export function ApiDirTreeSection() {
  const { state, loadRoot, abortLoad, expandDirectory } = useApiDirTree();
  const { dispatch } = useDiag();
  const autoLoadTriggeredRef = useRef(false);

  const scope = state.scope;
  const projectKey = state.projectKey;

  const setScope = useCallback((s: FootprintScope) => {
    dispatch({ type: 'SET_API_DIR_TREE', payload: { scope: s } });
  }, [dispatch]);

  const setProjectKey = useCallback((k: string) => {
    dispatch({ type: 'SET_API_DIR_TREE', payload: { projectKey: k } });
  }, [dispatch]);

  const scopeLabel = useMemo(() => {
    if (scope === 'project') return `Project ${projectKey || '(unset)'}`;
    return 'DSS Data Directory';
  }, [scope, projectKey]);

  // Auto-load only if no data has been loaded yet
  useEffect(() => {
    if (state.tree || state.isLoading || autoLoadTriggeredRef.current) return;

    const startAutoLoad = () => {
      if (autoLoadTriggeredRef.current) return;
      autoLoadTriggeredRef.current = true;
      setScope('dss');
      loadRoot({ scope: 'dss' });
    };

    if (document.readyState === 'complete') {
      startAutoLoad();
      return;
    }

    const onLoad = () => startAutoLoad();
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, [loadRoot, setScope, state.tree, state.isLoading]);

  const handleLoad = useCallback(() => {
    if (!state.isLoading) {
      loadRoot({ scope, projectKey });
    }
  }, [loadRoot, scope, projectKey, state.isLoading]);

  if (state.isLoading && !state.tree) {
    return (
      <div className="col-span-full">
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h3 className="text-lg font-semibold text-neon-subtle mb-4">
            Directory Space Analysis
          </h3>
          <p className="text-sm text-[var(--text-muted)]">Loading directory tree from server ({scopeLabel})...</p>
          <button
            onClick={abortLoad}
            className="mt-4 px-4 py-2 text-sm rounded bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] text-[var(--text-primary)] hover:opacity-90 transition-colors"
          >
            Abort
          </button>
        </motion.div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="col-span-full">
        <motion.div
          className="glass-card p-6 border-l-4 border-[var(--neon-red)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h3 className="text-lg font-semibold text-[var(--neon-red)] mb-2">
            Failed to Load Directory Analysis
          </h3>
          <p className="text-sm text-[var(--text-muted)]">{state.error}</p>
          <button
            onClick={handleLoad}
            className="mt-4 px-4 py-2 text-sm rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
          >
            Retry
          </button>
        </motion.div>
      </div>
    );
  }

  if (!state.tree) {
    return (
      <div className="col-span-full">
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h3 className="text-lg font-semibold text-neon-subtle mb-3">
            Directory Space Analysis
          </h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">Load a server-side footprint snapshot to analyze disk usage.</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as FootprintScope)}
              className="px-3 py-2 text-sm rounded bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--text-primary)]"
            >
              <option value="project">Current Project</option>
              <option value="dss">DSS Data Directory</option>
            </select>
            {scope === 'project' && (
              <input
                type="text"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder="Project key"
                className="px-3 py-2 text-sm rounded bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--text-primary)]"
              />
            )}
            <button
              onClick={handleLoad}
              className="px-4 py-2 text-sm rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
            >
              Load Directory Analysis
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">API mode: {scopeLabel}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="col-span-full">
      <motion.div
        className="glass-card p-4 mb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as FootprintScope)}
            className="px-3 py-2 text-sm rounded bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--text-primary)]"
          >
            <option value="project">Current Project</option>
            <option value="dss">DSS Data Directory</option>
          </select>
          {scope === 'project' && (
            <input
              type="text"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              placeholder="Project key"
              className="px-3 py-2 text-sm rounded bg-[var(--bg-glass)] border border-[var(--border-glass)] text-[var(--text-primary)]"
            />
          )}
          <button
            onClick={handleLoad}
            disabled={state.isLoading}
            className="px-4 py-2 text-sm rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors disabled:opacity-60"
          >
            {state.isLoading ? 'Loading...' : 'Reload'}
          </button>
          {state.isLoading && (
            <button
              onClick={abortLoad}
              className="px-4 py-2 text-sm rounded bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] text-[var(--text-primary)] hover:opacity-90 transition-colors"
            >
              Abort
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)]">Scope: {scopeLabel}</span>
        </div>
      </motion.div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DirTreemap
        data={state.tree}
        onExpand={expandDirectory}
        expandedNodes={state.expandedNodes}
        isExpanding={state.isExpanding}
      />
      <DirTreeTable
        data={state.tree}
        onExpand={expandDirectory}
        expandedNodes={state.expandedNodes}
        isExpanding={state.isExpanding}
      />
      </div>
    </div>
  );
}
