import { motion } from 'framer-motion';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

export function DisabledFeaturesTable() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const disabledFeatures = parsedData.disabledFeatures || {};

  const entries = Object.entries(disabledFeatures);

  if (!isVisible('disabledFeatures-table') || entries.length === 0) {
    return null;
  }

  return (
    <motion.div
      className="card-alert-warning rounded-xl overflow-hidden col-span-full"
      id="disabledFeatures-table"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="px-4 py-3 border-b border-[var(--status-warning-border)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--status-warning-bg)] flex items-center justify-center">
            <svg
              className="w-5 h-5 text-[var(--neon-amber)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h4 className="text-lg font-semibold text-[var(--neon-amber)]">
              Disabled Features
            </h4>
            <p className="text-sm text-[var(--neon-amber)] opacity-70">
              The following features are disabled in this instance
            </p>
          </div>
          <span className="ml-auto badge badge-warning font-mono">
            {entries.length} {entries.length === 1 ? 'feature' : 'features'}
          </span>
        </div>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        <table className="table-dark">
          <thead>
            <tr>
              <th className="text-[var(--neon-amber)] opacity-70">Feature</th>
              <th className="text-[var(--neon-amber)] opacity-70">Status</th>
              <th className="text-[var(--neon-amber)] opacity-70">Description</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, feature], idx) => (
              <motion.tr
                key={name}
                className="hover:bg-[var(--bg-glass-hover)] transition-colors duration-100"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
              >
                <td>
                  <a
                    href={feature.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--neon-cyan)] hover:underline"
                  >
                    {name}
                  </a>
                </td>
                <td>
                  <span className="badge badge-warning font-mono">
                    {feature.status}
                  </span>
                </td>
                <td className="text-[var(--text-secondary)]">
                  {feature.description}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
