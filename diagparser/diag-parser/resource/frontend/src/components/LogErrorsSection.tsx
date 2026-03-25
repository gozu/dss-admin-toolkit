import { useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';

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
      <div className="px-4 py-3 border-b border-amber-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-amber-600"
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
            <h4 className="text-lg font-semibold text-amber-800">Log Errors</h4>
            {errorCount > 0 && (
              <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-full">
                {errorCount} unique
              </span>
            )}
          </div>
          {logStats && (
            <div className="flex gap-4 text-sm text-amber-700">
              <span>Total Lines: {logStats['Total Lines']?.toLocaleString()}</span>
              <span>Displayed: {logStats['Displayed Errors']}</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-amber-50/50">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-800 bg-amber-100
                     rounded-lg hover:bg-amber-200 transition-colors mb-4"
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
            <div className="bg-amber-100/50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-800">
                <strong>Pro Tip:</strong> These are the most recent errors from
                the backend.log file. Each error block includes context lines
                before and after the error to help with debugging.
              </p>
            </div>

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
