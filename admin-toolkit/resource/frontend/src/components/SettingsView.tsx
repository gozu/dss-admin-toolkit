import { useCallback, useEffect, useMemo, useState } from 'react';
import { Container } from './Container';
import { SearchableCombobox } from './SearchableCombobox';
import { useDiag } from '../context/DiagContext';
import { useUltraWideLayout } from '../hooks';
import { useThresholds, type ThresholdSettings } from '../hooks/useThresholds';
import { fetchJson } from '../utils/api';
import { loadFromStorage, saveToStorage } from '../utils/storage';
import type { CampaignExemption } from '../types';

interface SettingsViewProps {
  onBack: () => void;
}

const fields: Array<{ key: keyof ThresholdSettings; label: string; description: string; min: number; max: number; step: number }> = [
  { key: 'codeEnvCountUnhealthy', label: 'Code Env Count Threshold', description: 'Projects with more code envs than this are flagged unhealthy.', min: 0, max: 20, step: 1 },
  { key: 'codeStudioCountUnhealthy', label: 'Code Studio Count Threshold', description: 'Projects with more Code Studios than this are flagged.', min: 0, max: 50, step: 1 },
  { key: 'filesystemWarningPct', label: 'Filesystem Warning %', description: 'Filesystem usage above this triggers a warning.', min: 0, max: 100, step: 5 },
  { key: 'filesystemCriticalPct', label: 'Filesystem Critical %', description: 'Filesystem usage above this triggers a critical alert.', min: 0, max: 100, step: 5 },
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

export function SettingsView({ onBack }: SettingsViewProps) {
  const { ultraWideEnabled } = useUltraWideLayout();
  const { thresholds, setThreshold, resetDefaults, defaults } = useThresholds();
  const [inputValues, setInputValues] = useState<Partial<Record<keyof ThresholdSettings, string>>>({});
  const { state } = useDiag();
  const { parsedData } = state;

  const mailChannels = useMemo(() => parsedData.mailChannels ?? [], [parsedData.mailChannels]);
  const [selectedChannel, setSelectedChannel] = useState(() =>
    loadFromStorage('selectedChannel', ''),
  );

  // Auto-select first mail channel when available and none selected
  useEffect(() => {
    if (!selectedChannel && mailChannels.length > 0) {
      setSelectedChannel(mailChannels[0].id);
    }
  }, [selectedChannel, mailChannels]);

  // Persist selected channel
  useEffect(() => {
    saveToStorage('selectedChannel', selectedChannel);
  }, [selectedChannel]);

  const isDefault = fields.every((f) => thresholds[f.key] === defaults[f.key]);

  // Campaign toggle state
  const [campaignSettings, setCampaignSettings] = useState<Record<string, boolean>>({});
  const [campaignSettingsLoading, setCampaignSettingsLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ campaigns: Record<string, boolean> }>('/api/tracking/campaign-settings')
      .then((data) => setCampaignSettings(data.campaigns))
      .catch(() => {})
      .finally(() => setCampaignSettingsLoading(false));
  }, []);

  const toggleCampaign = useCallback((campaignId: string) => {
    const current = campaignSettings[campaignId] ?? true;
    const next = !current;
    // Optimistic update
    setCampaignSettings((prev) => ({ ...prev, [campaignId]: next }));
    fetchJson('/api/tracking/campaign-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, enabled: next }),
    }).catch(() => {
      // Revert on error
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
  const [exemptionsLoading, setExemptionsLoading] = useState(true);
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
    // Optimistic removal
    setExemptions((prev) => prev.filter((e) => e.exemption_id !== exemptionId));
    fetchJson('/api/tracking/exemptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exemption_id: exemptionId }),
    }).catch(() => {
      // Revert by re-fetching
      fetchJson<{ exemptions: CampaignExemption[] }>('/api/tracking/exemptions')
        .then((data) => setExemptions(data.exemptions))
        .catch(() => {});
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

          <section className="glass-card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{field.label}</span>
                  <p className="text-xs text-[var(--text-muted)]">{field.description}</p>
                  <input
                    type="number"
                    value={inputValues[field.key] ?? thresholds[field.key]}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setInputValues((prev) => ({ ...prev, [field.key]: raw }));
                      const v = Number(raw);
                      if (raw !== '' && !Number.isNaN(v)) setThreshold(field.key, v);
                    }}
                    onBlur={() => {
                      setInputValues((prev) => {
                        const next = { ...prev };
                        delete next[field.key];
                        return next;
                      });
                    }}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    className="mt-1 w-full input-glass font-mono"
                  />
                  {thresholds[field.key] !== defaults[field.key] && (
                    <span className="text-[10px] text-[var(--neon-amber)]">
                      Default: {defaults[field.key]}
                    </span>
                  )}
                </label>
              ))}
            </div>
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
