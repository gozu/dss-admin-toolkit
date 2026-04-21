import { Fragment, useMemo, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import type { ConnectionDatasetUsage, ConnectionLlmUsage } from '../types';

type Tab = 'datasets' | 'llms';

interface AggregatedUsage {
  connectionName: string;
  datasetUsages: ConnectionDatasetUsage[];
  llmUsages: ConnectionLlmUsage[];
  totalCount: number;
}

export function ConnectionUsageCard() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const datasetUsages = parsedData.connectionDatasetUsages || [];
  const llmUsages = parsedData.connectionLlmUsages || [];
  const connectionDetails = parsedData.connectionDetails || [];
  const [tab, setTab] = useState<Tab>('datasets');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byConnection = useMemo<AggregatedUsage[]>(() => {
    const map = new Map<string, AggregatedUsage>();
    const ensure = (name: string) => {
      let entry = map.get(name);
      if (!entry) {
        entry = { connectionName: name, datasetUsages: [], llmUsages: [], totalCount: 0 };
        map.set(name, entry);
      }
      return entry;
    };
    for (const u of datasetUsages) {
      const e = ensure(u.connectionName);
      e.datasetUsages.push(u);
      e.totalCount++;
    }
    for (const u of llmUsages) {
      const e = ensure(u.connectionName);
      e.llmUsages.push(u);
      e.totalCount++;
    }
    // Also seed connections that exist but have no usage, so the card shows zeros
    for (const c of connectionDetails) {
      ensure(c.name);
    }
    return Array.from(map.values()).sort((a, b) => b.totalCount - a.totalCount);
  }, [datasetUsages, llmUsages, connectionDetails]);

  if (!isVisible('connection-usage-card')) return null;
  if (datasetUsages.length === 0 && llmUsages.length === 0) return null;

  const rows = tab === 'datasets'
    ? byConnection.filter((r) => r.datasetUsages.length > 0)
    : byConnection.filter((r) => r.llmUsages.length > 0);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div
      className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]"
      id="connection-usage-card"
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <div className="flex items-center justify-between">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">Connection Usage</h4>
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span>{datasetUsages.length} dataset refs</span>
            <span>·</span>
            <span>{llmUsages.length} LLM refs</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-[var(--border-glass)] flex gap-2">
        <TabButton active={tab === 'datasets'} onClick={() => setTab('datasets')}>
          Datasets ({datasetUsages.length})
        </TabButton>
        <TabButton active={tab === 'llms'} onClick={() => setTab('llms')}>
          LLM-Mesh ({llmUsages.length})
        </TabButton>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--text-secondary)] text-center">
            No {tab === 'datasets' ? 'dataset' : 'LLM'} usages found.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)] sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">Connection</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-[var(--text-secondary)]">Uses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-glass)]">
              {rows.map((row) => {
                const isExpanded = expanded.has(row.connectionName);
                const count = tab === 'datasets' ? row.datasetUsages.length : row.llmUsages.length;
                return (
                  <Fragment key={row.connectionName}>
                    <tr
                      className="hover:bg-[var(--bg-glass-hover)] cursor-pointer"
                      onClick={() => toggle(row.connectionName)}
                    >
                      <td className="px-4 py-3 text-[var(--text-primary)]">
                        <span className="mr-2 text-[var(--neon-cyan)]">{isExpanded ? '▼' : '▶'}</span>
                        {row.connectionName}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-primary)] font-mono text-sm">
                        {count}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={2} className="px-4 py-3 bg-[var(--bg-elevated)]/40">
                          {tab === 'datasets' ? (
                            <DatasetUsageList usages={row.datasetUsages} />
                          ) : (
                            <LlmUsageList usages={row.llmUsages} />
                          )}
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
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-3 py-1.5 text-sm font-medium rounded transition-colors ' +
        (active
          ? 'bg-[var(--neon-cyan)]/20 text-[var(--neon-cyan)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)]')
      }
    >
      {children}
    </button>
  );
}

function DatasetUsageList({ usages }: { usages: ConnectionDatasetUsage[] }) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {usages.map((u, i) => (
        <span key={i} className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] font-mono text-[var(--text-secondary)]">
          {u.projectKey}/{u.datasetName}
        </span>
      ))}
    </div>
  );
}

function LlmUsageList({ usages }: { usages: ConnectionLlmUsage[] }) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {usages.map((u, i) => (
        <span key={i} className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] font-mono text-[var(--text-secondary)]">
          {u.projectKey}/{u.objectName}
          <span className="ml-1 text-[var(--text-secondary)]/60">[{u.usageContext}]</span>
        </span>
      ))}
    </div>
  );
}
