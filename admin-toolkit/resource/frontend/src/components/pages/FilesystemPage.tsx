import { useDiag } from '../../context/DiagContext';
import { FilesystemChart } from '../index';

export function FilesystemPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  const hasFilesystem = parsedData.filesystemInfo && parsedData.filesystemInfo.length > 0;

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <div className="space-y-6">
        {hasFilesystem && (
          <div className="w-full">
            <FilesystemChart />
          </div>
        )}

        {!hasFilesystem && (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center">
            <p className="text-[var(--text-secondary)]">No filesystem data available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
