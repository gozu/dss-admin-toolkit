import { useCallback, useEffect, useMemo, useState } from 'react';
import { Container } from './Container';
import { SearchableCombobox } from './SearchableCombobox';
import { useDiag } from '../context/DiagContext';
import { useUltraWideLayout } from '../hooks';
import { useThresholds, type ThresholdSettings } from '../hooks/useThresholds';
import { fetchJson } from '../utils/api';
import { loadFromStorage, saveToStorage } from '../utils/storage';
import { DEFAULT_AI_SYSTEM_PROMPT, AI_PROMPT_STORAGE_KEY } from './AiLogAnalysis';
import type { CampaignExemption } from '../types';

interface TrackingBackendStatus {
  sql_connection_configured: boolean;
  sql_connection_healthy: boolean | null;
  instance_has_compatible_sql: boolean | null;
  table_prefix: string | null;
  effective_backend: 'sqlite' | 'sql' | 'unconfigured';
  connection_name: string | null;
  sqlite_exists: boolean;
  sqlite_has_data: boolean;
  migration_running: boolean;
  error?: string;
}

interface MigrationResult {
  ok: boolean;
  results: Record<string, { source_rows?: number; inserted?: number; error?: string }>;
  validation: Record<string, string>;
  backend_switched: boolean;
}

interface SettingsViewProps {
  onBack: () => void;
}

type FieldDef = { key: keyof ThresholdSettings; label: string; description: string; min: number; max: number; step: number; type?: 'number' | 'text' };

const mainFields: FieldDef[] = [
  { key: 'codeEnvCountUnhealthy', label: 'Code Env Count Threshold', description: 'Projects with more code envs than this are flagged unhealthy.', min: 0, max: 20, step: 1 },
  { key: 'codeStudioCountUnhealthy', label: 'Code Studio Count Threshold', description: 'Projects with more Code Studios than this are flagged.', min: 0, max: 50, step: 1 },
  { key: 'filesystemWarningPct', label: 'Filesystem Warning %', description: 'Filesystem usage above this triggers a warning.', min: 0, max: 100, step: 5 },
  { key: 'filesystemCriticalPct', label: 'Filesystem Critical %', description: 'Filesystem usage above this triggers a critical alert.', min: 0, max: 100, step: 5 },
  { key: 'largeFlowThreshold', label: 'Large Flow Threshold', description: 'Flows with more objects than this are flagged.', min: 1, max: 1000, step: 10 },
  { key: 'inactiveProjectDays', label: 'Inactive Project Days', description: 'Projects inactive for more days than this are flagged.', min: 30, max: 730, step: 30 },
  { key: 'emptyProjectBytes', label: 'Empty Project Size (bytes)', description: 'Projects larger than this are not considered empty.', min: 0, max: 10485760, step: 1024 },
  { key: 'orphanNotebookMinCount', label: 'Orphan Notebook Min Count', description: 'Minimum notebook count to flag orphan notebooks.', min: 1, max: 50, step: 1 },
  { key: 'highFreqScenarioMinutes', label: 'High-Freq Scenario (min)', description: 'Scenarios running more often than this are flagged.', min: 1, max: 1440, step: 5 },
  { key: 'deprecatedPythonPrefixes', label: 'Deprecated Python Prefixes', description: 'Comma-separated version prefixes to flag (e.g. 2.,3.6,3.7).', min: 0, max: 0, step: 0, type: 'text' },
  { key: 'disabledFeaturesSeverityCutoff', label: 'Disabled Features Severity Cutoff', description: 'More disabled features than this triggers a warning instead of info.', min: 1, max: 50, step: 1 },
];

