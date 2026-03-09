import { useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import { AiLogAnalysis } from './AiLogAnalysis';

export function LogErrorsSection() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const { parsedData } = state;
  const { formattedLogErrors, logStats } = parsedData;

  const [showLogs, setShowLogs] = useState(false);

  const hasErrors =
    formattedLogErrors && formattedLogErrors !== 'No log errors found';

  if (!isVisible('log-errors-section') || !hasErrors) {
    return null;
  }

  const errorCount = logStats?.['Unique Errors'] || 0;

  return (
    <div
      className="card-alert-warning rounded-xl shadow-sm overflow-hidden col-span-full"
      id="log-errors-section"
    >
      <div className="px-4 py-3 border-b border-[var(--status-warning-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h4 className="text-lg font-semibold text-[var(--neon-amber)]">Log Errors</h4>
            {errorCount > 0 && (
              <span className="px-2 py-0.5 bg-[var(--status-warning-border)] text-[var(--neon-amber)] text-xs font-medium rounded-full">
                {errorCount} unique
              </span>
            )}
          </div>
          {logStats && (
            <div className="flex gap-4 text-sm text-[var(--neon-amber)]">
              <span>Total Lines: {logStats['Total Lines']?.toLocaleString()}</span>
              <span>Displayed: {logStats['Displayed Errors']}</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-[var(--status-warning-bg)]">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--neon-amber)] bg-[var(--status-warning-border)]/50
                     rounded-lg hover:bg-[var(--status-warning-border)] transition-colors mb-4"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showLogs ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          {showLogs ? 'Hide Log Errors' : 'Show Log Errors'}
        </button>

        {showLogs && (
          <>
            <div className="bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] rounded-lg p-4 mb-4">
              <p className="text-sm text-[var(--neon-amber)]">
                <strong>Pro Tip:</strong> These are the most recent errors from
                the backend.log file. Each error block includes context lines
                before and after the error to help with debugging.
              </p>
            </div>

            <AiLogAnalysis />

            <div
              className="log-container rounded-lg"
              dangerouslySetInnerHTML={{ __html: formattedLogErrors || '' }}
            />
          </>
        )}
      </div>
    </div>
  );
}
