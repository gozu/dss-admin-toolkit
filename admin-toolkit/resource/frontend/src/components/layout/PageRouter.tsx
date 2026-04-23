import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';
import { loadFromStorage } from '../../utils/storage';
import { SHOW_EXPERIMENTAL_STORAGE_KEY } from '../pages/SettingsPage';

const EXPERIMENTAL_PAGES: ReadonlySet<PageId> = new Set<PageId>([
  'outreach',
  'tracking',
  'image-cleaner',
  'llm-audit',
]);

function ExperimentalNotice() {
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <div className="glass-card max-w-md p-6 text-center space-y-2">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          This feature is experimental
        </h3>
        <p className="text-sm text-[var(--text-muted)]">
          Enable experimental features in <strong>Tools &gt; Settings</strong> to access this page.
        </p>
      </div>
    </div>
  );
}

// Eagerly import lightweight page components to avoid Suspense/AnimatePresence conflicts
import { SummaryPage } from '../pages/SummaryPage';
import { IssuesPage } from '../pages/IssuesPage';
import { FilesystemPage } from '../pages/FilesystemPage';
import { MemoryPage } from '../pages/MemoryPage';
import { DirectoryPage } from '../pages/DirectoryPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ProjectComputePage } from '../pages/ProjectComputePage';
import { CodeEnvsInsightsPage } from '../pages/CodeEnvsPage';
import { CodeEnvsComparisonPage } from '../pages/CodeEnvsComparisonPage';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { RuntimeConfigPage } from '../pages/RuntimeConfigPage';
import { LogsPage } from '../pages/LogsPage';
import { SanityCheckPage } from '../pages/SanityCheckPage';
import { SettingsPage } from '../pages/SettingsPage';

// Lazy-load only the heavy views
const ToolsView = lazy(() => import('../ToolsView').then((m) => ({ default: m.ToolsView })));
const TrackingView = lazy(() =>
  import('../TrackingView').then((m) => ({ default: m.TrackingView })),
);
const CodeEnvCleanerLazy = lazy(() =>
  import('../CodeEnvCleaner').then((m) => ({ default: m.CodeEnvCleaner })),
);
const ReportPage = lazy(() =>
  import('../pages/ReportPage').then((m) => ({ default: m.ReportPage })),
);
const DbHealthPage = lazy(() =>
  import('../pages/DbHealthPage').then((m) => ({ default: m.DbHealthPage })),
);
const ImageCleanerLazy = lazy(() =>
  import('../ImageCleaner').then((m) => ({ default: m.ImageCleaner })),
);
const TrendsPage = lazy(() =>
  import('../pages/TrendsPage').then((m) => ({ default: m.TrendsPage })),
);
const LlmAuditPage = lazy(() =>
  import('../pages/LlmAuditPage').then((m) => ({ default: m.LlmAuditPage })),
);

function LoadingSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const crossfadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const crossfadeTransition = {
  duration: 0.15,
  ease: 'easeInOut' as const,
};

function renderPage(activePage: PageId): React.ReactNode {
  switch (activePage) {
    case 'summary':
      return <SummaryPage />;
    case 'issues':
      return <IssuesPage />;
    case 'filesystem':
      return <FilesystemPage />;
    case 'memory':
      return <MemoryPage />;
    case 'directory':
      return <DirectoryPage />;
    case 'projects':
      return <ProjectsPage />;
    case 'project-compute':
      return <ProjectComputePage />;
    case 'code-envs':
      return <CodeEnvsInsightsPage />;
    case 'code-envs-comparison':
      return <CodeEnvsComparisonPage />;
    case 'connections':
      return <ConnectionsPage />;
    case 'runtime-config':
      return <RuntimeConfigPage />;
    case 'logs':
      return <LogsPage />;
    case 'sanity-check':
      return <SanityCheckPage />;
    case 'code-env-cleaner':
      return <CodeEnvCleanerLazy />;
    case 'image-cleaner':
      return <ImageCleanerLazy />;
    case 'outreach':
    case 'project-cleaner':
    case 'plugins':
      return <ToolsView />;
    case 'tracking':
      return <TrackingView />;
    case 'report':
      return <ReportPage />;
    case 'db-health':
      return <DbHealthPage />;
    case 'trends':
      return <TrendsPage />;
    case 'llm-audit':
      return <LlmAuditPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <SummaryPage />;
  }
}

export function PageRouter() {
  const { state, addDebugLog } = useDiag();
  const { activePage } = state;
  const prevPageRef = useRef(activePage);

  const [showExperimental, setShowExperimental] = useState<boolean>(() =>
    loadFromStorage<boolean>(SHOW_EXPERIMENTAL_STORAGE_KEY, false),
  );

  useEffect(() => {
    const sync = () => {
      setShowExperimental(loadFromStorage<boolean>(SHOW_EXPERIMENTAL_STORAGE_KEY, false));
    };
    window.addEventListener('experimental-flag-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('experimental-flag-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (prevPageRef.current !== activePage) {
      addDebugLog(`Page rendered: ${activePage} (prev: ${prevPageRef.current})`, 'navigation');
      prevPageRef.current = activePage;
    }
  }, [activePage, addDebugLog]);

  const isBlockedExperimental = !showExperimental && EXPERIMENTAL_PAGES.has(activePage);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activePage}
        variants={crossfadeVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={crossfadeTransition}
        className="flex-1 flex flex-col"
      >
        <Suspense fallback={<LoadingSpinner />}>
          {isBlockedExperimental ? <ExperimentalNotice /> : renderPage(activePage)}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}