const advancedFields: { group: string; fields: FieldDef[] }[] = [
  {
    group: 'Version & System Thresholds',
    fields: [
      { key: 'openFilesMinimum', label: 'Open Files Minimum', description: 'Minimum open files limit before flagging.', min: 1024, max: 1048576, step: 1024 },
      { key: 'javaHeapMinimumMB', label: 'Java Heap Minimum (MB)', description: 'Minimum Java heap per component before flagging.', min: 256, max: 16384, step: 256 },
      { key: 'pythonCriticalBelow', label: 'Python Critical Below', description: 'Python versions below this are flagged critical (e.g. 3.8).', min: 0, max: 0, step: 0, type: 'text' },
      { key: 'pythonWarningBelow', label: 'Python Warning Below', description: 'Python versions below this are flagged warning (e.g. 3.10).', min: 0, max: 0, step: 0, type: 'text' },
      { key: 'sparkVersionMinimum', label: 'Spark Version Minimum', description: 'Spark major version below this is flagged.', min: 1, max: 10, step: 1 },
      { key: 'projectCountWarning', label: 'Project Count Warning', description: 'More projects than this triggers a warning.', min: 50, max: 5000, step: 50 },
    ],
  },
  {
    group: 'Health Scoring Weights',
    fields: [
      { key: 'weightCodeEnvs', label: 'Weight: Code Envs', description: 'Weight for code environments category.', min: 0, max: 1, step: 0.05 },
      { key: 'weightProjectFootprint', label: 'Weight: Project Footprint', description: 'Weight for project footprint category.', min: 0, max: 1, step: 0.05 },
      { key: 'weightSystemCapacity', label: 'Weight: System Capacity', description: 'Weight for system capacity category.', min: 0, max: 1, step: 0.05 },
      { key: 'weightSecurityIsolation', label: 'Weight: Security Isolation', description: 'Weight for security isolation category.', min: 0, max: 1, step: 0.05 },
      { key: 'weightVersionCurrency', label: 'Weight: Version Currency', description: 'Weight for version currency category.', min: 0, max: 1, step: 0.05 },
      { key: 'weightRuntimeConfig', label: 'Weight: Runtime Config', description: 'Weight for runtime configuration category.', min: 0, max: 1, step: 0.05 },
      { key: 'healthCriticalBelow', label: 'Health Critical Below', description: 'Overall score below this is critical.', min: 0, max: 100, step: 5 },
      { key: 'healthWarningBelow', label: 'Health Warning Below', description: 'Overall score below this is warning.', min: 0, max: 100, step: 5 },
    ],
  },
  {
    group: 'Log Parsing',
    fields: [
      { key: 'logLinesBefore', label: 'Lines Before Error', description: 'Context lines to show before each error.', min: 0, max: 100, step: 5 },
      { key: 'logLinesAfter', label: 'Lines After Error', description: 'Context lines to show after each error.', min: 0, max: 500, step: 10 },
      { key: 'logTimeThresholdSec', label: 'Error Grouping Window (sec)', description: 'Errors within this window are grouped together.', min: 1, max: 60, step: 1 },
      { key: 'logMaxErrors', label: 'Max Error Signatures', description: 'Maximum number of unique error signatures to display.', min: 1, max: 50, step: 1 },
    ],
  },
  {
    group: 'Scan Limits',
    fields: [
      { key: 'largeFileThresholdGB', label: 'Large File Threshold (GB)', description: 'Files larger than this are flagged during dir scans.', min: 1, max: 1000, step: 10 },
      { key: 'dirTreeDefaultDepth', label: 'Dir Tree Default Depth', description: 'Default directory tree scan depth.', min: 1, max: 10, step: 1 },
      { key: 'fileViewerMaxLines', label: 'File Viewer Max Lines', description: 'Maximum lines shown in the file viewer.', min: 1000, max: 100000, step: 1000 },
      { key: 'syntaxHighlightMaxKB', label: 'Syntax Highlight Max (KB)', description: 'Max file size for syntax highlighting.', min: 100, max: 5000, step: 100 },
    ],
  },
];

const allFields: FieldDef[] = [...mainFields, ...advancedFields.flatMap((g) => g.fields)];

type BackendSettings = Record<string, number>;

