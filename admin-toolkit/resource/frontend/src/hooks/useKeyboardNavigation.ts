import { useEffect } from 'react';
import type { PageId } from '../types';

interface UseKeyboardNavigationOptions {
  onNavigate: (page: PageId) => void;
  onOpenPalette: () => void;
  onToggleTheme?: () => void;
}

const PAGE_ORDER: PageId[] = [
  'summary',
  'issues',
  'filesystem',
  'memory',
  'directory',
  'projects',
  'code-envs',
  'connections',
  'runtime-config',
  'security-config',
  'platform-config',
  'logs',
  'outreach',
  'cleaners',
  'settings',
];

const NUMBER_KEY_MAP: Record<string, PageId> = {
  '1': 'summary',
  '2': 'issues',
  '3': 'filesystem',
  '4': 'memory',
  '5': 'directory',
  '6': 'projects',
  '7': 'code-envs',
  '8': 'connections',
  '9': 'runtime-config',
  '0': 'security-config',
};

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardNavigation({
  onNavigate,
  onOpenPalette,
  onToggleTheme,
}: UseKeyboardNavigationOptions): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K always triggers palette, even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // All other shortcuts are disabled when focus is in an input element
      if (isInputFocused()) return;

      // Number keys: jump to specific pages
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const page = NUMBER_KEY_MAP[e.key];
        if (page) {
          e.preventDefault();
          onNavigate(page);
          return;
        }
      }

      // Forward slash: open command palette
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Question mark: open command palette (shortcuts help)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Bracket keys: prev/next page
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const currentPath = window.location.hash.replace('#', '') || '';
        const currentIndex = PAGE_ORDER.indexOf(currentPath as PageId);
        const prevIndex = currentIndex <= 0 ? PAGE_ORDER.length - 1 : currentIndex - 1;
        onNavigate(PAGE_ORDER[prevIndex]);
        return;
      }

      if (e.key === ']' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const currentPath = window.location.hash.replace('#', '') || '';
        const currentIndex = PAGE_ORDER.indexOf(currentPath as PageId);
        const nextIndex =
          currentIndex < 0 || currentIndex >= PAGE_ORDER.length - 1 ? 0 : currentIndex + 1;
        onNavigate(PAGE_ORDER[nextIndex]);
        return;
      }

      // t: toggle theme (skip on code-envs page where T toggles Tetris)
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !e.altKey && onToggleTheme) {
        const currentPath = window.location.hash.replace('#', '') || '';
        if (currentPath === 'code-envs') return;
        e.preventDefault();
        onToggleTheme();
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onNavigate, onOpenPalette, onToggleTheme]);
}
