import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

export function PluginsTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const plugins = parsedData.plugins || [];
  const pluginDetails = parsedData.pluginDetails || [];

  if (!isVisible('plugins-table') || plugins.length === 0) {
    return null;
  }

  const rows = pluginDetails.length > 0
    ? pluginDetails
    : plugins.map((name) => ({ id: name, label: name, installedVersion: undefined as string | undefined, isDev: false }));

  const hasVersions = rows.some((r) => r.installedVersion);
  const hasDev = rows.some((r) => r.isDev);

  return (
    <div
      className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]"
      id="plugins-table"
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <h4 className="text-lg font-semibold text-[var(--text-primary)]">
          {plugins.length} Installed Plugins
        </h4>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="bg-[var(--bg-elevated)] sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                Plugin
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                ID
              </th>
              {hasVersions && (
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Version
                </th>
              )}
              {hasDev && (
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Mode
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-glass)]">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                <td className="px-4 py-3 text-[var(--text-primary)]">{row.label}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)] font-mono text-sm">{row.id}</td>
                {hasVersions && (
                  <td className="px-4 py-3 text-[var(--text-primary)] font-mono text-sm">
                    {row.installedVersion || '—'}
                  </td>
                )}
                {hasDev && (
                  <td className="px-4 py-3">
                    {row.isDev ? (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[var(--neon-orange)]/20 text-[var(--neon-orange)] border border-[var(--neon-orange)]/30">
                        DEV
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-secondary)]">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
