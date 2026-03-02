import { useCallback, useSyncExternalStore } from 'react';

export interface ThresholdSettings {
  codeEnvCountUnhealthy: number;
  codeStudioCountUnhealthy: number;
  filesystemWarningPct: number;
  filesystemCriticalPct: number;
  openFilesMinimum: number;
  javaHeapMinimumMB: number;
}

const DEFAULT_THRESHOLDS: ThresholdSettings = {
  codeEnvCountUnhealthy: 1,
  codeStudioCountUnhealthy: 7,
  filesystemWarningPct: 70,
  filesystemCriticalPct: 90,
  openFilesMinimum: 65535,
  javaHeapMinimumMB: 2048,
};

const STORAGE_KEY = 'diagparser.thresholds';

let listeners: Array<() => void> = [];
let cached: ThresholdSettings | null = null;

function read(): ThresholdSettings {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = raw ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) } : { ...DEFAULT_THRESHOLDS };
  } catch {
    cached = { ...DEFAULT_THRESHOLDS };
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
    write({ ...DEFAULT_THRESHOLDS });
  }, []);

  return { thresholds, setThreshold, resetDefaults, defaults: DEFAULT_THRESHOLDS };
}
