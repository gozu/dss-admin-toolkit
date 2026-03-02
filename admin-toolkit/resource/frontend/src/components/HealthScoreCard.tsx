import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import type { HealthScore, HealthIssue, HealthSeverity, HealthCategoryScore, HealthCategory } from '../types';
import type { HealthFactorKey, HealthFactorToggles } from '../hooks/useHealthScore';

interface HealthScoreCardProps {
  healthScore: HealthScore;
  healthFactorToggles: HealthFactorToggles;
  onToggleHealthFactor: (factor: HealthFactorKey) => void;
}

const healthFactorControls: Array<{ key: HealthFactorKey; label: string }> = [
  { key: 'python_versions', label: 'Python Versions' },
  { key: 'spark_version', label: 'Spark Version' },
  { key: 'memory_availability', label: 'Memory Availability' },
  { key: 'filesystem_capacity', label: 'Filesystem Capacity' },
  { key: 'open_files_limit', label: 'Open Files Limit' },
  { key: 'user_isolation', label: 'User Isolation' },
  { key: 'cgroups_enabled', label: 'CGroups Enabled' },
  { key: 'cgroups_empty_targets', label: 'CGroups Empty Targets' },
  { key: 'code_envs_per_project', label: 'Code Envs per Project' },
  { key: 'project_size_pressure', label: 'Project Size' },
  { key: 'disabled_features', label: 'Disabled Features' },
  { key: 'java_memory_limits', label: 'Java Memory Limits' },
];

