import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Breadcrumb } from './Breadcrumb';
import { useTheme } from '../../hooks/useTheme';
import { exportAllTablesToZip } from '../../utils/exportTables';

const COLLAPSE_BREAKPOINT = 1280;
const SIDEBAR_EXPANDED = 160;
const SIDEBAR_COLLAPSED = 56;

interface AppShellProps {
  children: ReactNode;
  onOpenPalette?: () => void;
  onRefreshCache?: () => Promise<void>;
}

export function AppShell({ children, onOpenPalette, onRefreshCache }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COLLAPSE_BREAKPOINT,
  );
  const [showAbout, setShowAbout] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  // Listen for viewport changes to auto-collapse
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${COLLAPSE_BREAKPOINT - 1}px)`);

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setCollapsed(e.matches);
    };

    // Set initial value
    handleChange(mql);

    mql.addEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    return () =>
      mql.removeEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
  }, []);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <div
      className="h-screen overflow-hidden bg-[var(--bg-app)]"
      style={{
        display: 'grid',
        gridTemplateColumns: `${sidebarWidth}px 1fr`,
        gridTemplateRows: 'auto 1fr',
      }}
    >
      {/* Sidebar — spans both rows */}
      <motion.div
        className="row-span-2 overflow-hidden"
        animate={{ width: sidebarWidth }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
      >
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((prev) => !prev)} onRefreshCache={onRefreshCache} />
      </motion.div>

      {/* Top bar */}
      <header className="relative flex items-center justify-between px-5 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
        <Breadcrumb />

        {/* Center branding */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
          <img
            src="https://pbs.twimg.com/profile_images/1937529036705570816/dsylyC_j_400x400.png"
            alt="Dataiku"
            className="h-5 w-5"
          />
          <span
            className="text-base font-bold text-[var(--text-primary)] tracking-tight"
            style={{ fontFamily: "'Roboto Condensed', sans-serif" }}
          >
            ADMIN
          </span>
          <span
            className="text-base font-bold text-[#2AB1AC] tracking-tight -ml-1.5"
            style={{ fontFamily: "'Roboto Condensed', sans-serif" }}
          >
            TOOLKIT
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/30">
            ALPHA
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Export all tables as CSV zip */}
          <button
            type="button"
            onClick={exportAllTablesToZip}
            title="Export all tables to CSV (zip)"
            className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Cmd+K search button */}
          <button
            type="button"
            onClick={() => onOpenPalette?.()}
            title="Search pages & keywords (⌘K)"
            className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-xs font-mono cursor-pointer hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="text-[11px]">&#8984;</span>K
          </button>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* About popover */}
          <div className="relative">
            <button
              type="button"
              title="About"
              onClick={() => setShowAbout((p) => !p)}
              className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
            {showAbout && (
              <div className="absolute right-0 top-full mt-2 w-52 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg p-3 z-50">
                <div className="text-xs font-mono text-[var(--text-secondary)] mb-1">
                  v{__APP_VERSION__}
                </div>
                <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
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
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content area — scrollable */}
      <main className="overflow-y-auto bg-[var(--bg-app)] flex flex-col">
        {children}
      </main>
    </div>
  );
}
