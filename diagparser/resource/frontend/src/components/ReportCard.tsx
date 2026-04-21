import { useState, useRef, useCallback, useEffect } from 'react';
import { useDiag } from '../context/DiagContext';
import { useReportGenerator } from '../hooks/useReportGenerator';
import { ReportOverlay } from './ReportOverlay';
import { exportReportAsHtml } from '../utils/exportReport';
import { extractAllCSS } from '../utils/extractCSS';
import { useTheme } from '../hooks/useTheme';

export function ReportCard() {
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

  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Prefetch LLMs on mount (same pattern as ReportPage.tsx)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      openSelector();
      closeSelector();
    }
  }, [openSelector, closeSelector]);

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
    generate(parsedData);
  }, [selectedLlmId, parsedData, generate]);

  const handleOpenNewTab = useCallback(() => {
    if (!reportData) return;
    openOverlay();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const overlay = document.querySelector('.report-overlay') as HTMLElement;
        if (overlay) {
          const css = extractAllCSS();
          const clone = overlay.cloneNode(true) as HTMLElement;
          // Convert images to base64
          const clonedImgs = clone.querySelectorAll('img');
          const originalImgs = overlay.querySelectorAll('img');
          for (let i = 0; i < clonedImgs.length; i++) {
            const orig = originalImgs[i] as HTMLImageElement | undefined;
            if (orig && orig.complete && orig.naturalWidth > 0) {
              try {
                const c = document.createElement('canvas');
                c.width = orig.naturalWidth; c.height = orig.naturalHeight;
                const ctx = c.getContext('2d');
                if (ctx) { ctx.drawImage(orig, 0, 0); clonedImgs[i].src = c.toDataURL('image/png'); }
              } catch { /* CORS */ }
            }
          }
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
    openOverlay();
    setTimeout(() => {
      try {
        const overlay = document.querySelector('.report-overlay') as HTMLElement;
        if (overlay) {
          exportReportAsHtml(overlay, parsedData.company || 'unknown', theme);
        }
      } finally {
        closeOverlay();
      }
    }, 500);
  }, [openOverlay, closeOverlay, parsedData.company, theme]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="col-span-full mt-6">
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--neon-cyan, #00f5ff)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Quarterly Health Check Report</h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--neon-cyan,#00f5ff)]/10 text-[var(--neon-cyan,#00f5ff)] border border-[var(--neon-cyan,#00f5ff)]/20 font-mono">
            LLM Mesh
          </span>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3 mb-3">
          {/* LLM Selector */}
          <div className="flex-1">
            {isLoadingLlms ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] h-9 px-3">
                <span className="inline-block w-4 h-4 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
                Loading models...
              </div>
            ) : (
              <select
                value={selectedLlmLabel}
                onChange={(e) => setSelectedLlmLabel(e.target.value)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                {llmLabels.length === 0 && (
                  <option value="">No LLMs available</option>
                )}
                {llmLabels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Generate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={status === 'generating' || !selectedLlmId}
            className={`flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
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
        </div>

        {/* Status line during generation */}
        {status === 'generating' && (
          <div className="flex items-center gap-3 text-xs font-mono text-[var(--text-secondary)] mb-3 px-1">
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span>{phase || 'Preparing...'}</span>
            {elapsedMs > 0 && (
              <span className="text-[var(--text-tertiary)]">({formatElapsed(elapsedMs)})</span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 mb-3 flex items-center justify-between">
            <span className="text-sm text-red-400">{error}</span>
            <button
              type="button"
              onClick={retry}
              className="text-xs font-medium text-red-400 hover:text-red-300 underline ml-3"
            >
              Retry
            </button>
          </div>
        )}

        {/* Ready: action buttons */}
        {status === 'ready' && reportData && (
          <div className="flex items-center gap-3 mb-3">
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
            {elapsedMs > 0 && (
              <span className="text-xs text-[var(--text-tertiary)] font-mono whitespace-nowrap">
                Generated in {formatElapsed(elapsedMs)}
              </span>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          This report is generated by an LLM and may contain inaccuracies.
          Always verify critical findings against the raw diagnostic data.
        </p>
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