const BACKEND_FIELD_GROUPS: { group: string; fields: { key: string; label: string; description: string; min: number; max: number; step: number }[] }[] = [
  {
    group: 'Concurrency / Performance',
    fields: [
      { key: 'parallel_workers_default', label: 'Default Parallel Workers', description: 'Default thread pool size for parallel API calls.', min: 1, max: 64, step: 1 },
      { key: 'parallel_workers_max', label: 'Worker Clamp Max', description: 'Maximum worker threads allowed.', min: 1, max: 128, step: 1 },
      { key: 'code_env_detail_workers', label: 'Code Env Detail Workers', description: 'Workers for fetching code env details.', min: 1, max: 64, step: 1 },
      { key: 'code_env_timeout_ms', label: 'Code Env API Timeout (ms)', description: 'Backend timeout for code env analysis.', min: 60000, max: 3600000, step: 60000 },
      { key: 'project_footprint_timeout_ms', label: 'Project Footprint Timeout (ms)', description: 'Backend timeout for project footprint scan.', min: 60000, max: 3600000, step: 60000 },
    ],
  },
  {
    group: 'Cache TTLs (seconds)',
    fields: [
      { key: 'cache_ttl_overview', label: 'Overview', description: 'Cache TTL for overview endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_connections', label: 'Connections', description: 'Cache TTL for connections endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_users', label: 'Users', description: 'Cache TTL for users endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_license', label: 'License', description: 'Cache TTL for license endpoint.', min: 5, max: 3600, step: 60 },
      { key: 'cache_ttl_projects', label: 'Projects', description: 'Cache TTL for projects endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_code_envs', label: 'Code Envs', description: 'Cache TTL for code envs endpoint.', min: 1, max: 600, step: 5 },
      { key: 'cache_ttl_usage_full', label: 'Usage Full', description: 'Cache TTL for code env usage endpoint.', min: 1, max: 600, step: 5 },
      { key: 'cache_ttl_outreach', label: 'Outreach Data', description: 'Cache TTL for outreach data endpoint.', min: 5, max: 600, step: 5 },
      { key: 'cache_ttl_inactive', label: 'Inactive Projects', description: 'Cache TTL for inactive projects endpoint.', min: 5, max: 600, step: 5 },
      { key: 'cache_ttl_plugins', label: 'Plugins', description: 'Cache TTL for plugins endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_log_errors', label: 'Log Errors', description: 'Cache TTL for log errors endpoint.', min: 5, max: 3600, step: 30 },
      { key: 'cache_ttl_dir_tree', label: 'Dir Tree', description: 'Cache TTL for directory tree endpoint.', min: 5, max: 3600, step: 60 },
    ],
  },
  {
    group: 'Frontend API Timeouts (ms)',
    fields: [
      { key: 'fe_timeout_code_envs', label: 'Code Envs Fetch', description: 'Frontend timeout for code envs fetch.', min: 30000, max: 1800000, step: 30000 },
      { key: 'fe_timeout_project_footprint', label: 'Project Footprint Fetch', description: 'Frontend timeout for project footprint.', min: 30000, max: 1800000, step: 30000 },
      { key: 'fe_timeout_projects', label: 'Projects Fetch', description: 'Frontend timeout for projects list.', min: 5000, max: 300000, step: 5000 },
      { key: 'fe_timeout_logs', label: 'Logs Fetch', description: 'Frontend timeout for log errors.', min: 5000, max: 300000, step: 5000 },
      { key: 'fe_timeout_llm_analysis', label: 'LLM Analysis', description: 'Timeout for AI log analysis LLM response.', min: 30000, max: 600000, step: 10000 },
    ],
  },
  {
    group: 'Tracking & Tools',
    fields: [
      { key: 'sqlite_connect_timeout', label: 'SQLite Connect Timeout (sec)', description: 'Timeout for SQLite database connections.', min: 5, max: 120, step: 5 },
      { key: 'tracking_issue_page_size', label: 'Issue Fetch Page Size', description: 'Number of issues fetched per page.', min: 50, max: 5000, step: 50 },
      { key: 'codenvclean_thread_max', label: 'Codenvclean Thread Max', description: 'Maximum threads for code env cleanup tool.', min: 1, max: 50, step: 1 },
    ],
  },
];

const CAMPAIGN_LABELS: Record<string, string> = {
  project: 'Code Env Sprawl',
  code_env: 'Code Env Ownership',
  code_studio: 'Code Studio Sprawl',
  auto_scenario: 'Auto-Start Scenarios',
  scenario_frequency: 'High-Frequency Scenarios',
  scenario_failing: 'Failing Scenarios',
  disabled_user: 'Disabled User Projects',
  deprecated_code_env: 'Deprecated Python Versions',
  default_code_env: 'Missing Default Code Env',
  empty_project: 'Empty Projects',
  large_flow: 'Large Flow Projects',
  orphan_notebooks: 'Orphan Notebooks',
  overshared_project: 'Overshared Projects',
  inactive_project: 'Inactive Projects',
};

const CAMPAIGN_IDS = Object.keys(CAMPAIGN_LABELS);

