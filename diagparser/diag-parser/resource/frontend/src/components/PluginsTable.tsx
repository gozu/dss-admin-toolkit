import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

export function PluginsTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const plugins = parsedData.plugins || [];

  if (!isVisible('plugins-table') || plugins.length === 0) {
    return null;
  }

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
