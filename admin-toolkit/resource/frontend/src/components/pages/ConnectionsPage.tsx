import { useDiag } from '../../context/DiagContext';
import { ConnectionsChart } from '../index';
import { ConnectionHealthCard } from '../ConnectionHealthCard';

export function ConnectionsPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const hasConnections =
    (parsedData.connections && Object.keys(parsedData.connections).length > 0) ||
    (parsedData.connectionCounts && Object.keys(parsedData.connectionCounts).length > 0);

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">
      {hasConnections ? (
        <>
          <ConnectionsChart />
          <ConnectionHealthCard />
        </>
      ) : (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-[var(--text-secondary)]">No connection data available.</p>
        </div>
      )}
    </div>
  );
}
