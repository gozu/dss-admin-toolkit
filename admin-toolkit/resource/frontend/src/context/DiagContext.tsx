import type { ReactNode } from 'react';
import React, { createContext, useContext, useReducer } from 'react';
import type {
  ExtractedFiles,
  ParsedData,
  DiagType,
  AppMode,
  PageId,
  ComparisonState,
  ComparisonResult,
  ComparisonViewMode,
  DiagFile,
  DiagActionWithComparison,
  DiagStateWithComparison,
  DataSource,
  DebugLevel,
  LayoutMode,
  ApiDirTreeState,
} from '../types';

const DEFAULT_DSSHOME = 'data/dataiku/dss_data/';
const LAYOUT_MODE_STORAGE_KEY = 'diagparser.layoutMode';

const initialComparisonState: ComparisonState = {
  before: null,
  after: null,
  result: null,
  viewMode: 'delta',
  isProcessingBefore: false,
  isProcessingAfter: false,
};

const initialApiDirTreeState: ApiDirTreeState = {
  isLoading: false,
  isExpanding: false,
  error: null,
  tree: null,
  expandedNodes: new Map(),
  scope: 'dss',
  projectKey: '',
};

function loadLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') return 'standard';
  const stored = window.localStorage.getItem(LAYOUT_MODE_STORAGE_KEY);
  return stored === 'ultrawide' ? 'ultrawide' : 'standard';
}

function buildInitialState(layoutMode: LayoutMode): DiagStateWithComparison {
  return {
    // Original state
    extractedFiles: {},
    parsedData: {},
    activeFilter: 'all',
    layoutMode,
    isLoading: false,
    error: null,
    diagType: 'unknown',
    rootFiles: [],
    projectFiles: [],
    dsshome: DEFAULT_DSSHOME,
    originalFile: null,
    dataSource: 'api',
    debugLogs: [],
    apiDirTree: initialApiDirTreeState,
    // New comparison state
    mode: 'single',
    activePage: 'summary' as PageId,
    comparison: initialComparisonState,
  };
}

