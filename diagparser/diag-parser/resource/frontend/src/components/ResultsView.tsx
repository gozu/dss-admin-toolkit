import { useCallback, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import {
  Header,
  Container,
  InfoPanel,
  DataTable,
  FilterBar,
  CardGrid,
  ProjectsTable,
  PluginsTable,
  CodeEnvsTable,
  ClustersTable,
  FilesystemChart,
  ConnectionsChart,
  MemoryChart,
  MemoryAnalysisCard,
  FileViewer,
  ProjectPermissionsModal,
  FileDownloadButtons,
  LogErrorsSection,
  DisabledFeaturesTable,
  AlertBanner,
  PerformanceMetrics,
  HealthScoreCard,
  DirTreeSection,
} from './index';
import { useTableFilter, useExportLiteZip, useModal, useIssueDetection, useHealthScore } from '../hooks';
import type { Project } from '../types';

interface ResultsViewProps {
  onBack: () => void;
}

export function ResultsView({ onBack }: ResultsViewProps) {
  const { state } = useDiag();
  const { parsedData, diagType, originalFile } = state;
  const { isVisible } = useTableFilter();
  const { exportLiteZip } = useExportLiteZip();

  // Modal state
  const fileViewerModal = useModal();
  const permissionsModal = useModal();

  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);

  // Detect issues in parsed data
  const { issues, criticalCount, warningCount } = useIssueDetection(parsedData);

  // Calculate health score
  const healthScore = useHealthScore(parsedData);

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

  // Project permissions handler
  const handleViewPermissions = useCallback((project: Project) => {
    setViewingProject(project);
    permissionsModal.open();
  }, [permissionsModal]);

  // Scroll to element handler
  const scrollToElement = useCallback((elementId: string) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-void)]">
      <Header
        showBackButton
        showExportButton
        onBack={onBack}
        onExport={exportLiteZip}
        diagType={diagType}
      />

      {/* Alert Banner - Shows detected issues */}
      <AlertBanner
        issues={issues}
        criticalCount={criticalCount}
        warningCount={warningCount}
        onScrollTo={scrollToElement}
      />

      {/* Main Content */}
      <main className="flex-1 py-4">
        <Container>
          {/* Health Score Dashboard */}
          <HealthScoreCard healthScore={healthScore} />

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
          <CardGrid>
            {/* Issues Section - Critical items first */}
            <DisabledFeaturesTable />

            {/* Projects (2/3) + Connections Chart (1/3) side by side */}
            <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <ProjectsTable onViewPermissions={handleViewPermissions} />
              </div>
              <ConnectionsChart />
            </div>

            {/* Filesystem (2/3) + Memory Chart (1/3) */}
            <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2"><FilesystemChart /></div>
              <MemoryChart />
            </div>

            {/* Directory Space Usage - Async loading with progress */}
            {originalFile && (
              <DirTreeSection file={originalFile} />
            )}

            {/* All DataTables in 3-column grid */}
            <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    title="CGroups Configuration"
                    data={parsedData.cgroupSettings as Record<string, string | number>}
                  />
                )}

              {isVisible('proxySettings-table') &&
                parsedData.proxySettings &&
                Object.keys(parsedData.proxySettings).length > 0 && (
                  <DataTable
                    id="proxySettings-table"
                    title="Proxy Configuration"
                    data={parsedData.proxySettings as Record<string, string>}
                  />
                )}

              {isVisible('licenseProperties-table') &&
                parsedData.licenseProperties &&
                Object.keys(parsedData.licenseProperties).length > 0 && (
                  <DataTable
                    id="licenseProperties-table"
                    title="License Properties"
                    data={parsedData.licenseProperties as Record<string, string>}
                  />
                )}

              {/* Plugins and Code Environments in the same 3-column grid */}
              <PluginsTable />
              <CodeEnvsTable />
            </div>

            {/* Full-width Kubernetes table */}
            <ClustersTable />

            {/* Log Errors - Last */}
            <LogErrorsSection />
          </CardGrid>

          {/* Performance Metrics */}
          <PerformanceMetrics />
        </Container>
      </main>

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
