import { useState, useCallback, useEffect } from 'react';

export function useMaximize() {
  const [isMaximized, setIsMaximized] = useState(false);
  const open = useCallback(() => setIsMaximized(true), []);
  const close = useCallback(() => setIsMaximized(false), []);

  useEffect(() => {
    if (!isMaximized) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isMaximized, close]);

  useEffect(() => {
    document.body.style.overflow = isMaximized ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMaximized]);

  return { isMaximized, open, close };
}
