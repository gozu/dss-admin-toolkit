import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useDiag } from '../../context/DiagContext';
import type { PageId } from '../../types';
import type { ReactNode } from 'react';
import { getPageAvailability, type PageAvailability } from '../../utils/pageAvailability';

/* ------------------------------------------------------------------ */
/*  Icons (20x20, viewBox 0 0 24 24, stroke=currentColor, sw=1.5)    */
/* ------------------------------------------------------------------ */

const icons: Record<string, ReactNode> = {
  summary: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  issues: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  filesystem: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="18" r="1" />
    </svg>
  ),
  memory: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="16" rx="1" />
      <path d="M9 4V2M15 4V2M9 20v2M15 20v2M5 8H3M5 12H3M5 16H3M19 8h2M19 12h2M19 16h2" />
      <rect x="8" y="7" width="8" height="4" rx="0.5" />
    </svg>
  ),
  directory: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  ),
  projects: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  'code-envs': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  'code-envs-comparison': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  connections: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  'runtime-config': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  outreach: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  'code-env-cleaner': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  'project-cleaner': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  ),
  plugins: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  tracking: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  report: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/*  Nav structure                                                      */
/* ------------------------------------------------------------------ */

interface NavItem {
  id: PageId;
  label: string;
  badge?: 'issues' | 'logs';
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'OVERVIEW',
    items: [
      { id: 'summary', label: 'Summary' },
      { id: 'issues', label: 'Issues', badge: 'issues' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { id: 'filesystem', label: 'Filesystem' },
      { id: 'memory', label: 'Memory' },
    ],
  },
  {
    title: 'MONITORING',
    items: [
      { id: 'connections', label: 'Connections' },
      { id: 'runtime-config', label: 'Runtime' },
      { id: 'logs', label: 'Errors', badge: 'logs' },
      { id: 'plugins', label: 'Plugin Sync' },
    ],
  },
  {
    title: 'PROJECTS',
    items: [
      { id: 'project-cleaner', label: 'Cleaner' },
      { id: 'projects', label: 'Insights' },
    ],
  },
  {
    title: 'CODE ENVIRONMENTS',
    items: [
      { id: 'code-env-cleaner', label: 'Cleaner' },
      { id: 'code-envs', label: 'Insights' },
      { id: 'code-envs-comparison', label: 'Comparison' },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { id: 'outreach', label: 'Outreach' },
      { id: 'tracking', label: 'Compliance' },
      { id: 'directory', label: 'Dir Usage' },
      { id: 'report', label: 'Report' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRefreshCache?: () => Promise<void>;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { state, setActivePage, addDebugLog } = useDiag();
  const { activePage, parsedData } = state;
  const dataReady = !!parsedData.dataReady;

  const [statusPhase, setStatusPhase] = useState<'loading' | 'complete' | 'refresh'>(
    dataReady ? 'refresh' : 'loading',
  );

  useEffect(() => {
    if (!dataReady) {
      setStatusPhase('loading');
      return;
    }
    setStatusPhase('complete');
    const timer = setTimeout(() => setStatusPhase('refresh'), 2500);
    return () => clearTimeout(timer);
  }, [dataReady]);

  const handleRefresh = async () => {
    try {
      await fetch('/api/cache/clear', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    window.location.reload();
  };

  // Track previous availability to detect loading → ready transitions
  const prevAvailRef = useRef<Partial<Record<PageId, PageAvailability>>>({});
  const [lightUpPages, setLightUpPages] = useState<Set<PageId>>(new Set());

  useEffect(() => {
    const prev = prevAvailRef.current;
    const newlyReady: PageId[] = [];
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const avail = getPageAvailability(parsedData, item.id);
        if ((prev[item.id] === 'loading' || prev[item.id] === 'partial') && (avail === 'ready' || avail === 'independent')) {
          newlyReady.push(item.id);
        }
        prev[item.id] = avail;
      }
    }
    if (newlyReady.length > 0) {
      setLightUpPages((s) => {
        const next = new Set(s);
        for (const id of newlyReady) next.add(id);
        return next;
      });
      // Remove the light-up class after animation completes
      const timer = setTimeout(() => {
        setLightUpPages((s) => {
          const next = new Set(s);
          for (const id of newlyReady) next.delete(id);
          return next;
        });
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [parsedData]);

  // Badge counts
  const issuesBadge = parsedData.disabledFeatures
    ? Object.keys(parsedData.disabledFeatures).length
    : 0;
  const logsBadge = parsedData.formattedLogErrors ? 1 : 0;

  function getBadgeCount(badge?: 'issues' | 'logs'): number {
    if (badge === 'issues') return issuesBadge;
    if (badge === 'logs') return logsBadge;
    return 0;
  }

  function renderNavItem(item: NavItem) {
    const isActive = activePage === item.id;
    const badgeCount = getBadgeCount(item.badge);
    const avail = getPageAvailability(parsedData, item.id);
    const isDimmed = avail === 'loading';
    const isPartial = avail === 'partial';
    const isLightUp = lightUpPages.has(item.id);

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          addDebugLog(`Navigate: ${activePage} → ${item.id} (clicked "${item.label}")`, 'navigation');
          setActivePage(item.id);
        }}
        title={collapsed ? item.label : undefined}
        className={`relative flex items-center gap-3 w-full rounded-md px-2.5 py-1.5 text-sm transition-all duration-500 ${
          isActive
            ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        } ${collapsed ? 'justify-center px-0' : ''} ${isDimmed ? 'opacity-40' : isPartial ? 'opacity-60' : ''}`}
        style={isLightUp ? { animation: 'sidebar-ready 600ms ease-out' } : undefined}
      >
        {/* Active indicator bar */}
        {isActive && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-[var(--accent)]"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}

        <span className="flex-shrink-0">{icons[item.id]}</span>

        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            {badgeCount > 0 && (
              <span className="flex-shrink-0 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-[var(--accent-muted)] text-[var(--accent)] text-xs font-medium px-1.5">
                {badgeCount}
              </span>
            )}
          </>
        )}
      </button>
    );
  }

  function renderSection(section: NavSection, idx: number) {
    return (
      <div key={section.title} className={idx > 0 ? 'mt-4' : ''}>
        {!collapsed && (
          <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            {section.title}
          </div>
        )}
        <div className="flex flex-col gap-0.5">{section.items.map(renderNavItem)}</div>
      </div>
    );
  }

  return (
    <aside
      className="flex flex-col h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-default)] overflow-hidden"
    >
      {/* Refresh cache + collapse toggle */}
      <div className={`flex items-center px-4 py-4 ${collapsed ? 'flex-col gap-1.5 px-2' : 'justify-between'}`}>
        {statusPhase === 'loading' && (
          <div className={`flex items-center gap-2 px-2 py-1 ${collapsed ? 'justify-center' : ''}`}>
            <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
            {!collapsed && (
              <span className="text-sm font-medium text-[var(--text-tertiary)]">
                Loading<span className="inline-block w-[1.5ch] text-left animate-[dots_1.4s_steps(4,end)_infinite]" />
              </span>
            )}
          </div>
        )}
        {statusPhase === 'complete' && (
          <div className={`flex items-center gap-2 px-2 py-1 animate-[blink_0.8s_ease-in-out_3] ${collapsed ? 'justify-center' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--neon-green)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {!collapsed && (
              <span className="text-sm font-medium text-[var(--neon-green)]">Complete!</span>
            )}
          </div>
        )}
        {statusPhase === 'refresh' && (
          <button
            type="button"
            onClick={handleRefresh}
            title="Refresh cache"
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors ${collapsed ? 'justify-center' : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
            </svg>
            {!collapsed && <span className="text-sm font-medium">Refresh</span>}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {collapsed ? (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <path d="m14 9 3 3-3 3" />
              </>
            ) : (
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <path d="m16 15-3-3 3-3" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-[var(--border-default)]" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0">
        {NAV_SECTIONS.map((section, idx) => renderSection(section, idx))}
      </nav>

      {/* Contact author */}
      {!collapsed && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[var(--text-tertiary)]">
          <span className="text-[11px]">by Alex Kaos</span>
          <a
            href="mailto:alex.kaos@dataiku.com?subject=DiagParser Feedback"
            className="p-1 rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Email"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </a>
          <a
            href="https://dataiku.enterprise.slack.com/archives/C08QQHCP4MD"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Slack"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
            </svg>
          </a>
        </div>
      )}

    </aside>
  );
}
