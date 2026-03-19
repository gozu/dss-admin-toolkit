import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Breadcrumb } from './Breadcrumb';
import { useTheme } from '../../hooks/useTheme';
import dkulogo from '../../assets/dkulogo.png';
import { exportAllTablesToZip } from '../../utils/exportTables';
import { exportDataToZip } from '../../utils/exportData';
import { useDiag } from '../../context/DiagContext';
import { SqliteWarningBanner } from '../SqliteWarningBanner';
import { useReportGenerator } from '../../hooks/useReportGenerator';
import { ReportOverlay } from '../ReportOverlay';
import { SearchableCombobox } from '../SearchableCombobox';

const COLLAPSE_BREAKPOINT = 1280;
const SIDEBAR_EXPANDED = 160;
const SIDEBAR_COLLAPSED = 56;

interface AppShellProps {
  children: ReactNode;
  onOpenPalette?: () => void;
  onRefreshCache?: () => Promise<void>;
  sqliteFallback?: boolean;
}

export function AppShell({ children, onOpenPalette, onRefreshCache, sqliteFallback }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COLLAPSE_BREAKPOINT,
  );
  const [showAbout, setShowAbout] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const { state: { parsedData } } = useDiag();

  // Report generator
  const report = useReportGenerator();
  const [showReportPopover, setShowReportPopover] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const reportPopoverRef = useRef<HTMLDivElement>(null);

  const llmLabels = useMemo(() => report.llms.map(l => l.label), [report.llms]);

  // Close popover on outside click
  useEffect(() => {
    if (!showReportPopover) return;
    const handler = (e: MouseEvent) => {
      if (reportPopoverRef.current && !reportPopoverRef.current.contains(e.target as Node)) {
        setShowReportPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showReportPopover]);

  const handleReportButtonClick = () => {
    if (report.status === 'ready' || report.status === 'viewing') {
      report.openOverlay();
      return;
    }
    if (report.status === 'generating') return;
    // Show disclaimer first time, then popover
    if (!disclaimerAccepted) {
      setShowDisclaimer(true);
    } else {
      setShowReportPopover(true);
      report.openSelector();
    }
  };

  const handleDisclaimerAccept = () => {
    setShowDisclaimer(false);
    setDisclaimerAccepted(true);
    setShowReportPopover(true);
    report.openSelector();
  };

  const handleGenerate = () => {
    setShowReportPopover(false);
    report.generate(parsedData);
  };

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

  const reportBtnClass = [
    'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
    !parsedData.dataReady ? 'opacity-30 cursor-not-allowed text-[var(--text-tertiary)]'
      : report.status === 'ready' ? 'text-[var(--accent)] report-btn-pulse'
      : report.status === 'generating' ? 'text-[var(--accent)]'
      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
  ].join(' ');

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
            src={dkulogo}
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
          <span className="hidden lg:inline ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-amber-500/15 text-amber-400 border border-amber-500/40">
            ⚠ Experimental — use outside sandbox at your own risk
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Generate Report button */}
          <div className="relative" ref={reportPopoverRef}>
            <button
              type="button"
              onClick={handleReportButtonClick}
              disabled={!parsedData.dataReady}
              title={report.status === 'generating' ? `Generating report... ${report.phase}` : report.status === 'ready' ? 'View report' : 'Generate quarterly report'}
              className={reportBtnClass}
            >
              {report.status === 'generating' ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
            </button>

            {/* LLM selector popover */}
            {showReportPopover && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg p-3 z-50 space-y-3">
                <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Generate Report</div>
                {report.isLoadingLlms ? (
                  <div className="text-sm text-[var(--text-tertiary)]">Loading models...</div>
                ) : report.llms.length === 0 ? (
                  <div className="text-sm text-[var(--text-tertiary)]">No LLMs available. Configure an LLM connection in this project.</div>
                ) : (
                  <>
                    <SearchableCombobox
                      value={report.selectedLlmLabel}
                      onChange={report.setSelectedLlmLabel}
                      options={llmLabels}
                      placeholder="Select model..."
                      className="w-full px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={!report.selectedLlmLabel}
                      className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Generate
                    </button>
                  </>
                )}
                {report.error && (
                  <div className="text-xs text-[var(--danger)] mt-1">{report.error}</div>
                )}
              </div>
            )}
          </div>

          {/* Export all data as JSON zip */}
          <button
            type="button"
            onClick={() => exportDataToZip(parsedData)}
            disabled={!parsedData.dataReady}
            title="Export all data as JSON (zip)"
            className={`flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors ${!parsedData.dataReady ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8" />
              <path d="M1 3h22v5H1z" />
              <path d="M10 12h4" />
            </svg>
          </button>

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
      <main className="overflow-y-auto bg-[var(--bg-app)] flex flex-col relative">
        {sqliteFallback && <SqliteWarningBanner />}
        {children}

        {/* Floating bug report button */}
        <a
          href="mailto:alex.kaos@dataiku.com?subject=Admin%20Toolkit%20feedback"
          className="fixed bottom-6 right-3 z-50 flex items-center justify-center w-9 h-9 rounded-full bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40 hover:bg-[var(--neon-cyan)]/25 hover:border-[var(--neon-cyan)]/60 transition-colors shadow-lg backdrop-blur-sm"
          title="Report a bug"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2l1.88 1.88" />
            <path d="M14.12 3.88L16 2" />
            <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
            <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
            <path d="M12 20v-9" />
            <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
            <path d="M6 13H2" />
            <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
            <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
            <path d="M22 13h-4" />
            <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
          </svg>
        </a>


      </main>

      {/* AI Disclaimer modal */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDisclaimer(false)}>
          <div
            className="mx-4 max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] flex items-center justify-center">
                <svg className="w-5 h-5 text-[var(--neon-amber)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Report Disclaimer</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The quarterly health check report is generated by AI and may contain <strong className="text-[var(--text-primary)]">inaccurate, incomplete, or misleading</strong> analysis.
            </p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Always verify findings against official Dataiku documentation and your own system knowledge before presenting to customers.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDisclaimer(false)}
                className="px-4 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisclaimerAccept}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                I understand, proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report overlay */}
      {report.isOverlayOpen && report.reportData && (
        <ReportOverlay
          reportData={report.reportData}
          parsedData={parsedData}
          onClose={report.closeOverlay}
        />
      )}
    </div>
  );
}