function diagReducer(
  state: DiagStateWithComparison,
  action: DiagActionWithComparison,
): DiagStateWithComparison {
  switch (action.type) {
    // Original actions
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'SET_EXTRACTED_FILES':
      return { ...state, extractedFiles: action.payload };
    case 'SET_PARSED_DATA': {
      const parsedData = { ...state.parsedData, ...action.payload };
      if (
        Array.isArray(parsedData.provisionalCodeEnvs) &&
        Array.isArray(parsedData.codeEnvs) &&
        parsedData.codeEnvs.length > 0
      ) {
        const realNames = new Set(parsedData.codeEnvs.map((env) => env.name));
        parsedData.provisionalCodeEnvs = parsedData.provisionalCodeEnvs.filter(
          (row) => !realNames.has(row.name),
        );
      }
      return { ...state, parsedData };
    }
    case 'SET_ACTIVE_FILTER':
      return { ...state, activeFilter: action.payload };
    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.payload };
    case 'SET_DIAG_TYPE':
      return { ...state, diagType: action.payload };
    case 'SET_ROOT_FILES':
      return { ...state, rootFiles: action.payload };
    case 'SET_PROJECT_FILES':
      return { ...state, projectFiles: action.payload };
    case 'SET_DSSHOME':
      return { ...state, dsshome: action.payload };
    case 'SET_ORIGINAL_FILE':
      return { ...state, originalFile: action.payload };
    case 'SET_DATA_SOURCE':
      return { ...state, dataSource: action.payload };
    case 'ADD_DEBUG_LOG': {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: action.payload.timestamp || new Date().toISOString(),
        message: action.payload.message,
        scope: action.payload.scope,
        level: action.payload.level,
      };
      return { ...state, debugLogs: [...state.debugLogs, entry] };
    }
    case 'CLEAR_DEBUG_LOGS':
      return { ...state, debugLogs: [] };
    case 'UPSERT_PROVISIONAL_CODE_ENVS': {
      const existing = state.parsedData.provisionalCodeEnvs || [];
      const rowsByName = new Map(existing.map((row) => [row.name, row]));
      action.payload.forEach((row) => {
        const previous = rowsByName.get(row.name);
        rowsByName.set(row.name, {
          ...(previous || {}),
          ...row,
          updatedAt: row.updatedAt || previous?.updatedAt || new Date().toISOString(),
        });
      });
      const realNames = new Set((state.parsedData.codeEnvs || []).map((env) => env.name));
      const mergedRows = Array.from(rowsByName.values())
        .filter((row) => !realNames.has(row.name))
        .sort((a, b) => {
          const ai =
            typeof a.scanIndex === 'number' && Number.isFinite(a.scanIndex)
              ? a.scanIndex
              : Number.MAX_SAFE_INTEGER;
          const bi =
            typeof b.scanIndex === 'number' && Number.isFinite(b.scanIndex)
              ? b.scanIndex
              : Number.MAX_SAFE_INTEGER;
          if (ai !== bi) return ai - bi;
          return a.name.localeCompare(b.name);
        });
      return {
        ...state,
        parsedData: {
          ...state.parsedData,
          provisionalCodeEnvs: mergedRows,
        },
      };
    }
    case 'CLEAR_PROVISIONAL_CODE_ENVS':
      return {
        ...state,
        parsedData: {
          ...state.parsedData,
          provisionalCodeEnvs: [],
        },
      };
    case 'APPEND_PARTIAL_CODE_ENVS': {
      const existing = state.parsedData.codeEnvs || [];
      const keyOf = (env: { language?: string; name?: string }) =>
        `${String(env.language || '').toLowerCase()}:${String(env.name || '')}`;
      const existingKeys = new Set(existing.map((e) => keyOf(e)));
      const newRows = action.payload.filter((e) => !existingKeys.has(keyOf(e)));
      if (newRows.length === 0) return state;
      const newRowNames = new Set(newRows.map((row) => row.name));
      const remainingProvisional = (state.parsedData.provisionalCodeEnvs || []).filter(
        (row) => !newRowNames.has(row.name),
      );
      return {
        ...state,
        parsedData: {
          ...state.parsedData,
          codeEnvs: [...existing, ...newRows],
          provisionalCodeEnvs: remainingProvisional,
        },
      };
    }
    case 'APPEND_PARTIAL_PROJECT_FOOTPRINT': {
      const existing = state.parsedData.projectFootprint || [];
      const existingKeys = new Set(existing.map((r) => r.projectKey));
      const newRows = action.payload.filter((r) => !existingKeys.has(r.projectKey));
      if (newRows.length === 0) return state;
      return {
        ...state,
        parsedData: {
          ...state.parsedData,
          projectFootprint: [...existing, ...newRows],
        },
      };
    }
    case 'SET_API_DIR_TREE':
      return { ...state, apiDirTree: { ...state.apiDirTree, ...action.payload } };
    case 'SET_API_DIR_TREE_EXPANDED_NODE': {
      const next = new Map(state.apiDirTree.expandedNodes);
      next.set(action.payload.path, action.payload.node);
      return { ...state, apiDirTree: { ...state.apiDirTree, expandedNodes: next, isExpanding: false } };
    }
    case 'RESET':
      return buildInitialState(state.layoutMode);

    // New comparison actions
    case 'SET_MODE':
      return { ...state, mode: action.payload };
    case 'SET_ACTIVE_PAGE':
      return { ...state, activePage: action.payload };
    case 'SET_COMPARISON_FILE':
      return {
        ...state,
        comparison: {
          ...state.comparison,
          [action.payload.slot]: action.payload.file,
        },
      };
    case 'CLEAR_COMPARISON_FILE':
      return {
        ...state,
        comparison: {
          ...state.comparison,
          [action.payload]: null,
          result: null, // Clear result when a file is removed
        },
      };
    case 'SET_COMPARISON_RESULT':
      return {
        ...state,
        comparison: {
          ...state.comparison,
          result: action.payload,
        },
      };
    case 'SET_COMPARISON_VIEW_MODE':
      return {
        ...state,
        comparison: {
          ...state.comparison,
          viewMode: action.payload,
        },
      };
    case 'SET_COMPARISON_PROCESSING':
      return {
        ...state,
        comparison: {
          ...state.comparison,
          [action.payload.slot === 'before' ? 'isProcessingBefore' : 'isProcessingAfter']:
            action.payload.isProcessing,
        },
      };
    case 'RESET_COMPARISON':
      return {
        ...state,
        comparison: initialComparisonState,
      };
    default:
      return state;
  }
}

