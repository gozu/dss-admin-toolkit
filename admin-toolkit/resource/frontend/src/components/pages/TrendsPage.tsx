import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { useDiag } from '../../context/DiagContext';
import { fetchJson } from '../../utils/api';
import { Card } from '../Card';
import { CHART_PALETTE } from '../../utils/chartColors';
import { BASE_TOOLTIP_STYLE } from '../../utils/chartConfig';
import type { ParsedData } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/* ---------- Types ---------- */

interface TrendsRun {
  run_id: number;
  run_at: string;
  health_score: number | null;
  user_count: number | null;
  project_count: number | null;
}

interface SnapshotRun {
  run_id: number;
  run_at: string;
  health_score: number | null;
  user_count: number;
  enabled_user_count: number;
  project_count: number;
  plugin_count: number;
  connection_count: number;
}

interface SnapshotUser {
  login: string;
  display_name: string | null;
  email: string | null;
  user_profile: string | null;
  enabled: number;
}

interface SnapshotProject {
  project_key: string;
  name: string | null;
  owner_login: string | null;
}

interface SnapshotPlugin {
  plugin_id: string;
  label: string | null;
  version: string | null;
  is_dev: number;
}

interface SnapshotConnection {
  connection_name: string;
  connection_type: string | null;
}

interface SnapshotDataset {
  project_key: string;
  dataset_name: string;
  dataset_type: string | null;
  connection_name: string | null;
}

interface SnapshotRecipe {
  project_key: string;
  recipe_name: string;
  recipe_type: string | null;
}

interface SnapshotLlm {
  llm_id: string;
  llm_type: string | null;
  friendly_name: string | null;
}

interface SnapshotAgent {
  project_key: string;
  agent_id: string;
  agent_name: string | null;
}

interface SnapshotAgentTool {
  project_key: string;
  tool_id: string;
  tool_type: string | null;
}

interface SnapshotKnowledgeBank {
  project_key: string;
  kb_id: string;
  kb_name: string | null;
}

interface SnapshotGitCommit {
  project_key: string;
  commit_hash: string;
  author: string | null;
  committed_at: string | null;
}

interface TrendsSnapshot {
  run: SnapshotRun;
  users: SnapshotUser[];
  projects: SnapshotProject[];
  plugins: SnapshotPlugin[];
  connections: SnapshotConnection[];
  datasets: SnapshotDataset[];
  recipes: SnapshotRecipe[];
  llms: SnapshotLlm[];
  agents: SnapshotAgent[];
  agent_tools: SnapshotAgentTool[];
  knowledge_banks: SnapshotKnowledgeBank[];
  git_commits: SnapshotGitCommit[];
  health_metrics: Record<string, unknown> | null;
}

interface NormalizedNow {
  userCount: number;
  enabledUserCount: number;
  projectCount: number;
  pluginCount: number;
  connectionCount: number;
  healthScore: number | null;
  userProfileBreakdown: Record<string, number>;
  ownerBreakdown: Record<string, number>;
  connectionTypeBreakdown: Record<string, number>;
}

interface NormalizedThen {
  runId: number;
  userCount: number;
  enabledUserCount: number;
  projectCount: number;
  pluginCount: number;
  connectionCount: number;
  healthScore: number | null;
  userProfileBreakdown: Record<string, number>;
  ownerBreakdown: Record<string, number>;
  connectionTypeBreakdown: Record<string, number>;
  datasetCount: number;
  datasetTypeBreakdown: Record<string, number>;
  recipeCount: number;
  recipeTypeBreakdown: Record<string, number>;
  llmCount: number;
  agentCount: number;
  agentToolCount: number;
  knowledgeBankCount: number;
  gitCommitCount: number;
  topCommitters: Record<string, number>;
  runAt: string;
}

// No presets — user picks from actual available runs

/* ---------- Helpers ---------- */

