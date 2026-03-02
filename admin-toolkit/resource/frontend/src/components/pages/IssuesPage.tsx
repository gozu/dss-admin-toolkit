import { useDiag } from '../../context/DiagContext';
import { DisabledFeaturesTable } from '../index';

export function IssuesPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const hasDisabledFeatures =
    parsedData.disabledFeatures && Object.keys(parsedData.disabledFeatures).length > 0;

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {hasDisabledFeatures ? (
        <DisabledFeaturesTable />
      ) : (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">No disabled features detected.</p>
        </div>
      )}
    </div>
  );
}