interface DiagContextValue {
  state: DiagStateWithComparison;
  dispatch: React.Dispatch<DiagActionWithComparison>;
  // Original convenience methods
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setExtractedFiles: (files: ExtractedFiles) => void;
  setParsedData: (data: Partial<ParsedData>) => void;
  setActiveFilter: (filter: string) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setDiagType: (type: DiagType) => void;
  setRootFiles: (files: string[]) => void;
  setProjectFiles: (files: string[]) => void;
  setDsshome: (path: string) => void;
  setOriginalFile: (file: File | null) => void;
  setDataSource: (source: DataSource) => void;
  addDebugLog: (message: string, scope?: string, level?: DebugLevel) => void;
  clearDebugLogs: () => void;
  reset: () => void;
  // New comparison convenience methods
  setMode: (mode: AppMode) => void;
  setActivePage: (page: PageId) => void;
  setComparisonFile: (slot: 'before' | 'after', file: DiagFile) => void;
  clearComparisonFile: (slot: 'before' | 'after') => void;
  setComparisonResult: (result: ComparisonResult) => void;
  setComparisonViewMode: (mode: ComparisonViewMode) => void;
  setComparisonProcessing: (slot: 'before' | 'after', isProcessing: boolean) => void;
  resetComparison: () => void;
}

const DiagContext = createContext<DiagContextValue | undefined>(undefined);

export function DiagProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(diagReducer, undefined, () =>
    buildInitialState(loadLayoutMode()),
  );

  const value: DiagContextValue = {
    state,
    dispatch,
    // Original methods
    setLoading: (loading) => dispatch({ type: 'SET_LOADING', payload: loading }),
    setError: (error) => dispatch({ type: 'SET_ERROR', payload: error }),
    setExtractedFiles: (files) => dispatch({ type: 'SET_EXTRACTED_FILES', payload: files }),
    setParsedData: (data) => dispatch({ type: 'SET_PARSED_DATA', payload: data }),
    setActiveFilter: (filter) => dispatch({ type: 'SET_ACTIVE_FILTER', payload: filter }),
    setLayoutMode: (mode) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode);
      }
      dispatch({ type: 'SET_LAYOUT_MODE', payload: mode });
    },
    setDiagType: (type) => dispatch({ type: 'SET_DIAG_TYPE', payload: type }),
    setRootFiles: (files) => dispatch({ type: 'SET_ROOT_FILES', payload: files }),
    setProjectFiles: (files) => dispatch({ type: 'SET_PROJECT_FILES', payload: files }),
    setDsshome: (path) => dispatch({ type: 'SET_DSSHOME', payload: path }),
    setOriginalFile: (file) => dispatch({ type: 'SET_ORIGINAL_FILE', payload: file }),
    setDataSource: (source) => dispatch({ type: 'SET_DATA_SOURCE', payload: source }),
    addDebugLog: (message, scope, level = 'info') =>
      dispatch({
        type: 'ADD_DEBUG_LOG',
        payload: { message, scope, level },
      }),
    clearDebugLogs: () => dispatch({ type: 'CLEAR_DEBUG_LOGS' }),
    reset: () => dispatch({ type: 'RESET' }),
    // New comparison methods
    setMode: (mode) => dispatch({ type: 'SET_MODE', payload: mode }),
    setActivePage: (page) => dispatch({ type: 'SET_ACTIVE_PAGE', payload: page }),
    setComparisonFile: (slot, file) =>
      dispatch({ type: 'SET_COMPARISON_FILE', payload: { slot, file } }),
    clearComparisonFile: (slot) => dispatch({ type: 'CLEAR_COMPARISON_FILE', payload: slot }),
    setComparisonResult: (result) => dispatch({ type: 'SET_COMPARISON_RESULT', payload: result }),
    setComparisonViewMode: (mode) => dispatch({ type: 'SET_COMPARISON_VIEW_MODE', payload: mode }),
    setComparisonProcessing: (slot, isProcessing) =>
      dispatch({ type: 'SET_COMPARISON_PROCESSING', payload: { slot, isProcessing } }),
    resetComparison: () => dispatch({ type: 'RESET_COMPARISON' }),
  };

  return <DiagContext.Provider value={value}>{children}</DiagContext.Provider>;
}

export function useDiag(): DiagContextValue {
  const context = useContext(DiagContext);
  if (context === undefined) {
    throw new Error('useDiag must be used within a DiagProvider');
  }
  return context;
}

export { DEFAULT_DSSHOME };
