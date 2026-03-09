import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';

interface SectionInfo {
  label: string;
  firstPage: PageId;
}

const PAGE_SECTION_MAP: Record<PageId, SectionInfo> = {
  summary: { label: 'Overview', firstPage: 'summary' },
  issues: { label: 'Overview', firstPage: 'summary' },
  filesystem: { label: 'Infrastructure', firstPage: 'filesystem' },
  memory: { label: 'Infrastructure', firstPage: 'filesystem' },
  directory: { label: 'Infrastructure', firstPage: 'filesystem' },
  projects: { label: 'Insights', firstPage: 'projects' },
  'code-envs': { label: 'Insights', firstPage: 'projects' },
  connections: { label: 'Insights', firstPage: 'projects' },
  'runtime-config': { label: 'Configuration', firstPage: 'runtime-config' },
  logs: { label: 'Logs', firstPage: 'logs' },
  outreach: { label: 'Tools', firstPage: 'outreach' },
  'code-env-cleaner': { label: 'Tools', firstPage: 'outreach' },
  'project-cleaner': { label: 'Tools', firstPage: 'outreach' },
  plugins: { label: 'Tools', firstPage: 'outreach' },
  tracking: { label: 'Tools', firstPage: 'outreach' },
  settings: { label: 'Settings', firstPage: 'settings' },
};

const PAGE_LABELS: Record<PageId, string> = {
  summary: 'Summary',
  issues: 'Issues',
  filesystem: 'Filesystem',
  memory: 'Memory',
  directory: 'Dir Usage',
  projects: 'Projects',
  'code-envs': 'Code Envs',
  connections: 'Connections',
  'runtime-config': 'Runtime',
  logs: 'Errors',
  outreach: 'Outreach',
  'code-env-cleaner': 'CodEnv Cleaner',
  'project-cleaner': 'Project Cleaner',
  plugins: 'Plugin Sync',
  tracking: 'Compliance',
  settings: 'Settings',
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
