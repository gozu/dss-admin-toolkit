import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirEntry, DirTreeData } from '../types';
import { fetchJson } from '../utils/api';
import { useDiag } from '../context/DiagContext';

function _readDirTreeDepth(): number {
  try {
    const raw = window.localStorage.getItem('diagparser.thresholds');
    if (raw) {
      const t = JSON.parse(raw);
      if (typeof t.dirTreeDefaultDepth === 'number') return t.dirTreeDefaultDepth;
    }
  } catch { /* use default */ }
  return 3;
}
const DEFAULT_MAX_DEPTH = _readDirTreeDepth();
const EXPAND_DEPTH = 5;

export type FootprintScope = 'dss' | 'project';

interface DirTreeDebugError {
  kind?: string;
  path?: string;
  error?: string;
}

interface DirTreeDebugItem {
  path?: string;
  size?: number;
  humanSize?: string;
  fileCount?: number;
  reason?: string;
  fsType?: string;
  mounts?: string[];
}

interface DirTreeDebugPayload {
  totalSize?: number;
  totalFiles?: number;
  nodesVisited?: number;
  dirsVisited?: number;
  filesVisited?: number;
  entriesScanned?: number;
  symlinksSeen?: number;
  statErrors?: number;
  scanErrors?: number;
  topChildren?: DirTreeDebugItem[];
  specialMountTotals?: DirTreeDebugItem[];
  largeLeafs?: DirTreeDebugItem[];
  errors?: DirTreeDebugError[];
  dfRootUsed?: number;
  dfMountedUsed?: number;
  dfTotalUsed?: number;
  dfMountsIncluded?: DirTreeDebugItem[];
  dfMountsExcluded?: DirTreeDebugItem[];
  dfTopMountBuckets?: DirTreeDebugItem[];
  overlayUnknownBytes?: number;
  permissionDeniedPaths?: string[];
}

interface DirTreeResponse extends DirTreeData {
  debug?: DirTreeDebugPayload;
}
interface DirTreeExpandResponse {
  node?: DirEntry | null;
  debug?: DirTreeDebugPayload;
}

interface DirTreeLoadOptions {
  scope?: FootprintScope;
  projectKey?: string;
}

interface ApiDirTreeState {
  isLoading: boolean;
  isExpanding: boolean;
  error: string | null;
  tree: DirTreeData | null;
  expandedNodes: Map<string, DirEntry>;
  scope: FootprintScope;
  projectKey: string;
}