function ThresholdField({
  field,
  value,
  defaultValue,
  inputValue,
  onChangeInput,
  onBlur,
}: {
  field: FieldDef;
  value: ThresholdSettings[keyof ThresholdSettings];
  defaultValue: ThresholdSettings[keyof ThresholdSettings];
  inputValue: string | undefined;
  onChangeInput: (key: keyof ThresholdSettings, raw: string) => void;
  onBlur: (key: keyof ThresholdSettings) => void;
}) {
  const isText = field.type === 'text';
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-[var(--text-primary)]">{field.label}</span>
      <p className="text-xs text-[var(--text-muted)]">{field.description}</p>
      <input
        type={isText ? 'text' : 'number'}
        value={inputValue ?? value}
        onChange={(e) => onChangeInput(field.key, e.target.value)}
        onBlur={() => onBlur(field.key)}
        min={isText ? undefined : field.min}
        max={isText ? undefined : field.max}
        step={isText ? undefined : field.step}
        className="mt-1 w-full input-glass font-mono"
      />
      {value !== defaultValue && (
        <span className="text-[10px] text-[var(--neon-amber)]">
          Default: {String(defaultValue)}
        </span>
      )}
    </label>
  );
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { ultraWideEnabled } = useUltraWideLayout();
  const { thresholds, setThreshold, resetDefaults, defaults } = useThresholds();
  const [inputValues, setInputValues] = useState<Partial<Record<keyof ThresholdSettings, string>>>({});
  const { state } = useDiag();
  const { parsedData } = state;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // AI Log Analysis prompt state
  const [aiPrompt, setAiPrompt] = useState(() =>
    loadFromStorage<string>(AI_PROMPT_STORAGE_KEY, DEFAULT_AI_SYSTEM_PROMPT),
  );
  const isAiPromptModified = aiPrompt.trim() !== DEFAULT_AI_SYSTEM_PROMPT;

  const handleAiPromptChange = useCallback((value: string) => {
    setAiPrompt(value);
    saveToStorage(AI_PROMPT_STORAGE_KEY, value);
  }, []);

  const resetAiPrompt = useCallback(() => {
    setAiPrompt(DEFAULT_AI_SYSTEM_PROMPT);
    saveToStorage(AI_PROMPT_STORAGE_KEY, DEFAULT_AI_SYSTEM_PROMPT);
  }, []);

  // Backend settings state
  const [backendSettings, setBackendSettings] = useState<BackendSettings>({});
  const [backendDefaults, setBackendDefaults] = useState<BackendSettings>({});
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendInputs, setBackendInputs] = useState<Partial<Record<string, string>>>({});

  useEffect(() => {
    fetchJson<{ current: BackendSettings; defaults: BackendSettings }>('/api/settings')
      .then((data) => {
        setBackendSettings(data.current);
        setBackendDefaults(data.defaults);
      })
      .catch(() => {})
      .finally(() => setBackendLoading(false));
  }, []);

  const resetBackendSettings = useCallback(async () => {
    const data = await fetchJson<{ current: BackendSettings; defaults: BackendSettings }>('/api/settings/reset', { method: 'POST' });
    setBackendSettings(data.current);
    setBackendDefaults(data.defaults);
  }, []);

  const updateBackendSetting = useCallback((key: string, value: number) => {
    const prev = backendSettings[key];
    setBackendSettings((s) => ({ ...s, [key]: value }));
    fetchJson<BackendSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {
      setBackendSettings((s) => ({ ...s, [key]: prev }));
    });
  }, [backendSettings]);

  const mailChannels = useMemo(() => parsedData.mailChannels ?? [], [parsedData.mailChannels]);
  const [selectedChannel, setSelectedChannel] = useState(() =>
    loadFromStorage('selectedChannel', ''),
  );

  useEffect(() => {
    if (!selectedChannel && mailChannels.length > 0) {
      setSelectedChannel(mailChannels[0].id);
    }
  }, [selectedChannel, mailChannels]);

  useEffect(() => {
    saveToStorage('selectedChannel', selectedChannel);
  }, [selectedChannel]);

  const isDefault = allFields.every((f) => thresholds[f.key] === defaults[f.key]);

  // Campaign toggle state
  const [campaignSettings, setCampaignSettings] = useState<Record<string, boolean>>({});
  const [campaignSettingsLoading, setCampaignSettingsLoading] = useState(false);

  useEffect(() => {
    fetchJson<{ campaigns: Record<string, boolean> }>('/api/tracking/campaign-settings')
      .then((data) => setCampaignSettings(data.campaigns))
      .catch(() => {})
      .finally(() => setCampaignSettingsLoading(false));
  }, []);

  const toggleCampaign = useCallback((campaignId: string) => {
    const current = campaignSettings[campaignId] ?? true;
    const next = !current;
    setCampaignSettings((prev) => ({ ...prev, [campaignId]: next }));
    fetchJson('/api/tracking/campaign-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, enabled: next }),
    }).catch(() => {
      setCampaignSettings((prev) => ({ ...prev, [campaignId]: current }));
    });
  }, [campaignSettings]);

  const campaignEntries = useMemo(() =>
    Object.entries(CAMPAIGN_LABELS).map(([id, label]) => ({
      id,
      label,
      enabled: campaignSettings[id] ?? true,
    })),
  [campaignSettings]);

  const projectKeys = useMemo(
    () => (parsedData.projects ?? []).map((p) => p.key).sort(),
    [parsedData.projects],
  );

  // Campaign exemptions state
  const [exemptions, setExemptions] = useState<CampaignExemption[]>([]);
  const [exemptionsLoading, setExemptionsLoading] = useState(false);
  const [newExemptionCampaign, setNewExemptionCampaign] = useState(CAMPAIGN_IDS[0]);
  const [newExemptionKey, setNewExemptionKey] = useState('');
  const [newExemptionReason, setNewExemptionReason] = useState('');
  const [exemptionSaving, setExemptionSaving] = useState(false);

  useEffect(() => {
    fetchJson<{ exemptions: CampaignExemption[] }>('/api/tracking/exemptions')
      .then((data) => setExemptions(data.exemptions))
      .catch(() => {})
      .finally(() => setExemptionsLoading(false));
  }, []);

  const addExemption = useCallback(async () => {
    const key = newExemptionKey.trim();
    if (!key || !newExemptionCampaign) return;
    setExemptionSaving(true);
    try {
      const res = await fetchJson<{ ok: boolean; exemption: CampaignExemption }>('/api/tracking/exemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: newExemptionCampaign,
          entity_key: key,
          reason: newExemptionReason.trim() || null,
        }),
      });
      if (res.exemption) {
        setExemptions((prev) => {
          const filtered = prev.filter(
            (e) => !(e.campaign_id === res.exemption.campaign_id && e.entity_key === res.exemption.entity_key),
          );
          return [res.exemption, ...filtered];
        });
      }
      setNewExemptionKey('');
      setNewExemptionReason('');
    } catch {
      // error silently handled
    } finally {
      setExemptionSaving(false);
    }
  }, [newExemptionCampaign, newExemptionKey, newExemptionReason]);

  const removeExemption = useCallback((exemptionId: number) => {
    setExemptions((prev) => prev.filter((e) => e.exemption_id !== exemptionId));
    fetchJson('/api/tracking/exemptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exemption_id: exemptionId }),
    }).catch(() => {
      fetchJson<{ exemptions: CampaignExemption[] }>('/api/tracking/exemptions')
        .then((data) => setExemptions(data.exemptions))
        .catch(() => {});
    });
  }, []);

  // Tracking backend status state
  const [backendStatus, setBackendStatus] = useState<TrackingBackendStatus | null>(null);
  const [backendStatusLoading, setBackendStatusLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  useEffect(() => {
    fetchJson<TrackingBackendStatus>('/api/tracking/backend-status')
      .then(setBackendStatus)
      .catch(() => {})
      .finally(() => setBackendStatusLoading(false));
  }, []);

  const startMigration = useCallback(async () => {
    if (migrating) return;
    setMigrating(true);
    setMigrationResult(null);
    try {
      const res = await fetchJson<MigrationResult>('/api/tracking/migrate-to-sql', {
        method: 'POST',
      });
      setMigrationResult(res);
      // Refresh status after migration
      fetchJson<TrackingBackendStatus>('/api/tracking/backend-status')
        .then(setBackendStatus)
        .catch(() => {});
    } catch {
      setMigrationResult({ ok: false, results: {}, validation: {}, backend_switched: false });
    } finally {
      setMigrating(false);
    }
  }, [migrating]);

  const handleInputChange = useCallback((key: keyof ThresholdSettings, raw: string) => {
    setInputValues((prev) => ({ ...prev, [key]: raw }));
    const field = allFields.find((f) => f.key === key);
    if (field?.type === 'text') {
      setThreshold(key, raw as never);
    } else {
      const v = Number(raw);
      if (raw !== '' && !Number.isNaN(v)) setThreshold(key, v as never);
    }
  }, [setThreshold]);

  const handleInputBlur = useCallback((key: keyof ThresholdSettings) => {
    setInputValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return (
    <main className="flex-1 py-4">
      <Container ultraWide={ultraWideEnabled}>
        <div className="space-y-4">
          <section className="glass-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">Settings</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Configure health-check thresholds. Changes are saved automatically to local storage.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetDefaults}
                  disabled={isDefault}
                  className="px-3 py-1.5 rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] disabled:opacity-40 transition-colors"
                >
                  Reset to Defaults
                </button>
                <button
                  onClick={onBack}
                  className="px-3 py-1.5 rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </section>

          {/* Main Settings — Check Thresholds */}
          <section className="glass-card p-4">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Check Thresholds</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mainFields.map((field) => (
                <ThresholdField
                  key={field.key}
                  field={field}
                  value={thresholds[field.key]}
                  defaultValue={defaults[field.key]}
                  inputValue={inputValues[field.key]}
                  onChangeInput={handleInputChange}
                  onBlur={handleInputBlur}
                />
              ))}
            </div>
          </section>

          {/* Backend Settings */}
          <section className="glass-card p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Backend Settings</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Configure server-side concurrency, cache TTLs, and timeouts. Changes are sent to the backend immediately.
                </p>
              </div>
              <button
                onClick={resetBackendSettings}
                className="px-3 py-1.5 rounded bg-[var(--bg-glass)] hover:bg-[var(--bg-glass-hover)] text-[var(--text-secondary)] transition-colors text-sm"
              >
                Reset to Defaults
              </button>
            </div>
            {backendLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                Loading backend settings...
              </div>
            ) : (
              <div className="space-y-4">
                {BACKEND_FIELD_GROUPS.map(({ group, fields }) => (
                  <div key={group}>
                    <h4 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{group}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {fields.map((f) => (
                        <label key={f.key} className="block space-y-1">
                          <span className="text-sm font-medium text-[var(--text-primary)]">{f.label}</span>
                          <p className="text-xs text-[var(--text-muted)]">{f.description}</p>
                          <input
                            type="number"
                            value={backendInputs[f.key] ?? backendSettings[f.key] ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setBackendInputs((prev) => ({ ...prev, [f.key]: raw }));
                              const v = Number(raw);
                              if (raw !== '' && !Number.isNaN(v)) updateBackendSetting(f.key, v);
                            }}
                            onBlur={() => {
                              setBackendInputs((prev) => {
                                const next = { ...prev };
                                delete next[f.key];
                                return next;
                              });
                            }}
                            min={f.min}
                            max={f.max}
                            step={f.step}
                            className="mt-1 w-full input-glass font-mono"
                          />
                          {backendSettings[f.key] !== backendDefaults[f.key] && (
                            <span className="text-[10px] text-[var(--neon-amber)]">
                              Default: {backendDefaults[f.key]}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Advanced Settings — Collapsible */}
          <section className="glass-card p-4 space-y-3">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`}>
                &#9654;
              </span>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Advanced Settings</h3>
              <span className="text-xs text-[var(--text-muted)] ml-auto">
                Health weights, log parsing, scan limits, AI prompt
              </span>
            </button>
            {advancedOpen && (
              <div className="space-y-4 pt-2">
                {advancedFields.map(({ group, fields }) => (
                  <div key={group}>
                    <h4 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{group}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {fields.map((field) => (
                        <ThresholdField
                          key={field.key}
                          field={field}
                          value={thresholds[field.key]}
                          defaultValue={defaults[field.key]}
                          inputValue={inputValues[field.key]}
                          onChangeInput={handleInputChange}
                          onBlur={handleInputBlur}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-[var(--text-secondary)]">AI Log Analysis — System Prompt</h4>
                    {isAiPromptModified && (
                      <button
                        onClick={resetAiPrompt}
                        className="text-xs text-[var(--accent)] hover:underline"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mb-2">
                    The system prompt sent to the LLM when analyzing log errors. Customise to adjust analysis focus, severity criteria, or output format.
                  </p>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => handleAiPromptChange(e.target.value)}
                    rows={10}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-[var(--bg-primary)] border border-[var(--border-default)]
                               text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-y"
                  />
                  {isAiPromptModified && (
                    <span className="text-[10px] text-[var(--neon-amber)]">Modified from default</span>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="glass-card p-4 space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Messaging</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Select the DSS mail channel used for outreach emails.
              </p>
            </div>
            <label className="block space-y-1 max-w-sm">
              <span className="text-sm font-medium text-[var(--text-primary)]">DSS Mail Channel</span>
              {mailChannels.length > 0 ? (
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  className="mt-1 input-glass w-full"
                >
                  {mailChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.label}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic mt-1">
                  No mail channels available. They load during Phase 2 of the main loader.
                </p>
              )}
            </label>
          </section>

          {/* Tracking Backend Status */}
          <section className="glass-card p-4 space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Tracking Database Backend</h3>
              <p className="text-sm text-[var(--text-muted)]">
                View and manage the tracking storage backend. Configure a SQL connection in Plugin Settings to use an external database.
              </p>
            </div>
            {backendStatusLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                Loading backend status...
              </div>
            ) : backendStatus ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-glass)]">
                    <span className="text-xs font-medium text-[var(--text-muted)] block mb-1">Current Backend</span>
                    <span className={`text-sm font-semibold ${
                      backendStatus.effective_backend === 'sql' ? 'text-[var(--neon-green)]' :
                      backendStatus.effective_backend === 'sqlite' ? 'text-[var(--accent)]' :
                      'text-[var(--neon-red)]'
                    }`}>
                      {backendStatus.effective_backend === 'sql'
                        ? `SQL Connection: ${backendStatus.connection_name}`
                        : backendStatus.effective_backend === 'sqlite'
                        ? 'SQLite (local)'
                        : backendStatus.effective_backend === 'unconfigured'
                        ? 'Not configured'
                        : 'Unavailable'}
                    </span>
                    {backendStatus.table_prefix && backendStatus.effective_backend === 'sql' && (
                      <span className="text-xs text-[var(--text-muted)] block mt-0.5">
                        Table Prefix: {backendStatus.table_prefix}
                      </span>
                    )}
                    {backendStatus.sql_connection_healthy === false && (
                      <span className="text-xs text-[var(--neon-red)] block mt-0.5">
                        Connection unhealthy
                      </span>
                    )}
                  </div>
                  <div className="p-3 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-glass)]">
                    <span className="text-xs font-medium text-[var(--text-muted)] block mb-1">Local SQLite</span>
                    {backendStatus.sqlite_exists ? (
                      <span className="text-sm text-[var(--text-primary)]">
                        {backendStatus.sqlite_has_data ? 'Has data' : 'Empty'}
                      </span>
                    ) : (
                      <span className="text-sm text-[var(--text-muted)]">Not found</span>
                    )}
                  </div>
                </div>

                {/* Migration controls */}
                {backendStatus.connection_name && backendStatus.sqlite_has_data && backendStatus.effective_backend === 'sql' && (
                  <div className="p-3 rounded-lg border border-[var(--neon-amber)]/30 bg-[var(--neon-amber)]/5">
                    <p className="text-sm text-[var(--text-primary)] mb-2">
                      A SQL connection is configured and local SQLite has data. You can migrate the data to the SQL backend.
                    </p>
                    <button
                      onClick={startMigration}
                      disabled={migrating || backendStatus.migration_running}
                      className="px-3 py-1.5 rounded btn-primary text-sm disabled:opacity-50"
                    >
                      {migrating || backendStatus.migration_running ? 'Migrating...' : 'Migrate to SQL'}
                    </button>
                  </div>
                )}
                {backendStatus.connection_name && backendStatus.sqlite_has_data && backendStatus.effective_backend === 'sqlite' && (
                  <p className="text-xs text-[var(--text-muted)] italic">
                    SQL connection is configured but not yet active. Restart the webapp to activate, then migrate data.
                  </p>
                )}

                {/* Migration result */}
                {migrationResult && (
                  <div className={`p-3 rounded-lg border ${
                    migrationResult.ok
                      ? 'border-[var(--neon-green)]/30 bg-[var(--neon-green)]/5'
                      : 'border-[var(--neon-red)]/30 bg-[var(--neon-red)]/5'
                  }`}>
                    <p className={`text-sm font-semibold mb-2 ${
                      migrationResult.ok ? 'text-[var(--neon-green)]' : 'text-[var(--neon-red)]'
                    }`}>
                      {migrationResult.ok
                        ? 'Migration completed successfully'
                        : 'Migration completed with issues'}
                    </p>
                    {migrationResult.backend_switched && (
                      <p className="text-xs text-[var(--neon-green)] mb-2">Backend switched to SQL</p>
                    )}
                    <div className="overflow-auto max-h-[200px]">
                      <table className="table-dark text-xs">
                        <thead>
                          <tr>
                            <th>Table</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(migrationResult.validation).map(([table, status]) => (
                            <tr key={table}>
                              <td className="font-mono">{table}</td>
                              <td className={status.startsWith('OK') ? 'text-[var(--neon-green)]' : 'text-[var(--neon-amber)]'}>
                                {status}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {backendStatus.error && (
                  <p className="text-xs text-[var(--neon-red)]">{backendStatus.error}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] italic">Could not load backend status.</p>
            )}
          </section>

          <section className="glass-card p-4 space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Campaign Toggles</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Disable campaigns to stop email sends, finding tracking, and visibility in tracking views.
              </p>
            </div>
            {campaignSettingsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                Loading campaign settings...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {campaignEntries.map(({ id, label, enabled }) => (
                  <label
                    key={id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--border-glass)] bg-[var(--bg-glass)] cursor-pointer hover:bg-[var(--bg-glass-hover)] transition-colors"
                  >
                    <span className={`text-sm font-medium ${enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      {label}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggleCampaign(id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-glass-hover)]'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${enabled ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="glass-card p-4 space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Campaign Exemptions</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Exempt specific projects from campaigns. Exempted projects won't generate findings or receive outreach emails. Health scores are not affected.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Campaign</span>
                <select
                  value={newExemptionCampaign}
                  onChange={(e) => setNewExemptionCampaign(e.target.value)}
                  className="input-glass text-sm"
                >
                  {CAMPAIGN_IDS.map((id) => (
                    <option key={id} value={id}>
                      {CAMPAIGN_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Project Key</span>
                <SearchableCombobox
                  value={newExemptionKey}
                  onChange={setNewExemptionKey}
                  options={projectKeys}
                  placeholder="PROJECT_KEY"
                  className="input-glass text-sm font-mono w-48"
                  onEnterWithClosed={addExemption}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Reason (optional)</span>
                <input
                  value={newExemptionReason}
                  onChange={(e) => setNewExemptionReason(e.target.value)}
                  placeholder="e.g. Approved by admin"
                  className="input-glass text-sm w-56"
                  onKeyDown={(e) => { if (e.key === 'Enter') addExemption(); }}
                />
              </label>
              <button
                onClick={addExemption}
                disabled={exemptionSaving || !newExemptionKey.trim()}
                className="px-3 py-1.5 rounded btn-primary text-sm disabled:opacity-50"
              >
                {exemptionSaving ? 'Adding...' : 'Add'}
              </button>
            </div>

            {exemptionsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                Loading exemptions...
              </div>
            ) : exemptions.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] italic py-2">No exemptions configured.</p>
            ) : (
              <div className="overflow-auto max-h-[320px] border border-[var(--border-glass)] rounded-lg">
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Project Key</th>
                      <th>Reason</th>
                      <th>Created</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {exemptions.map((ex) => (
                      <tr key={ex.exemption_id}>
                        <td className="text-sm text-[var(--text-primary)]">
                          {CAMPAIGN_LABELS[ex.campaign_id] ?? ex.campaign_id}
                        </td>
                        <td className="font-mono text-xs text-[var(--text-secondary)]">{ex.entity_key}</td>
                        <td className="text-xs text-[var(--text-muted)]">{ex.reason ?? '—'}</td>
                        <td className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                          {ex.created_at?.replace('T', ' ').replace('Z', '') ?? '—'}
                        </td>
                        <td>
                          <button
                            onClick={() => removeExemption(ex.exemption_id)}
                            className="text-[var(--neon-red)] hover:text-red-300 text-xs px-1"
                            title="Remove exemption"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
}
