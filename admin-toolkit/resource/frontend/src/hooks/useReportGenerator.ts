import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { fetchJson, getBackendUrl } from '../utils/api';
import { prepareReportData, type ReportData } from '../utils/prepareReportData';
import type { ParsedData, LlmOption } from '../types';

export type ReportStatus = 'idle' | 'selecting-llm' | 'generating' | 'ready' | 'viewing';

interface UseReportGeneratorReturn {
  status: ReportStatus;
  phase: string;
  llms: LlmOption[];
  isLoadingLlms: boolean;
  selectedLlmLabel: string;
  setSelectedLlmLabel: (label: string) => void;
  generate: (parsedData: ParsedData) => void;
  reportData: ReportData | null;
  error: string;
  retry: () => void;
  isOverlayOpen: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
  openSelector: () => void;
  closeSelector: () => void;
}

const REPORT_TIMEOUT_MS = 180_000;

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

export function useReportGenerator(): UseReportGeneratorReturn {
  const [status, setStatus] = useState<ReportStatus>('idle');
  const [phase, setPhase] = useState('');
  const [llms, setLlms] = useState<LlmOption[]>([]);
  const [isLoadingLlms, setIsLoadingLlms] = useState(false);
  const [selectedLlmLabel, setSelectedLlmLabel] = useState('');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOutRef = useRef(false);
  const lastParsedDataRef = useRef<ParsedData | null>(null);

  // Label → ID mapping
  const llmMap = useMemo(() => new Map(llms.map(l => [l.label, l.id])), [llms]);

  // Fetch LLMs on first selector open
  const fetchLlms = useCallback(async () => {
    if (llms.length > 0 || isLoadingLlms) return;
    setIsLoadingLlms(true);
    try {
      const data = await fetchJson<{ llms: LlmOption[]; error?: string }>('/api/llms');
      setLlms(data.llms); // Show ALL model types (no HuggingFace filter)
      if (data.llms.length > 0) {
        setSelectedLlmLabel(data.llms[0].label);
      }
      if (data.error) setError(data.error);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoadingLlms(false);
    }
  }, [llms.length, isLoadingLlms]);

  const openSelector = useCallback(() => {
    setStatus('selecting-llm');
    setError('');
    fetchLlms();
  }, [fetchLlms]);

  const closeSelector = useCallback(() => {
    if (status === 'selecting-llm') {
      setStatus(reportData ? 'ready' : 'idle');
    }
  }, [status, reportData]);

  const generate = useCallback((parsedData: ParsedData) => {
    const llmId = llmMap.get(selectedLlmLabel);
    if (!llmId) return;

    lastParsedDataRef.current = parsedData;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('generating');
    setPhase('Preparing data');
    setError('');
    setReportData(null);

    // Timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timedOutRef.current = false;
    timeoutRef.current = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, REPORT_TIMEOUT_MS);

    const diagnosticData = prepareReportData(parsedData);

    (async () => {
      try {
        const url = getBackendUrl('/api/report/generate');
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ llmId, diagnosticData }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.text();
          throw new Error(`Request failed: ${response.status} ${response.statusText} - ${body.slice(0, 240)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const eventMatch = part.match(/^event:\s*(\S+)/m);
            const dataMatch = part.match(/^data:\s*(.*)/m);
            if (!eventMatch || !dataMatch) continue;

            const eventType = eventMatch[1];
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(dataMatch[1]);
            } catch {
              continue;
            }

            if (eventType === 'phase') {
              setPhase(String(payload.phase || ''));
            } else if (eventType === 'done') {
              const jsonStr = stripMarkdownFences(String(payload.report || '{}'));
              try {
                const parsed = JSON.parse(jsonStr) as ReportData;
                setReportData(parsed);
                setStatus('ready');
                setPhase('Complete');
              } catch {
                setError('Failed to parse report data from LLM. The model may have returned invalid JSON. Try again or select a different model.');
                setStatus('idle');
              }
            } else if (eventType === 'error') {
              setError(String(payload.error || 'Unknown error'));
              setStatus('idle');
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setError(
            timedOutRef.current
              ? 'Report generation timed out (180s). Try selecting a faster model.'
              : 'Report generation cancelled.',
          );
        } else {
          setError(String(err));
        }
        setStatus('idle');
      } finally {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
    })();
  }, [selectedLlmLabel, llmMap]);

  const retry = useCallback(() => {
    if (lastParsedDataRef.current) {
      generate(lastParsedDataRef.current);
    }
  }, [generate]);

  const openOverlay = useCallback(() => {
    setIsOverlayOpen(true);
    setStatus('viewing');
  }, []);

  const closeOverlay = useCallback(() => {
    setIsOverlayOpen(false);
    setStatus('ready');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return {
    status, phase, llms: llms, isLoadingLlms,
    selectedLlmLabel, setSelectedLlmLabel,
    generate, reportData, error, retry,
    isOverlayOpen, openOverlay, closeOverlay,
    openSelector, closeSelector,
  };
}