function groupBy<T>(items: T[], keyFn: (item: T) => string | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item) || 'Unknown';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function normalizeNowData(parsedData: ParsedData): NormalizedNow {
  const users = parsedData.users || [];
  const projects = parsedData.projects || [];
  const plugins = parsedData.pluginDetails || [];
  const connections = parsedData.connectionDetails || [];

  return {
    userCount: users.length,
    enabledUserCount: users.filter((u) => u.enabled !== false).length,
    projectCount: projects.length,
    pluginCount: plugins.length,
    connectionCount: connections.length,
    healthScore: null, // Computed externally if needed
    userProfileBreakdown: groupBy(users, (u) => u.userProfile),
    ownerBreakdown: groupBy(projects, (p) => p.owner),
    connectionTypeBreakdown: groupBy(connections, (c) => c.type),
  };
}

function normalizeThenData(snapshot: TrendsSnapshot): NormalizedThen {
  return {
    runId: snapshot.run.run_id,
    userCount: snapshot.run.user_count,
    enabledUserCount: snapshot.run.enabled_user_count,
    projectCount: snapshot.run.project_count,
    pluginCount: snapshot.run.plugin_count,
    connectionCount: snapshot.run.connection_count,
    healthScore: snapshot.run.health_score,
    userProfileBreakdown: groupBy(snapshot.users, (u) => u.user_profile),
    ownerBreakdown: groupBy(snapshot.projects, (p) => p.owner_login),
    connectionTypeBreakdown: groupBy(snapshot.connections, (c) => c.connection_type),
    datasetCount: snapshot.datasets.length,
    datasetTypeBreakdown: groupBy(snapshot.datasets, (d) => d.dataset_type),
    recipeCount: snapshot.recipes.length,
    recipeTypeBreakdown: groupBy(snapshot.recipes, (r) => r.recipe_type),
    llmCount: snapshot.llms.length,
    agentCount: snapshot.agents.length,
    agentToolCount: snapshot.agent_tools.length,
    knowledgeBankCount: snapshot.knowledge_banks.length,
    gitCommitCount: snapshot.git_commits.length,
    topCommitters: groupBy(snapshot.git_commits, (c) => c.author),
    runAt: snapshot.run.run_at,
  };
}

function formatDelta(now: number, then: number): { text: string; color: string; isPositive: boolean; isNeutral: boolean } {
  const diff = now - then;
  if (diff === 0 || then === 0) return { text: '--', color: 'var(--neon-amber)', isPositive: false, isNeutral: true };
  const pct = ((diff / then) * 100).toFixed(0);
  const sign = diff > 0 ? '+' : '';
  return {
    text: `${sign}${diff} (${sign}${pct}%)`,
    color: diff > 0 ? 'var(--neon-green)' : 'var(--neon-red)',
    isPositive: diff > 0,
    isNeutral: false,
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Top N entries from a record, sorted descending by value */
function topN(record: Record<string, number>, n: number): [string, number][] {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/* ---------- Palette for bar charts ---------- */

const BAR_COLORS = [
  CHART_PALETTE.rose,
  CHART_PALETTE.mint,
  CHART_PALETTE.blue,
  'rgba(200, 160, 80, 0.78)',
  'rgba(160, 120, 200, 0.78)',
  'rgba(100, 200, 200, 0.78)',
  'rgba(220, 130, 80, 0.78)',
  'rgba(130, 180, 100, 0.78)',
];

const BAR_BORDERS = [
  CHART_PALETTE.roseBorder,
  CHART_PALETTE.mintBorder,
  CHART_PALETTE.blueBorder,
  'rgba(180, 140, 60, 1)',
  'rgba(140, 100, 180, 1)',
  'rgba(80, 180, 180, 1)',
  'rgba(200, 110, 60, 1)',
  'rgba(110, 160, 80, 1)',
];

/* ---------- Custom hook ---------- */

function useTrendsData() {
  const { state, addDebugLog } = useDiag();
  const { parsedData } = state;

  const [runs, setRuns] = useState<TrendsRun[]>([]);
  const [snapshot, setSnapshot] = useState<TrendsSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch available runs
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    setRunsLoading(true);
    fetchJson<{ runs: TrendsRun[] }>('/api/tracking/runs?limit=100')
      .then((data) => {
        if (cancelled) return;
        const list = data.runs ?? (Array.isArray(data) ? data : []);
        setRuns(list);
        addDebugLog(`[trends] Fetched ${list.length} runs in ${(performance.now() - t0).toFixed(0)}ms`, 'trends');
        // Auto-select the oldest run for initial comparison
        if (list.length > 1) {
          setSelectedRunId(list[list.length - 1].run_id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        addDebugLog(`[trends] Failed to fetch runs: ${msg}`, 'trends', 'error');
      })
      .finally(() => { if (!cancelled) setRunsLoading(false); });
    return () => { cancelled = true; };
  }, [addDebugLog]);

  // Fetch snapshot when selected run changes
  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    fetchJson<TrendsSnapshot>(`/api/tracking/trends/snapshot?run_id=${selectedRunId}`)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        addDebugLog(`[trends] Fetched snapshot for run #${selectedRunId} in ${(performance.now() - t0).toFixed(0)}ms`, 'trends');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        addDebugLog(`[trends] Failed to fetch snapshot: ${msg}`, 'trends', 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRunId, addDebugLog]);

  const selectRun = useCallback((runId: number) => setSelectedRunId(runId), []);

  const now = useMemo(() => normalizeNowData(parsedData), [parsedData]);
  const then = useMemo(() => (snapshot ? normalizeThenData(snapshot) : null), [snapshot]);

  return { runs, now, then, loading: loading || runsLoading, error, selectedRunId, selectRun, parsedData };
}

/* ---------- Sub-components ---------- */

function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`glass-card animate-pulse ${className}`}>
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <div className="h-4 w-24 rounded bg-[var(--bg-glass-hover)]" />
      </div>
      <div className="px-4 py-6 space-y-3">
        <div className="h-8 w-20 rounded bg-[var(--bg-glass-hover)]" />
        <div className="h-3 w-32 rounded bg-[var(--bg-glass-hover)]" />
      </div>
    </div>
  );
}

