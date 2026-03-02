import { useCallback, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import {
  Header,
  Footer,
  Container,
  InfoPanel,
  DataTable,
  FilterBar,
  CardGrid,
  ProjectsTable,
  ProjectFootprintTable,
  PluginsTable,
  CodeEnvsTable,
  FilesystemChart,
  ConnectionsChart,
  MemoryChart,
  MemoryAnalysisCard,
  FileViewer,
  ProjectPermissionsModal,
  FileDownloadButtons,
  LogErrorsSection,
  DisabledFeaturesTable,

  PerformanceMetrics,
  HealthScoreCard,
  ApiDirTreeSection,
} from './index';
import { useTableFilter, useModal, useHealthScore, useUltraWideLayout } from '../hooks';

import type { Project } from '../types';
import {
  DEFAULT_HEALTH_FACTOR_TOGGLES,
  type HealthFactorKey,
  type HealthFactorToggles,
} from '../hooks/useHealthScore';

interface ResultsViewProps {
  onBack: () => void;
  onOpenTools?: () => void;
  onOpenSettings?: () => void;
}

export function ResultsView({ onBack, onOpenTools, onOpenSettings }: ResultsViewProps) {
  const { state, setMode } = useDiag();
  const { parsedData, diagType } = state;
  const { isVisible } = useTableFilter();
  const { ultraWideEnabled } = useUltraWideLayout();
  const hasProjects = (parsedData.projects?.length || 0) > 0;

  // Modal state
  const fileViewerModal = useModal();
  const permissionsModal = useModal();

  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [healthFactorToggles, setHealthFactorToggles] = useState<HealthFactorToggles>(
    DEFAULT_HEALTH_FACTOR_TOGGLES
  );

  // Calculate health score
  const healthScore = useHealthScore(parsedData, healthFactorToggles);

  const toggleHealthFactor = useCallback((key: HealthFactorKey) => {
    setHealthFactorToggles((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // File view/download handlers
  const handleViewFile = useCallback((filename: string, content: string) => {
    setViewingFile({ name: filename, content });
    fileViewerModal.open();
  }, [fileViewerModal]);

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

  const handleSaveSnapshot = useCallback(() => {
    const timestamp = new Date().toISOString();
    const metadata = {
      timestamp,
      dssVersion: parsedData.dssVersion,
      instanceUrl: parsedData.instanceInfo?.instanceUrl,
      diagType,
    };
    const snapshot = {
      version: 1,
      metadata,
      parsedData,
    };
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const filename = `diag-snapshot-${safeTimestamp}.json`;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [diagType, parsedData]);

  // Project permissions handler
  const handleViewPermissions = useCallback((project: Project) => {
    setViewingProject(project);
    permissionsModal.open();
  }, [permissionsModal]);

  // Action buttons for Header
  const actionButtons = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleSaveSnapshot}
        className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-glass)] hover:text-[var(--neon-cyan)] transition-all duration-150 flex items-center gap-1.5"
        title="Save report"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 3v4H7M7 17h10M7 13h10" />
        </svg>
        <span className="text-sm whitespace-nowrap">Save report</span>
      </button>
      <button
        onClick={() => setMode('comparison')}
        className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-glass)] hover:text-[var(--neon-cyan)] transition-all duration-150 flex items-center gap-1.5"
        title="Compare Snapshots"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        <span className="hidden md:inline text-sm">Compare</span>
      </button>
      {onOpenTools && (
        <button
          onClick={onOpenTools}
          className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-glass)] hover:text-[var(--neon-cyan)] transition-all duration-150 flex items-center gap-1.5"
          title="Tools"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="hidden md:inline text-sm">Tools</span>
        </button>
      )}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="px-3 py-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-glass)] hover:text-[var(--neon-cyan)] transition-all duration-150 flex items-center gap-1.5"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span className="hidden md:inline text-sm">Settings</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
      <Header
        onBack={onBack}
        diagType={diagType}
        rightActions={actionButtons}
      />

      {/* Main Content */}
      <main className="flex-1 py-4">
        <Container ultraWide={ultraWideEnabled}>
          {/* Health Score Dashboard */}
          <HealthScoreCard
            healthScore={healthScore}
            healthFactorToggles={healthFactorToggles}
            onToggleHealthFactor={toggleHealthFactor}
          />

          {/* System Overview */}
          <InfoPanel />

          {/* Key Files */}
          <FileDownloadButtons
            onViewFile={handleViewFile}
            onDownloadFile={handleDownloadFile}
          />

          {/* Filter Bar */}
          <FilterBar />

          {/* Content Grid */}
          <CardGrid ultraWide={ultraWideEnabled}>
            {/* Issues Section - Critical items first */}
            <DisabledFeaturesTable />

            {/* Projects */}
            {hasProjects && (
              <div className="col-span-full">
                <ProjectsTable onViewPermissions={handleViewPermissions} />
              </div>
            )}

            {/* Code Envs (2/3) + Connection Types (1/3) */}
            <div className={`col-span-full grid grid-cols-1 md:grid-cols-3 gap-4 ${ultraWideEnabled ? 'xl:grid-cols-4' : ''}`}>
              <CodeEnvsTable />
              <ConnectionsChart />
            </div>

            {/* Project Footprint + Code Env Pressure */}
            <ProjectFootprintTable />

            {/* Filesystem (2/3) + Memory Chart (1/3) */}
            <div className={`col-span-full grid grid-cols-1 md:grid-cols-3 gap-4 ${ultraWideEnabled ? 'xl:grid-cols-4' : ''}`}>
              <div className={ultraWideEnabled ? 'md:col-span-2 xl:col-span-3' : 'md:col-span-2'}><FilesystemChart /></div>
              <MemoryChart />
            </div>

            {/* Directory Space Usage - Async loading with progress */}
            <ApiDirTreeSection />

            {/* All DataTables in 3-column grid */}
            <div className={`col-span-full grid grid-cols-1 md:grid-cols-3 gap-4 ${ultraWideEnabled ? 'xl:grid-cols-4' : ''}`}>
              <MemoryAnalysisCard />
              {isVisible('userStats-table') &&
                parsedData.userStats &&
                Object.keys(parsedData.userStats).length > 0 && (
                  <DataTable
                    id="userStats-table"
                    title="User Statistics"
                    data={parsedData.userStats as Record<string, string | number>}
                    sortNumeric
                  />
                )}

              {isVisible('systemLimits-table') &&
                parsedData.systemLimits &&
                Object.keys(parsedData.systemLimits).length > 0 && (
                  <DataTable
                    id="systemLimits-table"
                    title="System Limits"
                    data={parsedData.systemLimits}
                  />
                )}

              {isVisible('usersByProjects-table') &&
                parsedData.usersByProjects &&
                Object.keys(parsedData.usersByProjects).length > 0 && (
                  <DataTable
                    id="usersByProjects-table"
                    title="Number of Projects per User"
                    data={parsedData.usersByProjects as Record<string, string>}
                  />
                )}

              {isVisible('javaMemoryLimits-table') &&
                parsedData.javaMemoryLimits &&
                Object.keys(parsedData.javaMemoryLimits).length > 0 && (
                  <DataTable
                    id="javaMemoryLimits-table"
                    title="Java Memory Settings"
                    data={parsedData.javaMemoryLimits}
                  />
                )}

              {isVisible('enabledSettings-table') &&
                parsedData.enabledSettings &&
                Object.keys(parsedData.enabledSettings).length > 0 && (
                  <DataTable
                    id="enabledSettings-table"
                    title="Enabled Settings"
                    data={parsedData.enabledSettings as Record<string, string | boolean>}
                  />
                )}

              {isVisible('sparkSettings-table') &&
                parsedData.sparkSettings &&
                Object.keys(parsedData.sparkSettings).length > 0 && (
                  <DataTable
                    id="sparkSettings-table"
                    title="Spark Settings"
                    data={parsedData.sparkSettings as Record<string, string | number | boolean>}
                  />
                )}

              {isVisible('maxRunningActivities-table') &&
                parsedData.maxRunningActivities &&
                Object.keys(parsedData.maxRunningActivities).length > 0 && (
                  <DataTable
                    id="maxRunningActivities-table"
                    title="Max Running Activities"
                    data={parsedData.maxRunningActivities as Record<string, string | number>}
                  />
                )}

              {isVisible('authSettings-table') &&
                parsedData.authSettings &&
                Object.keys(parsedData.authSettings).length > 0 && (
                  <DataTable
                    id="authSettings-table"
                    title="Authentication Settings"
                    data={parsedData.authSettings as Record<string, string>}
                  />
                )}

              {isVisible('containerSettings-table') &&
                parsedData.containerSettings &&
                Object.keys(parsedData.containerSettings).length > 0 && (
                  <DataTable
                    id="containerSettings-table"
                    title="Container Settings"
                    data={parsedData.containerSettings as Record<string, string | number>}
                  />
                )}

              {isVisible('integrationSettings-table') &&
                parsedData.integrationSettings &&
                Object.keys(parsedData.integrationSettings).length > 0 && (
                  <DataTable
                    id="integrationSettings-table"
                    title="Integration Settings"
                    data={parsedData.integrationSettings as Record<string, string | boolean>}
                  />
                )}

              {isVisible('resourceLimits-table') &&
                parsedData.resourceLimits &&
                Object.keys(parsedData.resourceLimits).length > 0 && (
                  <DataTable
                    id="resourceLimits-table"
                    title="Resource Limits"
                    data={parsedData.resourceLimits as Record<string, string | number>}
                  />
                )}

              {isVisible('cgroupSettings-table') &&
                parsedData.cgroupSettings &&
                Object.keys(parsedData.cgroupSettings).length > 0 && (
                  <DataTable
                    id="cgroupSettings-table"
                    title="CGroups Config"
                    data={parsedData.cgroupSettings as Record<string, string | number>}
                  />
                )}

              {isVisible('proxySettings-table') &&
                parsedData.proxySettings &&
                Object.keys(parsedData.proxySettings).length > 0 && (
                  <DataTable
                    id="proxySettings-table"
                    title="Proxy Config"
                    data={parsedData.proxySettings as Record<string, string>}
                  />
                )}

              {/* Plugins */}
              <PluginsTable />
            </div>

            {/* Log Errors - Last */}
            <LogErrorsSection />
          </CardGrid>

          {/* Performance Metrics */}
          <PerformanceMetrics />
        </Container>
      </main>
      <Footer />

      {/* File Viewer Modal */}
      <FileViewer
        isOpen={fileViewerModal.isOpen}
        onClose={fileViewerModal.close}
        filename={viewingFile?.name || ''}
        content={viewingFile?.content || ''}
        onDownload={handleDownloadFile}
      />

      {/* Project Permissions Modal */}
      <ProjectPermissionsModal
        isOpen={permissionsModal.isOpen}
        onClose={permissionsModal.close}
        project={viewingProject}
      />
    </div>
  );
}
