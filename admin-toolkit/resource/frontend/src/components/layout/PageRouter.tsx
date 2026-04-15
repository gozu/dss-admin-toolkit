import { lazy, Suspense, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';

// Eagerly import lightweight page components to avoid Suspense/AnimatePresence conflicts
import { SummaryPage } from '../pages/SummaryPage';
import { IssuesPage } from '../pages/IssuesPage';
import { FilesystemPage } from '../pages/FilesystemPage';
import { MemoryPage } from '../pages/MemoryPage';
import { DirectoryPage } from '../pages/DirectoryPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { CodeEnvsInsightsPage } from '../pages/CodeEnvsPage';
import { CodeEnvsComparisonPage } from '../pages/CodeEnvsComparisonPage';
import { ConnectionsPage } from '../pages/ConnectionsPage';
import { RuntimeConfigPage } from '../pages/RuntimeConfigPage';
import { LogsPage } from '../pages/LogsPage';

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
const EcrImageCleanerLazy = lazy(() =>
  import('../EcrImageCleaner').then((m) => ({ default: m.EcrImageCleaner })),
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
    case 'code-env-cleaner':
      return <CodeEnvCleanerLazy />;
    case 'ecr-image-cleaner':
      return <EcrImageCleanerLazy />;
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
    default:
      return <SummaryPage />;
  }
}

export function PageRouter() {
  const { state, addDebugLog } = useDiag();
  const { activePage } = state;
  const prevPageRef = useRef(activePage);

  useEffect(() => {
    if (prevPageRef.current !== activePage) {
      addDebugLog(`Page rendered: ${activePage} (prev: ${prevPageRef.current})`, 'navigation');
      prevPageRef.current = activePage;
    }
  }, [activePage, addDebugLog]);

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
          {renderPage(activePage)}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}