function DeltaBadge({ now, then, inverted = false }: { now: number; then: number; inverted?: boolean }) {
  const delta = formatDelta(now, then);
  if (delta.isNeutral) {
    return <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ color: 'var(--neon-amber)', border: '1px solid color-mix(in srgb, var(--neon-amber) 30%, transparent)' }}>--</span>;
  }
  const effectivePositive = inverted ? !delta.isPositive : delta.isPositive;
  const badgeColor = effectivePositive ? 'var(--neon-green)' : 'var(--neon-red)';
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded-full"
      style={{
        color: badgeColor,
        border: `1px solid color-mix(in srgb, ${badgeColor} 40%, transparent)`,
        boxShadow: `0 0 8px color-mix(in srgb, ${badgeColor} 15%, transparent)`,
      }}
    >
      {delta.text}
    </span>
  );
}

function MetricCard({
  label,
  nowVal,
  thenVal,
  delay = 0,
  large = false,
}: {
  label: string;
  nowVal: number;
  thenVal: number;
  delay?: number;
  large?: boolean;
}) {
  return (
    <motion.div
      className={`glass-card overflow-hidden ${large ? 'border-[var(--border-glow)] shadow-[var(--glow-sm)]' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <h4 className={`font-semibold ${large ? 'text-lg text-neon-subtle' : 'text-sm text-[var(--text-secondary)]'}`}>{label}</h4>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className={`font-mono font-bold ${large ? 'text-3xl' : 'text-2xl'} text-[var(--text-primary)]`}>
              {nowVal.toLocaleString()}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              was {thenVal.toLocaleString()}
            </div>
          </div>
          <DeltaBadge now={nowVal} then={thenVal} />
        </div>
      </div>
    </motion.div>
  );
}

function HealthGauge({ now, then, delay = 0 }: { now: number | null; then: number | null; delay?: number }) {
  const score = now ?? 0;
  const prevScore = then ?? 0;
  const pct = Math.max(0, Math.min(100, score));
  const hue = (pct / 100) * 120; // 0=red, 120=green

  return (
    <motion.div
      className="glass-card border-[var(--border-glow)] shadow-[var(--glow-sm)] overflow-hidden"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="px-4 py-3 border-b border-[var(--border-glow)]">
        <h4 className="text-lg font-semibold text-neon-subtle">Health Score</h4>
      </div>
      <div className="px-4 py-5 flex items-center gap-6">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 flex-shrink-0">
          <div
            className="w-full h-full rounded-full"
            style={{
              background: `conic-gradient(
                hsl(${hue}, 75%, 55%) 0deg,
                hsl(${hue}, 65%, 40%) ${pct * 3.6}deg,
                rgba(50, 55, 70, 0.3) ${pct * 3.6}deg
              )`,
            }}
          />
          <div className="absolute inset-2 rounded-full bg-[var(--bg-surface)] flex items-center justify-center">
            <span className="text-2xl font-bold font-mono text-[var(--text-primary)]">
              {now !== null ? score : '--'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-sm text-[var(--text-muted)]">
            was {then !== null ? prevScore : '--'}
          </div>
          {now !== null && then !== null && (
            <DeltaBadge now={score} then={prevScore} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function MiniBarChart({
  title,
  thenData,
  nowData,
  delay = 0,
  maxItems = 8,
}: {
  title: string;
  thenData: Record<string, number>;
  nowData: Record<string, number>;
  delay?: number;
  maxItems?: number;
}) {
  // Merge all keys from both, sort by now values descending
  const allKeys = Array.from(new Set([...Object.keys(nowData), ...Object.keys(thenData)]));
  const sorted = allKeys
    .map((k) => ({ key: k, now: nowData[k] || 0, then: thenData[k] || 0 }))
    .sort((a, b) => b.now - a.now)
    .slice(0, maxItems);

  if (sorted.length === 0) return null;

  const data = {
    labels: sorted.map((s) => s.key),
    datasets: [
      {
        label: 'Now',
        data: sorted.map((s) => s.now),
        backgroundColor: sorted.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
        borderColor: sorted.map((_, i) => BAR_BORDERS[i % BAR_BORDERS.length]),
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Then',
        data: sorted.map((s) => s.then),
        backgroundColor: 'rgba(120, 120, 140, 0.25)',
        borderColor: 'rgba(120, 120, 140, 0.5)',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
        ticks: { color: '#a0a0b0', font: { size: 10, family: "'JetBrains Mono', monospace" } },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: '#c9d2de',
          font: { size: 10, family: "'JetBrains Mono', monospace" },
          callback: (_val: string | number, index: number) => {
            const lbl = sorted[index]?.key || '';
            return lbl.length > 18 ? lbl.slice(0, 16) + '..' : lbl;
          },
        },
      },
    },
    plugins: {
      legend: { display: true, position: 'top' as const, labels: { padding: 8, usePointStyle: true, pointStyle: 'circle' as const, font: { size: 10, family: "'JetBrains Mono', monospace" }, color: '#a0a0b0' } },
      tooltip: { ...BASE_TOOLTIP_STYLE },
    },
  };

  const chartHeight = Math.max(100, sorted.length * 30 + 50);

  return (
    <motion.div
      className="glass-card overflow-hidden"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="px-4 py-3 border-b border-[var(--border-glass)]">
        <h4 className="text-sm font-semibold text-[var(--text-secondary)]">{title}</h4>
      </div>
      <div className="px-4 py-3" style={{ height: chartHeight }}>
        <Bar data={data} options={options} />
      </div>
    </motion.div>
  );
}

function SectionHeader({ title, delay = 0 }: { title: string; delay?: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 pt-4 pb-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: delay * 0.06 }}
    >
      <h3 className="text-base font-semibold text-[var(--text-secondary)] tracking-wide uppercase">{title}</h3>
      <div className="flex-1 h-px bg-[var(--border-default)]" />
    </motion.div>
  );
}

/* ---------- Main Page ---------- */

export function TrendsPage() {
  const { runs, now, then, loading, error, selectedRunId, selectRun, parsedData } = useTrendsData();

  const dataTimestamp = parsedData.lastRestartTime
    ? formatDate(parsedData.lastRestartTime)
    : new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  // Empty state: no runs at all
  if (!loading && runs.length === 0 && !error) {
    return (
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <motion.div
          className="flex flex-col items-center justify-center py-20 rounded-xl border border-[var(--border-default)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div className="text-4xl mb-4 opacity-40">~</div>
          <div className="text-[var(--text-secondary)] text-lg font-medium">No tracking runs yet</div>
          <div className="text-[var(--text-muted)] text-sm mt-1">
            Run a diagnostics collection to start building trend data.
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-5">
      {/* Date picker row */}
      <motion.div
        className="flex flex-wrap items-center gap-3"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <span className="text-sm text-[var(--text-muted)] mr-1">Compare against:</span>
        <select
          className="text-sm font-mono bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-[var(--text-primary)] min-w-[280px]"
          value={selectedRunId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) selectRun(Number(val));
          }}
        >
          <option value="">Select a snapshot...</option>
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {formatDate(r.run_at)} — {r.user_count ?? '?'} users, {r.project_count ?? '?'} projects
            </option>
          ))}
        </select>

        {/* Data as of */}
        <div className="ml-auto text-xs text-[var(--text-muted)]">
          Now data as of <span className="font-mono text-[var(--text-secondary)]">{dataTimestamp}</span>
        </div>
      </motion.div>

      {/* Error display */}
      {error && (
        <motion.div
          className="text-sm text-[var(--neon-red)] bg-[var(--neon-red)]/10 rounded-lg px-4 py-3 border border-[var(--neon-red)]/20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {error}
        </motion.div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Comparison cards */}
      {!loading && then && (
        <>
          {/* Headline */}
          <SectionHeader title="Headline" delay={0} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HealthGauge now={now.healthScore} then={then.healthScore} delay={1} />
            <MetricCard label="Total Users" nowVal={now.userCount} thenVal={then.userCount} delay={2} large />
            <MetricCard label="Total Projects" nowVal={now.projectCount} thenVal={then.projectCount} delay={3} large />
          </div>

          {/* Users */}
          <SectionHeader title="Users" delay={4} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard label="Enabled Users" nowVal={now.enabledUserCount} thenVal={then.enabledUserCount} delay={5} />
            <MiniBarChart
              title="User Profile Breakdown"
              nowData={now.userProfileBreakdown}
              thenData={then.userProfileBreakdown}
              delay={6}
            />
          </div>

          {/* Projects */}
          <SectionHeader title="Projects" delay={7} />
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
            <MiniBarChart
              title="Top Project Owners"
              nowData={now.ownerBreakdown}
              thenData={then.ownerBreakdown}
              delay={8}
              maxItems={10}
            />
          </div>

          {/* Infrastructure */}
          <SectionHeader title="Infrastructure" delay={9} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard label="Plugins" nowVal={now.pluginCount} thenVal={then.pluginCount} delay={10} />
            <MiniBarChart
              title="Connection Types"
              nowData={now.connectionTypeBreakdown}
              thenData={then.connectionTypeBreakdown}
              delay={11}
            />
          </div>

          {/* V7: Content (hidden when empty) */}
          {(then.datasetCount > 0 || then.recipeCount > 0) && (
            <>
              <SectionHeader title="Content" delay={12} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {then.datasetCount > 0 && (
                  <Card id="trends-datasets" title={`Datasets (${then.datasetCount})`} variant="default" animationDelay={13}>
                    <div className="px-4 py-3" style={{ height: Math.max(100, Object.keys(then.datasetTypeBreakdown).length * 30 + 50) }}>
                      <Bar
                        data={{
                          labels: topN(then.datasetTypeBreakdown, 8).map(([k]) => k),
                          datasets: [{
                            label: 'Then',
                            data: topN(then.datasetTypeBreakdown, 8).map(([, v]) => v),
                            backgroundColor: topN(then.datasetTypeBreakdown, 8).map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
                            borderColor: topN(then.datasetTypeBreakdown, 8).map((_, i) => BAR_BORDERS[i % BAR_BORDERS.length]),
                            borderWidth: 1,
                            borderRadius: 4,
                          }],
                        }}
                        options={{
                          indexAxis: 'y',
                          responsive: true,
                          maintainAspectRatio: false,
                          scales: {
                            x: { grid: { color: 'rgba(148, 163, 184, 0.1)' }, ticks: { color: '#a0a0b0', font: { size: 10, family: "'JetBrains Mono', monospace" } } },
                            y: { grid: { display: false }, ticks: { color: '#c9d2de', font: { size: 10, family: "'JetBrains Mono', monospace" } } },
                          },
                          plugins: { legend: { display: false }, tooltip: { ...BASE_TOOLTIP_STYLE } },
                        }}
                      />
                    </div>
                  </Card>
                )}
                {then.recipeCount > 0 && (
                  <Card id="trends-recipes" title={`Recipes (${then.recipeCount})`} variant="default" animationDelay={14}>
                    <div className="px-4 py-3" style={{ height: Math.max(100, Object.keys(then.recipeTypeBreakdown).length * 30 + 50) }}>
                      <Bar
                        data={{
                          labels: topN(then.recipeTypeBreakdown, 8).map(([k]) => k),
                          datasets: [{
                            label: 'Then',
                            data: topN(then.recipeTypeBreakdown, 8).map(([, v]) => v),
                            backgroundColor: topN(then.recipeTypeBreakdown, 8).map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
                            borderColor: topN(then.recipeTypeBreakdown, 8).map((_, i) => BAR_BORDERS[i % BAR_BORDERS.length]),
                            borderWidth: 1,
                            borderRadius: 4,
                          }],
                        }}
                        options={{
                          indexAxis: 'y',
                          responsive: true,
                          maintainAspectRatio: false,
                          scales: {
                            x: { grid: { color: 'rgba(148, 163, 184, 0.1)' }, ticks: { color: '#a0a0b0', font: { size: 10, family: "'JetBrains Mono', monospace" } } },
                            y: { grid: { display: false }, ticks: { color: '#c9d2de', font: { size: 10, family: "'JetBrains Mono', monospace" } } },
                          },
                          plugins: { legend: { display: false }, tooltip: { ...BASE_TOOLTIP_STYLE } },
                        }}
                      />
                    </div>
                  </Card>
                )}
              </div>
            </>
          )}

          {/* V7: AI/ML (hidden when empty) */}
          {(then.llmCount > 0 || then.agentCount > 0 || then.agentToolCount > 0 || then.knowledgeBankCount > 0) && (
            <>
              <SectionHeader title="AI / ML" delay={15} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {then.llmCount > 0 && (
                  <MetricCard label="LLMs" nowVal={then.llmCount} thenVal={then.llmCount} delay={16} />
                )}
                {then.agentCount > 0 && (
                  <MetricCard label="Agents" nowVal={then.agentCount} thenVal={then.agentCount} delay={17} />
                )}
                {then.agentToolCount > 0 && (
                  <MetricCard label="Agent Tools" nowVal={then.agentToolCount} thenVal={then.agentToolCount} delay={18} />
                )}
                {then.knowledgeBankCount > 0 && (
                  <MetricCard label="Knowledge Banks" nowVal={then.knowledgeBankCount} thenVal={then.knowledgeBankCount} delay={19} />
                )}
              </div>
            </>
          )}

          {/* V7: Development (hidden when empty) */}
          {then.gitCommitCount > 0 && (
            <>
              <SectionHeader title="Development" delay={20} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MetricCard label="Git Commits" nowVal={then.gitCommitCount} thenVal={then.gitCommitCount} delay={21} />
                <MiniBarChart
                  title="Top Committers"
                  nowData={then.topCommitters}
                  thenData={then.topCommitters}
                  delay={22}
                  maxItems={8}
                />
              </div>
            </>
          )}

          {/* Snapshot metadata */}
          <motion.div
            className="text-xs text-[var(--text-muted)] text-center pt-4 pb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
          >
            Comparing against run #{then.runId} from {formatDate(then.runAt)}
          </motion.div>
        </>
      )}
    </div>
  );
}
