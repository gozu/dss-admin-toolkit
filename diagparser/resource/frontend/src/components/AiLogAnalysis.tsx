import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiag } from '../context/DiagContext';
import { useTableFilter } from '../hooks/useTableFilter';
import type { LlmOption, LogError } from '../types';

const DEFAULT_AI_SYSTEM_PROMPT = `You are an expert Dataiku DSS administrator and backend engineer analyzing error logs from a DSS instance's backend.log file.

Only analyze lines with log4j level WARN, ERROR, FATAL, or SEVERE. Ignore INFO/DEBUG/TRACE.
For severity use the EXACT log4j level from the log line. Do not invent severities.

For each distinct error pattern:
- Identify the root cause.
- Tag with its log4j level (e.g. ERROR, WARN, FATAL).
- Provide specific actionable remediation steps, citing doc.dataiku.com or KB links when available.
- Group related errors sharing a root cause.
- Highlight data loss, security, or service outage risks.

Format: markdown. Start with a 2-3 sentence Executive Summary. Then one heading per issue (include the log4j level in the heading) with bullet-point remediation.`;

interface AnalysisState {
  phase: string;
  text: string;
  llmId: string;
  logCharsAnalyzed: number;
  done: boolean;
}

function buildCuratedLogData(rawLogErrors: LogError[]): string {
  return rawLogErrors.map((block) => block.data.join('\n')).join('\n---\n');
}

export function AiLogAnalysis() {
  const { state } = useDiag();
  const { isVisible } = useTableFilter();
  const rawLogErrors = state.parsedData.rawLogErrors || [];

  const [llms, setLlms] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState('');
  const [isLoadingLlms, setIsLoadingLlms] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [error, setError] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const curatedLogData = useMemo(
    () => (rawLogErrors.length ? buildCuratedLogData(rawLogErrors) : ''),
    [rawLogErrors],
  );

  const [editableContent, setEditableContent] = useState(
    () => `${DEFAULT_AI_SYSTEM_PROMPT}\n\n---\n\n${buildCuratedLogData(rawLogErrors)}`,
  );

  useEffect(() => {
    if (!rawLogErrors.length) return;
    setEditableContent(
      `${DEFAULT_AI_SYSTEM_PROMPT}\n\n---\n\n${buildCuratedLogData(rawLogErrors)}`,
    );
  }, [rawLogErrors]);

  useEffect(() => {
    fetch('/api/llms', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<{ llms: LlmOption[]; error?: string }>)
      .then((data) => {
        setLlms(data.llms || []);
        if (data.llms?.length) setSelectedLlmId(data.llms[0].id);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setIsLoadingLlms(false));
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!selectedLlmId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsAnalyzing(true);
    setError('');
    setAnalysis({ phase: 'Starting', text: '', llmId: '', logCharsAnalyzed: 0, done: false });

    const sep = editableContent.indexOf('\n\n---\n\n');
    const systemPrompt = sep !== -1 ? editableContent.slice(0, sep) : '';
    const userMessage = sep !== -1 ? editableContent.slice(sep + 7) : editableContent;

    try {
      const response = await fetch('/api/logs/ai-analysis', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmId: selectedLlmId, systemPrompt, userMessage }),
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
            setAnalysis((prev) => (prev ? { ...prev, phase: String(payload.phase || '') } : prev));
          } else if (eventType === 'chunk') {
            setAnalysis((prev) =>
              prev
                ? { ...prev, text: prev.text + String(payload.text || ''), phase: 'Generating analysis' }
                : prev,
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
                  }
                : prev,
            );
          } else if (eventType === 'error') {
            setError(String(payload.error || 'Unknown error'));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setError('Analysis aborted.');
      } else {
        setError(String(err));
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedLlmId, editableContent]);

  if (!isVisible('ai-log-analysis') || !rawLogErrors.length) return null;

  const showResult = analysis && (analysis.text || analysis.done);
  const phaseLabel = analysis && !analysis.done ? analysis.phase : null;

  return (
    <div
      className="bg-[var(--bg-surface)] rounded-xl shadow-md overflow-hidden border border-[var(--border-glass)] col-span-full"
      id="ai-log-analysis"
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)] flex items-center justify-between">
        <h4 className="text-lg font-semibold text-[var(--text-primary)]">AI Log Analysis</h4>
        <span className="text-xs text-[var(--text-secondary)]">
          {curatedLogData.length.toLocaleString()} chars of curated log context
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
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
                className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-glass)] text-[var(--text-primary)]"
              >
                {llms.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              {isAnalyzing ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:opacity-90"
                >
                  Abort
                </button>
              ) : (
                <button
                  onClick={() => setShowDisclaimer(true)}
                  disabled={!selectedLlmId}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--neon-cyan)]/80 text-white hover:opacity-90 disabled:opacity-50"
                >
                  Run AI Analysis
                </button>
              )}
              {phaseLabel && !showResult && (
                <span className="text-sm text-[var(--text-secondary)] italic">{phaseLabel}...</span>
              )}
            </>
          )}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">
            Prompt preview (system prompt + curated errors, separated by <code>---</code>)
          </label>
          <textarea
            value={editableContent}
            onChange={(e) => setEditableContent(e.target.value)}
            rows={14}
            className="w-full p-2 text-xs font-mono rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-glass)] text-[var(--text-primary)] resize-y"
          />
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            {editableContent.length.toLocaleString()} chars total
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-400">
            {error}
          </div>
        )}

        {showResult && (
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-glass)] p-4">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border-glass)]">
              <span className="text-sm font-medium text-[var(--neon-cyan)]">AI Analysis</span>
              {analysis.done && analysis.llmId && (
                <span className="text-xs text-[var(--text-secondary)]">
                  {analysis.llmId} · {(analysis.logCharsAnalyzed / 1000).toFixed(1)}K chars analyzed
                </span>
              )}
            </div>
            <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)] font-sans leading-relaxed">
              {analysis.text}
            </pre>
          </div>
        )}
      </div>

      {showDisclaimer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowDisclaimer(false)}
        >
          <div
            className="mx-4 max-w-md rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-glass)] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Disclaimer</h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              AI-generated analysis may be <strong className="text-[var(--text-primary)]">inaccurate, incomplete, or misleading</strong>.
              LLMs can hallucinate error causes and suggest incorrect remediation.
            </p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Always verify findings against official Dataiku documentation before taking action.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDisclaimer(false)}
                className="px-4 py-2 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDisclaimer(false);
                  runAnalysis();
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--neon-cyan)]/80 text-white hover:opacity-90"
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
