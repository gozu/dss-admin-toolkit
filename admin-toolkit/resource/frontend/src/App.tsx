import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DiagProvider, useDiag } from './context/DiagContext';
import {
  Header,
  Footer,
  PacmanLoader,
  DebugPanel,
} from './components';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppGate } from './components/AppGate';
import { useApiDataLoader, useDataSource } from './hooks';
import { AppShell } from './components/layout/AppShell';
import { PageRouter } from './components/layout/PageRouter';
import { CommandPalette } from './components/CommandPalette';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';

// Lazy load comparison components
const ComparisonUpload = lazy(() => import('./components/comparison/ComparisonUpload').then(m => ({ default: m.ComparisonUpload })));
const ComparisonResultsView = lazy(() => import('./components/comparison/ComparisonResultsView').then(m => ({ default: m.ComparisonResultsView })));

const pageVariants = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -20, scale: 0.98 },
};

const pageTransition = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

function AppContent({ sqliteFallback }: { sqliteFallback?: boolean }) {
  const { state, setMode, setActivePage, resetComparison, dispatch } = useDiag();
  const { parsedData, isLoading, error, mode, comparison, dataSource } = state;
  const { isDetecting } = useDataSource();
  const [reloadKey, setReloadKey] = useState(0);
  useApiDataLoader(dataSource === 'api', reloadKey);

  const handleRefreshCache = useCallback(async () => {
    const url = (globalThis as unknown as { dataiku?: { getWebAppBackendUrl?: (p: string) => string } }).dataiku?.getWebAppBackendUrl?.('/api/cache/clear') ?? '/api/cache/clear';
    await fetch(url, { method: 'POST', credentials: 'same-origin' });
    setReloadKey((k) => k + 1);
  }, []);

  // Command palette state
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Keyboard navigation
  useKeyboardNavigation({
    onNavigate: setActivePage,
    onOpenPalette: () => setPaletteOpen(true),
  });

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || 'Unknown runtime error';
      const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : '';
      dispatch({
        type: 'ADD_DEBUG_LOG',
        payload: {
          scope: 'frontend',
          level: 'error',
          message: `Unhandled error: ${message}${where}`,
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      dispatch({
        type: 'ADD_DEBUG_LOG',
        payload: {
          scope: 'frontend',
          level: 'error',
          message: `Unhandled promise rejection: ${reason}`,
        },
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [dispatch]);

  const hasResults = Object.keys(parsedData).length > 0 && !isLoading;
  const hasComparisonResults = comparison.before && comparison.after && comparison.result;

  const handleBackFromComparison = useCallback(() => {
    resetComparison();
    setMode('single');
  }, [resetComparison, setMode]);

  // Loading fallback
  const LoadingFallback = (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)]">
      <Header />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center py-20">
          <PacmanLoader />
          <p className="text-lg text-[var(--text-primary)] mt-6">Loading...</p>
        </div>
      </main>
    </div>
  );

  const InlineLoadingFallback = (
    <main className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center justify-center py-20">
        <PacmanLoader />
        <p className="text-lg text-[var(--text-primary)] mt-6">Loading...</p>
      </div>
    </main>
  );

  // Determine current view
  let viewKey: string;
  let viewContent: React.ReactNode;

  if (isDetecting) {
    viewKey = 'detecting';
    viewContent = LoadingFallback;
  } else if (mode === 'comparison' && hasComparisonResults) {
    viewKey = 'comparison-results';
    viewContent = (
      <Suspense fallback={InlineLoadingFallback}>
        <ComparisonResultsView onBack={handleBackFromComparison} />
      </Suspense>
    );
  } else if (mode === 'comparison') {
    viewKey = 'comparison-upload';
    viewContent = (
      <div className="min-h-screen flex flex-col bg-[var(--bg-app)]">
        <Header showBackButton onBack={handleBackFromComparison} />
        <main className="flex-1 flex items-center justify-center">
          <Suspense fallback={null}>
            <ComparisonUpload />
          </Suspense>
        </main>
        <Footer />
      </div>
    );
  } else if (!hasResults) {
    viewKey = 'landing';
    viewContent = (
      <div className="min-h-screen flex flex-col bg-[var(--bg-app)]">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <PacmanLoader />
              <p className="text-lg text-[var(--text-primary)] mt-6">
                Loading live diagnostics...
              </p>
            </div>
          ) : null}
        </main>
        <Footer />
        {error && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-4 card-alert-critical rounded-lg max-w-2xl mx-auto">
            {error}
          </div>
        )}
      </div>
    );
  } else {
    // Main results view — new sidebar-based layout
    viewKey = 'results';
    viewContent = (
      <AppShell onOpenPalette={() => setPaletteOpen(true)} onRefreshCache={handleRefreshCache} sqliteFallback={sqliteFallback}>
        <PageRouter />
      </AppShell>
    );
  }

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={viewKey}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={pageTransition}
        >
          {viewContent}
        </motion.div>
      </AnimatePresence>

      {/* Command Palette — always mounted, shown on Cmd+K */}
      {hasResults && (
        <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
      )}
    </>
  );
}

function App() {
  return (
    <DiagProvider>
      <AppGate>
        {({ isSqliteFallback }) => (
          <ErrorBoundary>
            <AppContent sqliteFallback={isSqliteFallback} />
          </ErrorBoundary>
        )}
      </AppGate>
      <DebugPanel />
    </DiagProvider>
  );
}

export default App;
