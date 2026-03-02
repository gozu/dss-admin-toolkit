import { useCallback, useEffect, useRef } from 'react';

const STALL_THRESHOLD_MS = 2000;
const MAX_SYNTHETIC_ADVANCE = 40;
const TAU_MS = 30000;
const TICK_INTERVAL_MS = 250;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export interface ProgressInterpolator {
  setBackendProgress: (value: number) => void;
  reset: (initialValue?: number) => void;
  stop: () => void;
}

export function useProgressInterpolation(
  onProgressChange: (displayValue: number) => void
): ProgressInterpolator {
  const onProgressChangeRef = useRef(onProgressChange);
  const lastRealValueRef = useRef(0);
  const lastRealAtRef = useRef(Date.now());
  const currentDisplayRef = useRef(0);
  const doneRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

  const computeDisplay = useCallback((): number => {
    const now = Date.now();
    const lastReal = clampPercent(lastRealValueRef.current);
    if (doneRef.current) {
      return 100;
    }

    const silentFor = now - lastRealAtRef.current;
    if (silentFor < STALL_THRESHOLD_MS) {
      return Math.max(currentDisplayRef.current, lastReal);
    }

    const interpolationElapsed = silentFor - STALL_THRESHOLD_MS;
    const advance = MAX_SYNTHETIC_ADVANCE * (1 - Math.exp(-interpolationElapsed / TAU_MS));
    const interpolated = lastReal + advance;
    return Math.min(99, Math.max(currentDisplayRef.current, interpolated));
  }, []);

  const emitIfChanged = useCallback((nextValue: number) => {
    const roundedNext = Math.round(nextValue * 10) / 10;
    const roundedPrev = Math.round(currentDisplayRef.current * 10) / 10;
    if (roundedNext === roundedPrev) return;
    currentDisplayRef.current = roundedNext;
    onProgressChangeRef.current(roundedNext);
  }, []);

  const tick = useCallback(() => {
    emitIfChanged(computeDisplay());
  }, [computeDisplay, emitIfChanged]);

  useEffect(() => {
    timerRef.current = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [tick]);

  const setBackendProgress = useCallback(
    (value: number) => {
      const clamped = clampPercent(value);
      lastRealValueRef.current = clamped;
      lastRealAtRef.current = Date.now();
      if (clamped >= 100) {
        doneRef.current = true;
      }
      emitIfChanged(Math.max(currentDisplayRef.current, clamped));
    },
    [emitIfChanged]
  );

  const reset = useCallback(
    (initialValue = 0) => {
      const clamped = clampPercent(initialValue);
      doneRef.current = clamped >= 100;
      lastRealValueRef.current = clamped;
      lastRealAtRef.current = Date.now();
      currentDisplayRef.current = clamped;
      onProgressChangeRef.current(Math.round(clamped * 10) / 10);
    },
    []
  );

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    setBackendProgress,
    reset,
    stop,
  };
}

