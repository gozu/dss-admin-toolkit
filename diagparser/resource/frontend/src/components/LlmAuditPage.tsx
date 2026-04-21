import { useEffect, useRef } from 'react';
import { useDiag } from '../context/DiagContext';
import { buildLookup, classifyRow } from '../lib/llmAudit';
import { LlmAuditTable } from './LlmAuditTable';
import type { LlmAuditRow } from '../types';

export function LlmAuditPage() {
  const { state, setParsedData } = useDiag();
  const audit = state.parsedData.llmAudit;
  const hasRows = (audit?.rows?.length ?? 0) > 0;
  const alreadyFetched = audit?.lookupLoadedAt != null || audit?.lookupError != null;
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Only fetch if we have rows and haven't already fetched (or failed).
    if (!hasRows || alreadyFetched || fetchedRef.current) return;
    fetchedRef.current = true;

    const controller = new AbortController();

    setParsedData({
      llmAuditLoading: { active: true, message: 'Fetching LiteLLM pricing catalog...', progressPct: 10 },
    });

    buildLookup(controller.signal)
      .then((lookup) => {
        if (controller.signal.aborted) return;

        setParsedData({
          llmAuditLoading: { active: true, message: 'Classifying models...', progressPct: 80 },
        });

        const rows = state.parsedData.llmAudit?.rows ?? [];
        const enriched: LlmAuditRow[] = rows.map((row) => {
          const result = classifyRow(row.type, row.rawModel, undefined, lookup);
          return {
            ...row,
            status: result.status,
            effectiveModel: result.effectiveModel ?? row.effectiveModel,
            provider: result.provider ?? '',
            family: result.family ?? '',
            currentModel: result.currentModel ?? '',
            modelInputPrice: result.modelInputPrice,
            modelOutputPrice: result.modelOutputPrice,
            currentInputPrice: result.currentInputPrice,
            currentOutputPrice: result.currentOutputPrice,
          };
        });

        setParsedData({
          llmAudit: {
            rows: enriched,
            lookupLoadedAt: new Date().toISOString(),
            lookupError: null,
          },
          llmAuditLoading: { active: false },
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setParsedData({
          llmAudit: {
            rows: state.parsedData.llmAudit?.rows ?? [],
            lookupLoadedAt: null,
            lookupError: msg,
          },
          llmAuditLoading: { active: false },
        });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRows]);

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      <LlmAuditTable />
    </div>
  );
}