function buildScopeQuery(scope: FootprintScope, projectKey: string): string {
  const params = new URLSearchParams();
  params.set('scope', scope);
  if (scope === 'project' && projectKey.trim()) {
    params.set('projectKey', projectKey.trim());
  }
  return params.toString();
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(2)} ${units[idx]}`;
}

export function useApiDirTree() {
  const { dispatch } = useDiag();
  const loadAbortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<ApiDirTreeState>({
    isLoading: false,
    isExpanding: false,
    error: null,
    tree: null,
    expandedNodes: new Map(),
    scope: 'dss',
    projectKey: '',
  });

  const abortLoad = useCallback(() => {
    const controller = loadAbortRef.current;
    if (!controller) return;
    controller.abort();
    loadAbortRef.current = null;
    dispatch({
      type: 'ADD_DEBUG_LOG',
      payload: { scope: 'dir-tree', level: 'warn', message: 'Aborted root directory scan request' },
    });
    setState(prev => ({ ...prev, isLoading: false, error: null }));
  }, [dispatch]);

  useEffect(() => {
    return () => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }
    };
  }, []);

  const loadRoot = useCallback(async (options: DirTreeLoadOptions = {}) => {
    if (loadAbortRef.current) {
      loadAbortRef.current.abort();
      loadAbortRef.current = null;
    }

    const scope: FootprintScope = options.scope || 'dss';
    const projectKey = options.projectKey || '';
    const scopeQuery = buildScopeQuery(scope, projectKey);
    const url = `/api/dir-tree?maxDepth=${DEFAULT_MAX_DEPTH}&${scopeQuery}`;
    const controller = new AbortController();
    loadAbortRef.current = controller;

    dispatch({ type: 'ADD_DEBUG_LOG', payload: { scope: 'dir-tree', level: 'info', message: `GET ${url}` } });
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      scope,
      projectKey,
    }));

    try {
      const data = await fetchJson<DirTreeResponse>(url, { signal: controller.signal });
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
      }
      if (data.debug) {
        const dbg = data.debug;
        dispatch({
          type: 'ADD_DEBUG_LOG',
          payload: {
            scope: 'dir-tree',
            level: 'info',
            message: [
              `Tree debug: total=${formatBytes(dbg.totalSize)} files=${(dbg.totalFiles ?? 0).toLocaleString()}`,
              `nodes=${dbg.nodesVisited ?? 0}`,
              `dirs=${dbg.dirsVisited ?? 0}`,
              `files=${dbg.filesVisited ?? 0}`,
              `scanned=${dbg.entriesScanned ?? 0}`,
              `symlinks=${dbg.symlinksSeen ?? 0}`,
              `statErr=${dbg.statErrors ?? 0}`,
              `scanErr=${dbg.scanErrors ?? 0}`,
            ].join(' | '),
          },
        });

        if (dbg.topChildren && dbg.topChildren.length > 0) {
          const top = dbg.topChildren
            .slice(0, 5)
            .map((item) => `${item.path || '?'}=${item.humanSize || formatBytes(item.size)}`)
            .join(', ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: { scope: 'dir-tree', level: 'info', message: `Top children: ${top}` },
          });
        }

        if (dbg.specialMountTotals && dbg.specialMountTotals.length > 0) {
          const special = dbg.specialMountTotals
            .slice(0, 5)
            .map((item) => `${item.path || '?'}=${item.humanSize || formatBytes(item.size)}`)
            .join(', ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: { scope: 'dir-tree', level: 'warn', message: `Special mounts included: ${special}` },
          });
        }

        if (typeof dbg.dfTotalUsed === 'number' && dbg.dfTotalUsed > 0) {
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: {
              scope: 'dir-tree',
              level: 'info',
              message: `DF overlay: total=${formatBytes(dbg.dfTotalUsed)} rootfs=${formatBytes(dbg.dfRootUsed)} mounted=${formatBytes(dbg.dfMountedUsed)}`,
            },
          });
        }

        if (dbg.dfTopMountBuckets && dbg.dfTopMountBuckets.length > 0) {
          const mounts = dbg.dfTopMountBuckets
            .slice(0, 5)
            .map((item) => `${item.path || '?'}=${item.humanSize || formatBytes(item.size)}`)
            .join(', ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: { scope: 'dir-tree', level: 'info', message: `DF mount buckets: ${mounts}` },
          });
        }

        if (typeof dbg.overlayUnknownBytes === 'number' && dbg.overlayUnknownBytes > 0) {
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: {
              scope: 'dir-tree',
              level: 'warn',
              message: `Unscanned usage overlaid: ${formatBytes(dbg.overlayUnknownBytes)}`,
            },
          });
        }

        if (dbg.permissionDeniedPaths && dbg.permissionDeniedPaths.length > 0) {
          const denied = dbg.permissionDeniedPaths.slice(0, 5).join(', ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: {
              scope: 'dir-tree',
              level: 'warn',
              message: `Permission denied paths: ${denied}`,
            },
          });
        }

        if (dbg.largeLeafs && dbg.largeLeafs.length > 0) {
          const large = dbg.largeLeafs
            .slice(0, 5)
            .map((item) => `${item.path || '?'}=${item.humanSize || formatBytes(item.size)}${item.reason ? ` (${item.reason})` : ''}`)
            .join(', ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: { scope: 'dir-tree', level: 'warn', message: `Large leaf entries: ${large}` },
          });
        }

        if (dbg.errors && dbg.errors.length > 0) {
          const errs = dbg.errors
            .slice(0, 3)
            .map((item) => `${item.kind || 'err'} ${item.path || '?'} -> ${item.error || 'unknown'}`)
            .join(' | ');
          dispatch({
            type: 'ADD_DEBUG_LOG',
            payload: { scope: 'dir-tree', level: 'warn', message: `Tree scanner errors: ${errs}` },
          });
        }
      }
      dispatch({
        type: 'ADD_DEBUG_LOG',
        payload: {
          scope: 'dir-tree',
          level: 'info',
          message: `Loaded dir tree (${scope}) root with ${data.root?.children?.length || 0} children`,
        }
      });
      setState(prev => ({
        ...prev,
        isLoading: false,
        tree: data,
        expandedNodes: new Map(),
        error: null,
      }));
    } catch (err) {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        dispatch({
          type: 'ADD_DEBUG_LOG',
          payload: { scope: 'dir-tree', level: 'info', message: `Root load canceled (${scope})` },
        });
        setState(prev => ({ ...prev, isLoading: false, error: null }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      dispatch({ type: 'ADD_DEBUG_LOG', payload: { scope: 'dir-tree', level: 'error', message: `Root load failed: ${message}` } });
      setState(prev => ({ ...prev, isLoading: false, error: message }));
    }
  }, [dispatch]);

  const expandDirectory = useCallback(async (dirPath: string): Promise<DirEntry | null> => {
    if (!dirPath) return null;
    const scopeQuery = buildScopeQuery(state.scope, state.projectKey);
    const url = `/api/dir-tree?path=${encodeURIComponent(dirPath)}&maxDepth=${EXPAND_DEPTH}&${scopeQuery}`;

    dispatch({ type: 'ADD_DEBUG_LOG', payload: { scope: 'dir-tree', level: 'info', message: `Expand ${dirPath} via ${state.scope}` } });
    setState(prev => ({ ...prev, isExpanding: true, error: null }));
    try {
      const data = await fetchJson<DirTreeExpandResponse>(url);
      if (data.debug) {
        const dbg = data.debug;
        dispatch({
          type: 'ADD_DEBUG_LOG',
          payload: {
            scope: 'dir-tree',
            level: 'info',
            message: `Expand debug ${dirPath}: total=${formatBytes(dbg.totalSize)} files=${(dbg.totalFiles ?? 0).toLocaleString()} scanned=${dbg.entriesScanned ?? 0} symlinks=${dbg.symlinksSeen ?? 0}`,
          },
        });
      }
      const node = data.node || null;
      if (node) {
        dispatch({ type: 'ADD_DEBUG_LOG', payload: { scope: 'dir-tree', level: 'info', message: `Expanded ${dirPath} (${node.children.length} children)` } });
        setState(prev => {
          const next = new Map(prev.expandedNodes);
          next.set(dirPath, node);
          return { ...prev, expandedNodes: next, isExpanding: false };
        });
      } else {
        setState(prev => ({ ...prev, isExpanding: false }));
      }
      return node;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      dispatch({ type: 'ADD_DEBUG_LOG', payload: { scope: 'dir-tree', level: 'error', message: `Expand failed ${dirPath}: ${message}` } });
      setState(prev => ({ ...prev, isExpanding: false, error: message }));
      return null;
    }
  }, [dispatch, state.scope, state.projectKey]);

  return {
    state,
    loadRoot,
    abortLoad,
    expandDirectory,
  };
}
