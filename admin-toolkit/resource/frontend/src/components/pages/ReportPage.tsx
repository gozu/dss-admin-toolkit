import { useState, useRef, useCallback, useEffect } from 'react';
import { useDiag } from '../../context/DiagContext';
import { useReportGenerator } from '../../hooks/useReportGenerator';
import { SearchableCombobox } from '../SearchableCombobox';
import { ReportOverlay } from '../ReportOverlay';
import { exportReportAsHtml } from '../../utils/exportReport';
import { prepareReportData } from '../../utils/prepareReportData';
import { useTheme } from '../../hooks/useTheme';
import { getProgressMessage } from '../../utils/progressMessages';

export function ReportPage() {
  const { state } = useDiag();
  const { parsedData } = state;
  const { theme } = useTheme();

  const {
    status,
    phase,
    llms,
    isLoadingLlms,
    selectedLlmLabel,
    setSelectedLlmLabel,
    generate,
    reportData,
    error,
    retry,
    isOverlayOpen,
    openOverlay,
    closeOverlay,
    openSelector,
    closeSelector,
  } = useReportGenerator();

  // Verbose status tracking
  const [elapsedMs, setElapsedMs] = useState(0);
  const [payloadSize, setPayloadSize] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);
  const logPanelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch LLMs on mount by triggering the selector open/close cycle
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      openSelector();
      closeSelector();
    }
  }, [openSelector, closeSelector]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  // Auto-scroll log panel
  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [logs]);

  // Track phase changes in verbose log
  useEffect(() => {
    if (phase) {
      addLog(`Phase: ${phase}`);
    }
  }, [phase, addLog]);

  // Track error in verbose log
  useEffect(() => {
    if (error) {
      addLog(`ERROR: ${error}`);
    }
  }, [error, addLog]);

  // Escalating humor progress messages while LLM thinks
  useEffect(() => {
    if (status !== 'generating') return;
    let n = 0;
    const id = setInterval(() => addLog(getProgressMessage(n++)), 3000 + Math.random() * 4000);
    return () => clearInterval(id);
  }, [status, addLog]);

  // Elapsed timer during generation
  useEffect(() => {
    if (status === 'generating') {
      startRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startRef.current);
      }, 200);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (status === 'ready' && startRef.current > 0) {
        setElapsedMs(Date.now() - startRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const llmLabels = llms.map((l) => l.label);
  const selectedLlmId = llms.find((l) => l.label === selectedLlmLabel)?.id ?? '';

  const handleGenerate = useCallback(() => {
    if (!selectedLlmId) return;
    setLogs([]);
    const payload = prepareReportData(parsedData);
    const size = JSON.stringify(payload).length;
    setPayloadSize(size);
    addLog(`Selected LLM: ${selectedLlmId}`);
    addLog(`Data payload: ${size.toLocaleString()} chars`);
    addLog('Starting generation...');
    generate(parsedData);
  }, [selectedLlmId, parsedData, generate, addLog]);

  const handleOpenNewTab = useCallback(() => {
    if (!reportData) return;
    openOverlay();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const overlay = document.querySelector('.report-overlay') as HTMLElement;
        if (overlay) {
          const styleTags = Array.from(document.querySelectorAll('head style'));
          let css = '';
          for (const tag of styleTags) css += tag.textContent + '\n';

          const clone = overlay.cloneNode(true) as HTMLElement;
          const slides = clone.querySelectorAll('[data-slide-index]');
          slides.forEach((s, i) => {
            (s as HTMLElement).classList.remove('active');
            if (i === 0) (s as HTMLElement).classList.add('active');
          });

          const navScript = `(function(){var c=0,s=document.querySelectorAll('[data-slide-index]'),t=s.length,ct=document.getElementById('slide-counter');function show(i){s.forEach(function(e){e.classList.remove('active')});if(s[i])s[i].classList.add('active');if(ct)ct.textContent=(i+1)+' / '+t;var pb=document.querySelector('.report-progress-bar');if(pb)pb.style.width=((i+1)/t*100)+'%';}document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();c=Math.min(c+1,t-1);show(c);}else if(e.key==='ArrowLeft'){e.preventDefault();c=Math.max(c-1,0);show(c);}});var p=document.getElementById('nav-prev'),n=document.getElementById('nav-next');if(p)p.onclick=function(){c=Math.max(c-1,0);show(c);};if(n)n.onclick=function(){c=Math.min(c+1,t-1);show(c);};var dl=document.querySelector('[title="Download as HTML"]');if(dl)dl.parentElement.removeChild(dl);var cl=document.querySelector('[title="Close (Esc)"]');if(cl)cl.parentElement.removeChild(cl);})();`;

          const navBtns = clone.querySelectorAll('.report-nav-btn');
          if (navBtns[0]) navBtns[0].id = 'nav-prev';
          if (navBtns[1]) navBtns[1].id = 'nav-next';
          const counter = clone.querySelector('.report-nav span');
          if (counter) counter.id = 'slide-counter';

          const company = parsedData.company || 'unknown';
          const date = new Date().toISOString().slice(0, 10);
          const html = `<!DOCTYPE html><html data-theme="${theme}"><head><meta charset="utf-8"><title>Health Check - ${company} - ${date}</title><style>@import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Roboto:wght@400;500;700&display=swap');${css}body{margin:0;overflow:hidden;font-family:'Roboto',sans-serif;}</style></head><body>${clone.outerHTML}<script>${navScript}</script></body></html>`;

          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        closeOverlay();
      });
    });
  }, [reportData, openOverlay, closeOverlay, parsedData.company, theme]);

  const handleDownload = useCallback(() => {
    // We need to briefly show the overlay to capture DOM, then export
    openOverlay();
    // Wait for render, then export
    setTimeout(() => {
      if (overlayRef.current) {
        exportReportAsHtml(overlayRef.current, parsedData.company || 'unknown', theme);
      }
    }, 500);
  }, [openOverlay, parsedData.company, theme]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
          Quarterly Health Check Report
        </h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
          Generate an AI-powered health check report from the current diagnostic data.
          The report produces a presentation-style slideshow covering system health,
          project footprint, code environments, and actionable recommendations.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Controls */}
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 space-y-5">
          {/* LLM Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
              LLM Model
            </label>
            {isLoadingLlms ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
                Loading models...
              </div>
            ) : (
              <SearchableCombobox
                value={selectedLlmLabel}
                onChange={setSelectedLlmLabel}
                options={llmLabels}
                placeholder="Select an LLM model..."
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                onEnterWithClosed={handleGenerate}
              />
            )}
          </div>

          {/* Generate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={status === 'generating' || !selectedLlmId}
            className={`w-full flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
              status === 'generating' || !selectedLlmId
                ? 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] cursor-not-allowed'
                : 'bg-[var(--accent)] text-white hover:opacity-90'
            }`}
          >
            {status === 'generating' ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Report'
            )}
          </button>

          {/* AI Disclaimer */}
          <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
            This report is generated by an LLM and may contain inaccuracies.
            Always verify critical findings against the raw diagnostic data before
            sharing with customers.
          </p>

          {/* Action Buttons (when ready) */}
          {status === 'ready' && reportData && (
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleOpenNewTab}
                className="flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                View Report
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download HTML
              </button>
            </div>
          )}

          {/* Retry on error */}
          {error && status === 'idle' && (
            <button
              type="button"
              onClick={retry}
              className="w-full flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Retry
            </button>
          )}
        </div>

        {/* Right: Verbose Status Panel */}
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Status
            </span>
            {status === 'generating' && (
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            )}
            {status === 'ready' && (
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            )}
            {error && (
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
            )}
          </div>

          {/* Status fields */}
          <div className="px-4 py-3 border-b border-[var(--border-default)] grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-mono">
            <div>
              <span className="text-[var(--text-tertiary)]">Phase: </span>
              <span className="text-[var(--text-primary)]">{phase || 'Idle'}</span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">Elapsed: </span>
              <span className="text-[var(--text-primary)]">
                {elapsedMs > 0 ? formatElapsed(elapsedMs) : '--'}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">Model: </span>
              <span className="text-[var(--text-primary)] break-all">
                {selectedLlmId || '--'}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">Payload: </span>
              <span className="text-[var(--text-primary)]">
                {payloadSize > 0 ? `${payloadSize.toLocaleString()} chars` : '--'}
              </span>
            </div>
          </div>

          {/* Log output */}
          <div
            ref={logPanelRef}
            className="flex-1 min-h-[200px] max-h-[400px] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-base)]"
          >
            {logs.length === 0 ? (
              <span className="text-[var(--text-tertiary)]">
                Waiting for generation to start...
              </span>
            ) : (
              logs.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes('ERROR')
                      ? 'text-red-400'
                      : line.includes('Complete')
                        ? 'text-green-400'
                        : ''
                  }
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Report Overlay (full-screen portal) */}
      {isOverlayOpen && reportData && (
        <div ref={overlayRef}>
          <ReportOverlay
            reportData={reportData}
            parsedData={parsedData}
            onClose={closeOverlay}
          />
        </div>
      )}
    </div>
  );
}
