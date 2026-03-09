import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchJson, getBackendUrl } from '../utils/api';
import type { LlmOption } from '../types';

const DEFAULT_SYSTEM_PROMPT = `You are an expert Dataiku DSS administrator and backend engineer analyzing error logs from a DSS instance's backend.log file.

Your task:
1. Identify the root cause of each distinct error or error pattern.
2. Assess severity (Critical / Warning / Informational).
3. Provide specific, actionable remediation steps.
4. Group related errors sharing a root cause.
5. Highlight data loss risk, security issues, or service outage indicators.

Format: markdown with headings per issue, bullet points for remediation. Start with a 2-3 sentence Executive Summary.`;

interface AnalysisState {
  phase: string;
  text: string;
  llmId: string;
  logCharsAnalyzed: number;
  done: boolean;
}

export function AiLogAnalysis() {
  const [llms, setLlms] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState('');
  const [isLoadingLlms, setIsLoadingLlms] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchJson<{ llms: LlmOption[]; error?: string }>('/api/llms')
      .then((data) => {
        setLlms(data.llms);
        if (data.llms.length > 0) setSelectedLlmId(data.llms[0].id);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setIsLoadingLlms(false));
  }, []);

  const runAnalysis = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsAnalyzing(true);
    setError('');
    setAnalysis({ phase: 'Starting', text: '', llmId: '', logCharsAnalyzed: 0, done: false });

    try {
      const url = getBackendUrl('/api/logs/ai-analysis');
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmId: selectedLlmId, systemPrompt: systemPrompt.trim() }),
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
  }, [selectedLlmId, systemPrompt]);

  const showResult = analysis && (analysis.text || analysis.done);
  const phaseLabel = analysis && !analysis.done ? analysis.phase : null;
  const isPromptModified = systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT;

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
            <select
              value={selectedLlmId}
              onChange={(e) => setSelectedLlmId(e.target.value)}
              disabled={isAnalyzing}
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)]
                         text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]
                         disabled:opacity-50"
            >
              {llms.map((llm) => (
                <option key={llm.id} value={llm.id}>
                  {llm.label}
                </option>
              ))}
            </select>
            <button
              onClick={runAnalysis}
              disabled={isAnalyzing}
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
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--text-tertiary)]
                         hover:text-[var(--text-secondary)] transition-colors"
              title="Advanced settings"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Advanced
              {isPromptModified && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" title="Prompt modified" />
              )}
            </button>
            {phaseLabel && !showResult && (
              <span className="text-sm text-[var(--text-secondary)] italic">{phaseLabel}...</span>
            )}
          </>
        )}
      </div>

      {showAdvanced && (
        <div className="mt-2 p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)]">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">System Prompt</label>
            {isPromptModified && (
              <button
                onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Reset to default
              </button>
            )}
          </div>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={isAnalyzing}
            rows={10}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-[var(--bg-primary)] border border-[var(--border-default)]
                       text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]
                       disabled:opacity-50 resize-y"
          />
        </div>
      )}

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
    </div>
  );
}
