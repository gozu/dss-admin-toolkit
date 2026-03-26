import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';

interface SectionInfo {
  label: string;
  firstPage: PageId;
}

const PAGE_SECTION_MAP: Record<PageId, SectionInfo> = {
  summary: { label: 'Overview', firstPage: 'summary' },
  issues: { label: 'Overview', firstPage: 'summary' },
  filesystem: { label: 'System', firstPage: 'filesystem' },
  memory: { label: 'System', firstPage: 'filesystem' },
  connections: { label: 'Monitoring', firstPage: 'connections' },
  'runtime-config': { label: 'Monitoring', firstPage: 'connections' },
  logs: { label: 'Monitoring', firstPage: 'connections' },
  plugins: { label: 'Monitoring', firstPage: 'connections' },
  projects: { label: 'Projects', firstPage: 'projects' },
  'project-cleaner': { label: 'Projects', firstPage: 'projects' },
  'code-envs': { label: 'Code Environments', firstPage: 'code-envs' },
  'code-envs-comparison': { label: 'Code Environments', firstPage: 'code-envs' },
  'code-env-cleaner': { label: 'Code Environments', firstPage: 'code-envs' },
  outreach: { label: 'Tools', firstPage: 'outreach' },
  tracking: { label: 'Tools', firstPage: 'outreach' },
  directory: { label: 'Tools', firstPage: 'outreach' },
  'db-health': { label: 'Tools', firstPage: 'outreach' },
  report: { label: 'Tools', firstPage: 'outreach' },
  trends: { label: 'Trends', firstPage: 'trends' },
};

const PAGE_LABELS: Record<PageId, string> = {
  summary: 'Summary',
  issues: 'Issues',
  filesystem: 'Filesystem',
  memory: 'Memory',
  directory: 'Dir Usage',
  projects: 'Projects',
  'code-envs': 'Insights',
  'code-envs-comparison': 'Comparison',
  connections: 'Connections',
  'runtime-config': 'Runtime',
  logs: 'Errors',
  outreach: 'Outreach',
  'code-env-cleaner': 'CodEnv Cleaner',
  'project-cleaner': 'Project Cleaner',
  plugins: 'Plugin Sync',
  tracking: 'Compliance',
  report: 'Report',
  'db-health': 'DB Health',
  trends: 'Trends',
};

export function Breadcrumb() {
  const { state, setActivePage } = useDiag();
  const { activePage } = state;

  const section = PAGE_SECTION_MAP[activePage];
  const pageLabel = PAGE_LABELS[activePage];

  if (!section) return null;

  const isSectionSamePage = section.firstPage === activePage;

  return (
    <nav className="flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
      <button
        type="button"
        onClick={() => setActivePage(section.firstPage)}
        className={`transition-colors ${
          isSectionSamePage
            ? 'text-[var(--text-primary)] cursor-default'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        {section.label}
      </button>
      {!isSectionSamePage && (
        <>
          <span className="text-[var(--text-tertiary)]" aria-hidden="true">
            ›
          </span>
          <span className="text-[var(--text-primary)]">{pageLabel}</span>
        </>
      )}
    </nav>
  );
}
