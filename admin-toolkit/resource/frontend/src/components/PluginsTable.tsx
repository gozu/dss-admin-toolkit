import { useDiag } from '../context/DiagContext';

export function PluginsTable() {
  const { state } = useDiag();
  const { parsedData } = state;
  const plugins = parsedData.plugins || [];
  const details = parsedData.pluginDetails;

  if (plugins.length === 0) {
    return null;
  }

  // Enriched view with version + DEV badge
  if (details && details.length > 0) {
    return (
      <div
        className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)]"
        id="plugins-table"
      >
        <div className="px-4 py-3 border-b border-[var(--border-glass)]">
          <h4 className="text-lg font-semibold text-[var(--text-primary)]">
            {details.length} Installed Plugins
          </h4>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)] sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Plugin Name
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-secondary)]">
                  Version
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-glass)]">
              {details.map((plugin) => (
                <tr key={plugin.id} className="hover:bg-[var(--bg-glass-hover)]">
                  <td className="px-4 py-3 text-[var(--text-primary)]">
                    <span className="flex items-center gap-2">
                      {plugin.label || plugin.id}
                      {plugin.isDev && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                          DEV
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-[var(--text-secondary)]">
                    {plugin.installedVersion || '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Fallback: name only
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
                Plugin Name
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-glass)]">
            {plugins.map((plugin, idx) => (
              <tr key={idx} className="hover:bg-[var(--bg-glass-hover)]">
                <td className="px-4 py-3 text-[var(--text-primary)]">{plugin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
