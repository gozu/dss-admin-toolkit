import { useCallback, useSyncExternalStore } from 'react';

export interface ThresholdSettings {
  // === Main Settings ===
  // Check thresholds
  codeEnvCountUnhealthy: number;
  codeStudioCountUnhealthy: number;
  filesystemWarningPct: number;
  filesystemCriticalPct: number;
  largeFlowThreshold: number;
  inactiveProjectDays: number;
  emptyProjectBytes: number;
  orphanNotebookMinCount: number;
  highFreqScenarioMinutes: number;
  deprecatedPythonPrefixes: string;
  disabledFeaturesSeverityCutoff: number;

  // === Advanced Settings ===
  // Version & system thresholds
  openFilesMinimum: number;
  javaHeapMinimumMB: number;
  pythonCriticalBelow: string;
  pythonWarningBelow: string;
  sparkVersionMinimum: number;
  projectCountWarning: number;

  // Health scoring weights
  weightCodeEnvs: number;
  weightProjectFootprint: number;
  weightSystemCapacity: number;
  weightSecurityIsolation: number;
  weightVersionCurrency: number;
  weightRuntimeConfig: number;
  healthCriticalBelow: number;
  healthWarningBelow: number;

  // Log parsing
  logLinesBefore: number;
  logLinesAfter: number;
  logTimeThresholdSec: number;
  logMaxErrors: number;

  // Scan limits
  largeFileThresholdGB: number;
  dirTreeDefaultDepth: number;
  fileViewerMaxLines: number;
  syntaxHighlightMaxKB: number;
}

const DEFAULT_THRESHOLDS: ThresholdSettings = {
  // Main Settings
  codeEnvCountUnhealthy: 1,
  codeStudioCountUnhealthy: 7,
  filesystemWarningPct: 70,
  filesystemCriticalPct: 90,
  largeFlowThreshold: 100,
  inactiveProjectDays: 180,
  emptyProjectBytes: 1048576,
  orphanNotebookMinCount: 5,
  highFreqScenarioMinutes: 30,
  deprecatedPythonPrefixes: '2.,3.6,3.7',
  disabledFeaturesSeverityCutoff: 5,

  // Advanced Settings
  openFilesMinimum: 65535,
  javaHeapMinimumMB: 2048,
  pythonCriticalBelow: '3.8',
  pythonWarningBelow: '3.10',
  sparkVersionMinimum: 3,
  projectCountWarning: 500,

  weightCodeEnvs: 0.35,
  weightProjectFootprint: 0.30,
  weightSystemCapacity: 0.15,
  weightSecurityIsolation: 0.10,
  weightVersionCurrency: 0.05,
  weightRuntimeConfig: 0.05,
  healthCriticalBelow: 50,
  healthWarningBelow: 80,

  logLinesBefore: 10,
  logLinesAfter: 100,
  logTimeThresholdSec: 5,
  logMaxErrors: 5,

  largeFileThresholdGB: 100,
  dirTreeDefaultDepth: 3,
  fileViewerMaxLines: 10000,
  syntaxHighlightMaxKB: 500,
};

const STORAGE_KEY = 'diagparser.thresholds';

let listeners: Array<() => void> = [];
let cached: ThresholdSettings | null = null;
let serverDefaults: Partial<ThresholdSettings> = {};

// Fetch plugin.json threshold defaults once on module load
fetch('/api/settings/threshold-defaults')
  .then((r) => (r.ok ? r.json() : {}))
  .then((data: Partial<ThresholdSettings>) => {
    if (Object.keys(data).length > 0) {
      serverDefaults = data;
      cached = null;
      for (const fn of listeners) fn();
    }
  })
  .catch(() => {});

function read(): ThresholdSettings {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    cached = { ...DEFAULT_THRESHOLDS, ...serverDefaults, ...stored };
  } catch {
    cached = { ...DEFAULT_THRESHOLDS, ...serverDefaults };
  }
  return cached as ThresholdSettings;
}

function write(next: ThresholdSettings) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  for (const fn of listeners) fn();
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((fn) => fn !== cb);
  };
}

function getSnapshot(): ThresholdSettings {
  return read();
}

export function useThresholds() {
  const thresholds = useSyncExternalStore(subscribe, getSnapshot);

  const setThreshold = useCallback(<K extends keyof ThresholdSettings>(key: K, value: ThresholdSettings[K]) => {
    const current = read();
    write({ ...current, [key]: value });
  }, []);

  const resetDefaults = useCallback(() => {
    write({ ...DEFAULT_THRESHOLDS, ...serverDefaults });
  }, []);

  return { thresholds, setThreshold, resetDefaults, defaults: { ...DEFAULT_THRESHOLDS, ...serverDefaults } };
}
