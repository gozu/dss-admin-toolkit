import { lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';

// Lazy-load all page components
const SummaryPage = lazy(() =>
  import('../pages/SummaryPage').then((m) => ({ default: m.SummaryPage })),
);
const IssuesPage = lazy(() =>
  import('../pages/IssuesPage').then((m) => ({ default: m.IssuesPage })),
);
const FilesystemPage = lazy(() =>
  import('../pages/FilesystemPage').then((m) => ({ default: m.FilesystemPage })),
);
const MemoryPage = lazy(() =>
  import('../pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
);
const DirectoryPage = lazy(() =>
  import('../pages/DirectoryPage').then((m) => ({ default: m.DirectoryPage })),
);
const ProjectsPage = lazy(() =>
  import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const CodeEnvsPage = lazy(() =>
  import('../pages/CodeEnvsPage').then((m) => ({ default: m.CodeEnvsPage })),
);
const ConnectionsPage = lazy(() =>
  import('../pages/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })),
);
const RuntimeConfigPage = lazy(() =>
  import('../pages/RuntimeConfigPage').then((m) => ({ default: m.RuntimeConfigPage })),
);
const SecurityConfigPage = lazy(() =>
  import('../pages/SecurityConfigPage').then((m) => ({ default: m.SecurityConfigPage })),
);
const PlatformConfigPage = lazy(() =>
  import('../pages/PlatformConfigPage').then((m) => ({ default: m.PlatformConfigPage })),
);
const LogsPage = lazy(() =>
  import('../pages/LogsPage').then((m) => ({ default: m.LogsPage })),
);

// Lazy-load tools and settings views
const ToolsView = lazy(() => import('../ToolsView').then((m) => ({ default: m.ToolsView })));
const TrackingView = lazy(() =>
  import('../TrackingView').then((m) => ({ default: m.TrackingView })),
);
const SettingsView = lazy(() =>
  import('../SettingsView').then((m) => ({ default: m.SettingsView })),
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

function renderPage(activePage: PageId, onBackToSummary: () => void): React.ReactNode {
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
      return <CodeEnvsPage />;
    case 'connections':
      return <ConnectionsPage />;
    case 'runtime-config':
      return <RuntimeConfigPage />;
    case 'security-config':
      return <SecurityConfigPage />;
    case 'platform-config':
      return <PlatformConfigPage />;
    case 'logs':
      return <LogsPage />;
    case 'outreach':
    case 'cleaners':
    case 'plugins':
      return <ToolsView />;
    case 'tracking':
      return <TrackingView />;
    case 'settings':
      return <SettingsView onBack={onBackToSummary} />;
    default:
      return <SummaryPage />;
  }
}

export function PageRouter() {
  const { state, setActivePage } = useDiag();
  const { activePage } = state;

  const handleBackToSummary = () => {
    setActivePage('summary');
  };

  return (
    <Suspense fallback={<LoadingSpinner />}>
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
          {renderPage(activePage, handleBackToSummary)}
        </motion.div>
      </AnimatePresence>
    </Suspense>
  );
}
