import type { ReactNode } from 'react';
import { useBackendGate } from '../hooks/useBackendGate';
import { SetupRequiredScreen } from './SetupRequiredScreen';
import { PacmanLoader } from './index';

interface AppGateProps {
  children: (gate: { isSqliteFallback: boolean }) => ReactNode;
}

export function AppGate({ children }: AppGateProps) {
  const gate = useBackendGate();

  if (gate.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <div className="flex flex-col items-center gap-4">
          <PacmanLoader />
          <p className="text-sm text-[var(--text-secondary)]">Checking backend configuration...</p>
        </div>
      </div>
    );
  }

  if (gate.needsSetup) {
    return <SetupRequiredScreen />;
  }

  return <>{children({ isSqliteFallback: gate.isSqliteFallback })}</>;
}
