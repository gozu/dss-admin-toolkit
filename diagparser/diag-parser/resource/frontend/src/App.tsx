import { lazy, Suspense, useCallback } from 'react';
import { DiagProvider, useDiag } from './context/DiagContext';
import {
  FileUpload,
  Header,
  PacmanLoader,
  LandingPage,
} from './components';

// Lazy load the results view (includes charts and all heavy components)
const ResultsView = lazy(() => import('./components/ResultsView').then(m => ({ default: m.ResultsView })));

// Lazy load comparison components
const ComparisonUpload = lazy(() => import('./components/comparison/ComparisonUpload').then(m => ({ default: m.ComparisonUpload })));
const ComparisonResultsView = lazy(() => import('./components/comparison/ComparisonResultsView').then(m => ({ default: m.ComparisonResultsView })));

function AppContent() {
  const { state, reset, setMode } = useDiag();
  const { parsedData, isLoading, error, mode, comparison } = state;

  const hasResults = Object.keys(parsedData).length > 0 && !isLoading;
  const hasComparisonResults = comparison.before && comparison.after && comparison.result;

  // Back button handler - returns to landing page
  const handleBack = useCallback(() => {
    reset();
  }, [reset]);

  // Back from single upload to landing
  const handleBackToLanding = useCallback(() => {
    setMode('landing');
  }, [setMode]);

  // Loading fallback component
  const LoadingFallback = (
    <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
      <Header />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center py-20">
          <PacmanLoader />
          <p className="text-lg text-[var(--text-primary)] mt-6">Loading...</p>
        </div>
      </main>
    </div>
  );

  // Landing page - mode selection
  if (mode === 'landing') {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <LandingPage />
        </main>
        <Footer />
      </div>
    );
  }

  // Comparison mode
  if (mode === 'comparison') {
    // Show comparison results if we have them
    if (hasComparisonResults) {
      return (
        <Suspense fallback={LoadingFallback}>
          <ComparisonResultsView onBack={handleBack} />
        </Suspense>
      );
    }

    // Show comparison upload UI
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
        <Header showBackButton onBack={handleBackToLanding} />
        <main className="flex-1 flex items-center justify-center">
          <Suspense fallback={null}>
            <ComparisonUpload />
          </Suspense>
        </main>
        <Footer />
      </div>
    );
  }

  // Single mode - show upload or results
  if (!hasResults) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
        <Header showBackButton onBack={handleBackToLanding} />
        <main className="flex-1 flex items-center justify-center">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <PacmanLoader />
              <p className="text-lg text-[var(--text-primary)] mt-6">Processing diagnostic file...</p>
            </div>
          ) : (
            <FileUpload />
          )}
        </main>
        <Footer />
        {error && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-4 card-alert-critical rounded-lg max-w-2xl mx-auto">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Show results with lazy-loaded ResultsView
  return (
    <Suspense fallback={LoadingFallback}>
      <ResultsView onBack={handleBack} />
    </Suspense>
  );
}

// Footer component extracted for reuse
function Footer() {
  return (
    <footer className="py-4 text-center text-sm text-[var(--text-muted)]">
      <div className="flex items-center justify-center gap-3 mb-1">
        <span className="text-xs">by Alex Kaos</span>
        <a
          href="mailto:alex.kaos@dataiku.com?subject=DiagParser Feedback"
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--neon-cyan)] hover:bg-[var(--bg-glass)] transition-all duration-150"
          aria-label="Send feedback via email"
          title="Send feedback via email"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </a>
        <a
          href="https://dataiku.enterprise.slack.com/archives/C08QQHCP4MD"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--neon-cyan)] hover:bg-[var(--bg-glass)] transition-all duration-150"
          aria-label="Send feedback via Slack"
          title="Send feedback via Slack"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
        </a>
      </div>
      <div>v{__APP_VERSION__}</div>
    </footer>
  );
}

function App() {
  return (
    <DiagProvider>
      <AppContent />
    </DiagProvider>
  );
}

export default App;
