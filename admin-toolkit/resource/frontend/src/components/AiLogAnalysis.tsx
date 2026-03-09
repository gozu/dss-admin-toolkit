import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchJson, getBackendUrl } from '../utils/api';
import { loadFromStorage } from '../utils/storage';
import { SearchableCombobox } from './SearchableCombobox';
import type { LlmOption } from '../types';

export const DEFAULT_AI_SYSTEM_PROMPT = `You are an expert Dataiku DSS administrator and backend engineer analyzing error logs from a DSS instance's backend.log file.

Before answering, think step-by-step through each error carefully. For each error pattern:
- Reason through what component, subsystem, or configuration could cause it.
- Search the web for the specific error message, Java exception, or stack trace to find known issues, Dataiku Knowledge Base articles, community posts, or release notes.
- Cross-reference with official Dataiku documentation (doc.dataiku.com) for configuration guidance, known limitations, and recommended fixes.
- Only after researching, provide your diagnosis and remediation.

Your task:
1. Identify the root cause of each distinct error or error pattern.
2. Assess severity (Critical / Warning / Informational).
3. Provide specific, actionable remediation steps, including links to relevant documentation or KB articles when available.
4. Group related errors sharing a root cause.
5. Highlight data loss risk, security issues, or service outage indicators.

Format: markdown with headings per issue, bullet points for remediation. Start with a 2-3 sentence Executive Summary.`;

export const AI_PROMPT_STORAGE_KEY = 'aiLogAnalysisPrompt';

interface AnalysisState {
  phase: string;
  text: string;
  llmId: string;
  logCharsAnalyzed: number;
  done: boolean;
}

export function AiLogAnalysis() {
  const [llms, setLlms] = useState<LlmOption[]>([]);
  const [selectedLlmLabel, setSelectedLlmLabel] = useState('');
  const [isLoadingLlms, setIsLoadingLlms] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [error, setError] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const konamiRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const filteredLlms = useMemo(() => {
    if (unlocked) return llms;
    return llms.filter((l) => l.type === 'HUGGINGFACE_TRANSFORMER_LOCAL');
  }, [llms, unlocked]);

  const llmLabelToId = useMemo(() => {
    const map = new Map<string, string>();
    for (const llm of filteredLlms) map.set(llm.label, llm.id);
    return map;
  }, [filteredLlms]);

  const llmLabels = useMemo(() => filteredLlms.map((l) => l.label), [filteredLlms]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      konamiRef.current += e.key.toLowerCase();
      if (konamiRef.current.length > 20) konamiRef.current = konamiRef.current.slice(-20);
      if (konamiRef.current.includes('kaos')) {
        setUnlocked(true);
        window.removeEventListener('keydown', handler);
      }
    };
    if (!unlocked) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [unlocked]);

  useEffect(() => {
    fetchJson<{ llms: LlmOption[]; error?: string }>('/api/llms')
      .then((data) => {
        setLlms(data.llms);
        const hfLlms = data.llms.filter((l) => l.type === 'HUGGINGFACE_TRANSFORMER_LOCAL');
        const initial = hfLlms.length > 0 ? hfLlms[0] : data.llms[0];
        if (initial) setSelectedLlmLabel(initial.label);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setIsLoadingLlms(false));
  }, []);

  const runAnalysis = useCallback(async () => {
    const llmId = llmLabelToId.get(selectedLlmLabel);
    if (!llmId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsAnalyzing(true);
    setError('');
    setAnalysis({ phase: 'Starting', text: '', llmId: '', logCharsAnalyzed: 0, done: false });

    const storedPrompt = loadFromStorage<string>(AI_PROMPT_STORAGE_KEY, '');
    const systemPrompt = storedPrompt.trim() || DEFAULT_AI_SYSTEM_PROMPT;

    try {
      const url = getBackendUrl('/api/logs/ai-analysis');
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmId, systemPrompt }),
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
            setAnalysis((prev) =>
              prev ? { ...prev, phase: String(payload.phase || '') } : prev,
            );
          } else if (eventType === 'chunk') {
            setAnalysis((prev) =>
              prev ? { ...prev, text: prev.text + String(payload.text || ''), phase: 'Generating analysis' } : prev,
            );
          } else if (eventType === 'done') {
            setAnalysis((prev) =>
              prev
                ? {
                    ...prev,
                    done: true,
                    phase: 'Complete',
                    llmId: String(payload.llmId || prev.llmId),
                    logCharsAnalyzed: Number(payload.logCharsAnalyzed) || prev.logCharsAnalyzed,
                    ...(payload.analysis ? { text: String(payload.analysis) } : {}),
                  }
                : prev,
            );
          } else if (eventType === 'error') {
            setError(String(payload.error || 'Unknown error'));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(String(err));
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedLlmLabel, llmLabelToId]);

  const showResult = analysis && (analysis.text || analysis.done);
  const phaseLabel = analysis && !analysis.done ? analysis.phase : null;
  const hasValidSelection = llmLabelToId.has(selectedLlmLabel);

  return (
    <div className="mb-4">
      <div className="ai-analysis-toolbar">
        {isLoadingLlms ? (
          <span className="text-sm text-[var(--text-secondary)]">Loading LLMs...</span>
        ) : llms.length === 0 ? (
          <span className="text-sm text-[var(--text-secondary)]">
            No LLMs available — configure an LLM connection in this project to enable AI analysis.
          </span>
        ) : (
          <>
            <div className="w-64">
              <SearchableCombobox
                value={selectedLlmLabel}
                onChange={setSelectedLlmLabel}
                options={llmLabels}
                placeholder="Search LLMs..."
                className="w-full px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)]
                           text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]
                           disabled:opacity-50"
              />
            </div>
            <button
              onClick={() => setShowDisclaimer(true)}
              disabled={isAnalyzing || !hasValidSelection}
              className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg
                         bg-[var(--accent)] text-white hover:opacity-90 transition-opacity
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                  </svg>
                  {phaseLabel || 'Analyzing...'}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI Log Analysis
                </>
              )}
            </button>
            {phaseLabel && !showResult && (
              <span className="text-sm text-[var(--text-secondary)] italic">{phaseLabel}...</span>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {showResult && (
        <div className="ai-analysis-result mt-3">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--accent)]">AI Analysis</span>
              {!analysis.done && (
                <svg className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {analysis.done && analysis.llmId && (
              <span className="text-xs text-[var(--text-tertiary)]">
                {analysis.llmId} &middot; {(analysis.logCharsAnalyzed / 1000).toFixed(1)}K chars analyzed
              </span>
            )}
          </div>
          <div className="ai-analysis-markdown">
            <ReactMarkdown>{analysis.text}</ReactMarkdown>
          </div>
        </div>
      )}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDisclaimer(false)}>
          <div
            className="mx-4 max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] flex items-center justify-center">
                <svg className="w-5 h-5 text-[var(--neon-amber)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Disclaimer</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              AI-generated analysis may be <strong className="text-[var(--text-primary)]">inaccurate, incomplete, or misleading</strong>.
              LLMs can hallucinate error causes and suggest incorrect remediation steps.
            </p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Always verify findings against official Dataiku documentation and your own system knowledge before taking any action.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDisclaimer(false)}
                className="px-4 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowDisclaimer(false); runAnalysis(); }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                I understand, proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
