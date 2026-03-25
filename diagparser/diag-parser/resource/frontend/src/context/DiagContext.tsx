import type { ReactNode } from 'react';
import React, { createContext, useContext, useReducer } from 'react';
import type {
  ExtractedFiles,
  ParsedData,
  DiagType,
  AppMode,
  ComparisonState,
  ComparisonResult,
  ComparisonViewMode,
  DiagFile,
  DiagActionWithComparison,
  DiagStateWithComparison,
} from '../types';

const DEFAULT_DSSHOME = 'data/dataiku/dss_data/';

const initialComparisonState: ComparisonState = {
  before: null,
  after: null,
  result: null,
  viewMode: 'delta',
  isProcessingBefore: false,
  isProcessingAfter: false,
};

const initialState: DiagStateWithComparison = {
  // Original state
  extractedFiles: {},
  parsedData: {},
  activeFilter: 'all',
  isLoading: false,
  error: null,
  diagType: 'unknown',
  rootFiles: [],
  projectFiles: [],
  dsshome: DEFAULT_DSSHOME,
  originalFile: null,
  // New comparison state
  mode: 'landing',
  comparison: initialComparisonState,
};

function diagReducer(state: DiagStateWithComparison, action: DiagActionWithComparison): DiagStateWithComparison {
  switch (action.type) {
    // Original actions
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'SET_EXTRACTED_FILES':
      return { ...state, extractedFiles: action.payload };
    case 'SET_PARSED_DATA':
      return { ...state, parsedData: { ...state.parsedData, ...action.payload } };
    case 'SET_ACTIVE_FILTER':
      return { ...state, activeFilter: action.payload };
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
    case 'RESET':
      return initialState;

    // New comparison actions
    case 'SET_MODE':
      return { ...state, mode: action.payload };
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
          [action.payload.slot === 'before' ? 'isProcessingBefore' : 'isProcessingAfter']: action.payload.isProcessing,
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
  setDiagType: (type: DiagType) => void;
  setRootFiles: (files: string[]) => void;
  setProjectFiles: (files: string[]) => void;
  setDsshome: (path: string) => void;
  setOriginalFile: (file: File | null) => void;
  reset: () => void;
  // New comparison convenience methods
  setMode: (mode: AppMode) => void;
  setComparisonFile: (slot: 'before' | 'after', file: DiagFile) => void;
  clearComparisonFile: (slot: 'before' | 'after') => void;
  setComparisonResult: (result: ComparisonResult) => void;
  setComparisonViewMode: (mode: ComparisonViewMode) => void;
  setComparisonProcessing: (slot: 'before' | 'after', isProcessing: boolean) => void;
  resetComparison: () => void;
}

const DiagContext = createContext<DiagContextValue | undefined>(undefined);

export function DiagProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(diagReducer, initialState);

  const value: DiagContextValue = {
    state,
    dispatch,
    // Original methods
    setLoading: (loading) => dispatch({ type: 'SET_LOADING', payload: loading }),
    setError: (error) => dispatch({ type: 'SET_ERROR', payload: error }),
    setExtractedFiles: (files) => dispatch({ type: 'SET_EXTRACTED_FILES', payload: files }),
    setParsedData: (data) => dispatch({ type: 'SET_PARSED_DATA', payload: data }),
    setActiveFilter: (filter) => dispatch({ type: 'SET_ACTIVE_FILTER', payload: filter }),
    setDiagType: (type) => dispatch({ type: 'SET_DIAG_TYPE', payload: type }),
    setRootFiles: (files) => dispatch({ type: 'SET_ROOT_FILES', payload: files }),
    setProjectFiles: (files) => dispatch({ type: 'SET_PROJECT_FILES', payload: files }),
    setDsshome: (path) => dispatch({ type: 'SET_DSSHOME', payload: path }),
    setOriginalFile: (file) => dispatch({ type: 'SET_ORIGINAL_FILE', payload: file }),
    reset: () => dispatch({ type: 'RESET' }),
    // New comparison methods
    setMode: (mode) => dispatch({ type: 'SET_MODE', payload: mode }),
    setComparisonFile: (slot, file) => dispatch({ type: 'SET_COMPARISON_FILE', payload: { slot, file } }),
    clearComparisonFile: (slot) => dispatch({ type: 'CLEAR_COMPARISON_FILE', payload: slot }),
    setComparisonResult: (result) => dispatch({ type: 'SET_COMPARISON_RESULT', payload: result }),
    setComparisonViewMode: (mode) => dispatch({ type: 'SET_COMPARISON_VIEW_MODE', payload: mode }),
    setComparisonProcessing: (slot, isProcessing) => dispatch({ type: 'SET_COMPARISON_PROCESSING', payload: { slot, isProcessing } }),
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
