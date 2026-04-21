import { motion } from 'framer-motion';
import type { DiagFile } from '../../../types';
import { SectionDivider } from './trendsHelpers';
import { TrendsSummaryBand } from './TrendsSummaryBand';
import { TrendsHealthSection } from './TrendsHealthSection';
import { TrendsSystemSection } from './TrendsSystemSection';
import { TrendsFilesystemSection } from './TrendsFilesystemSection';
import { TrendsMemorySection } from './TrendsMemorySection';
import { TrendsConnectionsSection } from './TrendsConnectionsSection';
import { TrendsRuntimeSection } from './TrendsRuntimeSection';
import { TrendsPluginsSection } from './TrendsPluginsSection';
import { TrendsProjectsSection } from './TrendsProjectsSection';
import { TrendsFootprintSection } from './TrendsFootprintSection';
import { TrendsCodeEnvsSection } from './TrendsCodeEnvsSection';

interface TrendsViewProps {
  before: DiagFile;
  after: DiagFile;
}

/**
 * TrendsView renders all trend-diff sections for two uploaded diag ZIPs.
 * "before" = run2 (older), "after" = run1 (newer) — matching AT's convention.
 */
export function TrendsView({ before, after }: TrendsViewProps) {
  const run2 = before.parsedData;  // "before" snapshot
  const run1 = after.parsedData;   // "after" snapshot

  return (
    <motion.div
      className="space-y-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Sticky summary band */}
      <TrendsSummaryBand
        run1={run1}
        run2={run2}
        run1Health={after.healthScore?.overall ?? null}
        run2Health={before.healthScore?.overall ?? null}
      />

      {/* ── Health ─────────────────────────────────────────────────── */}
      <SectionDivider label="Health" />
      <TrendsHealthSection
        run1Health={after.healthScore}
        run2Health={before.healthScore}
      />

      {/* ── System ─────────────────────────────────────────────────── */}
      <SectionDivider label="System" />
      <TrendsSystemSection run1={run1} run2={run2} />

      {/* ── Resources ──────────────────────────────────────────────── */}
      <SectionDivider label="Resources" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendsMemorySection run1={run1} run2={run2} />
        <TrendsFilesystemSection run1={run1} run2={run2} />
      </div>

      {/* ── Connections ────────────────────────────────────────────── */}
      <SectionDivider label="Connections" />
      <TrendsConnectionsSection run1={run1} run2={run2} />

      {/* ── Runtime Config ─────────────────────────────────────────── */}
      <SectionDivider label="Runtime Config" />
      <TrendsRuntimeSection run1={run1} run2={run2} />

      {/* ── Plugins ────────────────────────────────────────────────── */}
      <SectionDivider label="Plugins" />
      <TrendsPluginsSection run1={run1} run2={run2} />

      {/* ── Projects & Footprint ───────────────────────────────────── */}
      <SectionDivider label="Projects" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendsProjectsSection run1={run1} run2={run2} />
        <TrendsFootprintSection run1={run1} run2={run2} />
      </div>

      {/* ── Code Environments ──────────────────────────────────────── */}
      <SectionDivider label="Code Environments" />
      <TrendsCodeEnvsSection run1={run1} run2={run2} />
    </motion.div>
  );
}