const severityConfig: Record<HealthSeverity, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  critical: {
    bg: 'bg-[var(--status-critical-bg)]',
    text: 'text-[var(--neon-red)]',
    border: 'border-[var(--status-critical-border)]',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  warning: {
    bg: 'bg-[var(--status-warning-bg)]',
    text: 'text-[var(--neon-amber)]',
    border: 'border-[var(--status-warning-border)]',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  info: {
    bg: 'bg-[var(--status-info-bg)]',
    text: 'text-[var(--neon-cyan)]',
    border: 'border-[var(--status-info-border)]',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  good: {
    bg: 'bg-[var(--status-success-bg)]',
    text: 'text-[var(--neon-green)]',
    border: 'border-[var(--status-success-border)]',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
};

const statusConfig: Record<HealthScore['status'], { label: string; color: string; glowClass: string }> = {
  healthy: {
    label: 'Healthy',
    color: 'text-[var(--neon-green)]',
    glowClass: 'health-glow-green',
  },
  warning: {
    label: 'Needs Attention',
    color: 'text-[var(--neon-amber)]',
    glowClass: 'health-glow-amber',
  },
  critical: {
    label: 'Critical Issues',
    color: 'text-[var(--neon-red)]',
    glowClass: 'health-glow-red',
  },
};

const categoryExplanations: Record<HealthCategory, string> = {
  code_envs:
    'Measures per-project code environment sprawl. Each extra code environment multiplies storage, fragility, deployment time, and failure surface.',
  project_footprint:
    'Measures project storage pressure using project size distribution. Very large projects increase storage cost and operational risk.',
  system_capacity:
    'Checks runtime capacity: available memory, disk pressure, and open-files limits. Low headroom raises outage risk.',
  security_isolation:
    'Checks isolation controls (user isolation and cgroups). Weak isolation increases blast radius and resource contention risk.',
  version_currency:
    'Checks platform version currency (Python and Spark). Older versions increase security exposure and upgrade debt.',
  runtime_config:
    'Checks operational runtime settings such as Java heap sizing and disabled features.',
  version:
    'Checks platform version currency (Python and Spark). Older versions increase security exposure and upgrade debt.',
  system:
    'Legacy category kept for backward compatibility with older snapshots.',
  config:
    'Legacy category kept for backward compatibility with older snapshots.',
  security:
    'Legacy category kept for backward compatibility with older snapshots.',
  license:
    'License compliance signal (currently not weighted).',
  errors:
    'Runtime/parsing error signal (currently not weighted).',
};

function CategoryTooltip({ text }: { text: string }) {
  return (
    <span className="relative ml-1 inline-flex items-center group">
      <span
        tabIndex={0}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--border-glass)] text-[10px] font-semibold text-[var(--text-muted)] select-none"
      >
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-64 -translate-x-1/2 rounded-md border border-[var(--border-glass)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] leading-snug text-[var(--text-primary)] shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

const statusColorKey: Record<HealthScore['status'], string> = { healthy: 'green', warning: 'amber', critical: 'red' };

function ScoreGauge({ score, status }: { score: number; status: HealthScore['status'] }) {
  const config = statusConfig[status];
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const colorKey = statusColorKey[status];

  return (
    <div className="relative w-36 h-36">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`scoreGradient-${status}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={`var(--health-${colorKey}-start)`} />
            <stop offset="100%" stopColor={`var(--health-${colorKey}-end)`} />
          </linearGradient>
        </defs>
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="var(--border-glass)"
          strokeWidth="8"
        />
        {/* Score arc */}
        <motion.circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={`url(#scoreGradient-${status})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className={`text-4xl font-bold font-mono ${config.color}`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {score}
        </motion.span>
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

function CategoryBar({ category }: { category: HealthCategoryScore }) {
  const barColor = category.score >= 80
    ? 'bg-[var(--neon-green)]'
    : category.score >= 50
      ? 'bg-[var(--neon-amber)]'
      : 'bg-[var(--neon-red)]';
  const explanation = categoryExplanations[category.category] || category.label;

  return (
    <div className="grid grid-cols-[172px_1fr_36px] items-center gap-1.5">
      <div className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
        <span className="inline-flex items-center leading-tight">
          {category.label}
          <CategoryTooltip text={explanation} />
        </span>
      </div>
      <div className="h-2 bg-[var(--bg-glass)] rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${barColor} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${category.score}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <div className="w-8 text-xs font-mono text-[var(--text-muted)] text-right">
        {Math.round(category.score)}
      </div>
    </div>
  );
}

function IssueItem({ issue, index }: { issue: HealthIssue; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const config = severityConfig[issue.severity];

  return (
    <motion.div
      className={`${config.bg} border ${config.border} rounded-lg overflow-hidden`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--bg-glass-hover)] transition-colors"
      >
        <span className={config.text}>{config.icon}</span>
        <span className={`flex-1 text-sm font-medium ${config.text}`}>{issue.title}</span>
        <motion.svg
          className={`w-4 h-4 ${config.text}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-[var(--border-glass)]">
              <p className="text-sm text-[var(--text-secondary)] mb-2">{issue.description}</p>
              {issue.recommendation && (
                <p className="text-sm">
                  <span className="text-[var(--text-muted)]">Recommendation: </span>
                  <span className="text-[var(--text-primary)]">{issue.recommendation}</span>
                </p>
              )}
              {issue.value !== undefined && issue.threshold !== undefined && (
                <div className="mt-2 flex gap-4 text-xs font-mono">
                  <span className="text-[var(--text-muted)]">
                    Current: <span className={config.text}>{issue.value}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Target: <span className="text-[var(--neon-green)]">{issue.threshold}</span>
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function HealthScoreCard({ healthScore, healthFactorToggles, onToggleHealthFactor }: HealthScoreCardProps) {
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const config = statusConfig[healthScore.status];

  const displayedIssues = showAllIssues ? healthScore.issues : healthScore.issues.slice(0, 4);
  const hasMoreIssues = healthScore.issues.length > 4;

  return (
    <motion.div
      id="health-score"
      className={`glass-card p-5 mb-5 ${config.glowClass}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-neon-subtle">Health Score</h2>
        <div className="flex items-center gap-2">
          {healthScore.criticalCount > 0 && (
            <span className="badge badge-critical">{healthScore.criticalCount} critical</span>
          )}
          {healthScore.warningCount > 0 && (
            <span className="badge badge-warning">{healthScore.warningCount} warning</span>
          )}
          {healthScore.infoCount > 0 && (
            <span className="badge badge-info">{healthScore.infoCount} info</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Gauge */}
        <div className="flex flex-col items-center justify-center">
          <ScoreGauge score={healthScore.overall} status={healthScore.status} />
          <motion.div
            className={`mt-2 text-lg font-semibold ${config.color}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {config.label}
          </motion.div>
        </div>

        {/* Category Breakdown */}
        <div className="flex flex-col justify-center space-y-3">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Category Scores
          </h3>
          {healthScore.categories.map((category, idx) => (
            <motion.div
              key={category.category}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + idx * 0.1 }}
            >
              <CategoryBar category={category} />
            </motion.div>
          ))}
        </div>

        {/* Issues List */}
        <div className="flex flex-col">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
            {healthScore.issues.length > 0 ? 'Issues Detected' : 'No Issues Detected'}
          </h3>
          {healthScore.issues.length > 0 ? (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {displayedIssues.map((issue, idx) => (
                <IssueItem key={issue.id} issue={issue} index={idx} />
              ))}
            </div>
          ) : (
            <motion.div
              className="flex-1 flex flex-col items-center justify-center py-6"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--status-success-bg)] flex items-center justify-center mb-2">
                <svg className="w-6 h-6 text-[var(--neon-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-[var(--text-muted)]">System looks healthy!</span>
            </motion.div>
          )}
          {hasMoreIssues && (
            <button
              onClick={() => setShowAllIssues(!showAllIssues)}
              className="mt-2 text-sm text-[var(--neon-cyan)] hover:text-[var(--neon-cyan-dim)] transition-colors flex items-center gap-1 justify-center"
            >
              {showAllIssues ? (
                <>
                  Show less
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </>
              ) : (
                <>
                  Show {healthScore.issues.length - 4} more
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Health Factor Toggles - Collapsible */}
      <div className="mt-4 pt-4 border-t border-[var(--border-glass)]">
        <button
          onClick={() => setShowControls(!showControls)}
          className="w-full flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-glass)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <motion.svg
              className="w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              animate={{ rotate: showControls ? 90 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </motion.svg>
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              Customize health checks
            </span>
          </div>
          <span className="text-xs text-[var(--text-muted)] font-mono">
            {Object.values(healthFactorToggles).filter(Boolean).length} / {healthFactorControls.length} enabled
          </span>
        </button>

        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-3 pb-2 px-3">
                <div className="flex flex-wrap gap-2">
                  {healthFactorControls.map((control) => {
                    const enabled = healthFactorToggles[control.key];
                    return (
                      <button
                        key={control.key}
                        onClick={() => onToggleHealthFactor(control.key)}
                        className={
                          enabled
                            ? 'px-2.5 py-1 text-xs rounded border border-[var(--neon-cyan)]/40 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] transition-colors'
                            : 'px-2.5 py-1 text-xs rounded border border-[var(--border-glass)] bg-[var(--bg-glass)] text-[var(--text-muted)] hover:border-[var(--border-glass-hover)] transition-colors'
                        }
                      >
                        {control.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
