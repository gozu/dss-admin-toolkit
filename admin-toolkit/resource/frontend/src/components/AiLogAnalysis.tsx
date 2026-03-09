import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchJson } from '../utils/api';
import type { LlmOption, AiAnalysisResponse } from '../types';

export function AiLogAnalysis() {
  const [llms, setLlms] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState('');
  const [isLoadingLlms, setIsLoadingLlms] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AiAnalysisResponse | null>(null);
  const [error, setError] = useState('');

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

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setError('');
    setResult(null);
    try {
      const data = await fetchJson<AiAnalysisResponse>('/api/logs/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmId: selectedLlmId }),
      });
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

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
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)]
                         text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
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
                  Analyzing...
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
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-lg bg-[var(--status-danger-bg)] border border-[var(--status-danger-border)] text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {result && (
        <div className="ai-analysis-result mt-3">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border-default)]">
            <span className="text-sm font-medium text-[var(--accent)]">AI Analysis</span>
            <span className="text-xs text-[var(--text-tertiary)]">
              {result.llmId} &middot; {(result.logCharsAnalyzed / 1000).toFixed(1)}K chars analyzed
            </span>
          </div>
          <div className="ai-analysis-markdown">
            <ReactMarkdown>{result.analysis}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
