// Teti — full-featured Tetris clone (https://github.com/TitanPlayz100/teti)
// Embedded via iframe since the game uses PixiJS, GSAP, and direct DOM manipulation.

import { useRef, useEffect, useState } from 'react';

export function TetiGame({ progressPct = 0 }: { progressPct?: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const displayPct = Math.max(0, Math.min(100, Math.round(progressPct)));

  const timerColor =
    displayPct >= 100
      ? 'var(--neon-green)'
      : displayPct >= 60
        ? 'var(--neon-cyan)'
        : 'var(--neon-amber)';

  // Resolve the base path for the iframe src (works in both dev and production)
  const base = import.meta.env.BASE_URL || '/';
  const src = `${base}teti/index.html`;

  useEffect(() => {
    return () => {
      // Cleanup: remove iframe src to stop audio/animations on unmount
      if (iframeRef.current) {
        iframeRef.current.src = 'about:blank';
      }
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 py-3 px-4">
      {/* Loading progress display */}
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-bold">
          Loading diagnostic data
        </div>
        <div
          className="font-mono text-4xl font-bold tabular-nums"
          style={{ color: timerColor }}
        >
          {displayPct}%
        </div>
      </div>

      {/* Game iframe */}
      <div className="relative rounded-lg border border-[var(--border-glass)] overflow-hidden">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-elevated)] z-10">
            <span className="text-xs text-[var(--text-muted)]">Loading game...</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={src}
          onLoad={() => setIframeLoaded(true)}
          style={{
            width: 800,
            height: 600,
            maxWidth: '100%',
            border: 'none',
            display: 'block',
          }}
          title="Teti"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>

      <div className="text-[10px] text-[var(--text-muted)]">
        <span><kbd className="inline-block px-1 py-0.5 font-mono bg-[var(--bg-elevated)] border border-[var(--border-glass)] rounded text-[var(--text-secondary)] mx-0.5">Esc</kbd> Menu</span>
      </div>
    </div>
  );
}
