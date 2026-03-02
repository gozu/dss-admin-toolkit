import { useState, useCallback } from 'react';
import { useDiag } from '../../context/DiagContext';
import { HealthScoreCard, InfoPanel, FileDownloadButtons, FileViewer } from '../index';
import { useHealthScore, useModal } from '../../hooks';
import {
  DEFAULT_HEALTH_FACTOR_TOGGLES,
  type HealthFactorKey,
  type HealthFactorToggles,
} from '../../hooks/useHealthScore';

export function SummaryPage() {
  const { state } = useDiag();
  const { parsedData } = state;

  // Health factor toggles
  const [healthFactorToggles, setHealthFactorToggles] = useState<HealthFactorToggles>(
    DEFAULT_HEALTH_FACTOR_TOGGLES,
  );
  const healthScore = useHealthScore(parsedData, healthFactorToggles);

  const toggleHealthFactor = useCallback((key: HealthFactorKey) => {
    setHealthFactorToggles((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // File viewer state
  const fileViewerModal = useModal();
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);

  const handleViewFile = useCallback(
    (filename: string, content: string) => {
      setViewingFile({ name: filename, content });
      fileViewerModal.open();
    },
    [fileViewerModal],
  );

  const handleDownloadFile = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <div className="space-y-6">
        <HealthScoreCard
          healthScore={healthScore}
          healthFactorToggles={healthFactorToggles}
          onToggleHealthFactor={toggleHealthFactor}
        />

        <InfoPanel />

        <FileDownloadButtons
          onViewFile={handleViewFile}
          onDownloadFile={handleDownloadFile}
        />
      </div>

      <FileViewer
        isOpen={fileViewerModal.isOpen}
        onClose={fileViewerModal.close}
        filename={viewingFile?.name || ''}
        content={viewingFile?.content || ''}
        onDownload={handleDownloadFile}
      />
    </div>
  );
}
