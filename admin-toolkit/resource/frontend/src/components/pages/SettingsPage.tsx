import { useState } from 'react';
import { useDiag } from '../../context/DiagContext';
import { loadFromStorage, saveToStorage } from '../../utils/storage';

export const SELECTED_MAIL_CHANNEL_STORAGE_KEY = 'selectedMailChannel';

export function SettingsPage() {
  const { state } = useDiag();
  const mailChannels = state.parsedData.mailChannels ?? [];

  const [stored, setStored] = useState<string>(() =>
    loadFromStorage<string>(SELECTED_MAIL_CHANNEL_STORAGE_KEY, ''),
  );

  const isStoredValid = !!stored && mailChannels.some((c) => c.id === stored);
  const selectedChannel = isStoredValid ? stored : mailChannels[0]?.id ?? '';

  const handleChange = (id: string) => {
    setStored(id);
    saveToStorage(SELECTED_MAIL_CHANNEL_STORAGE_KEY, id);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">
      <section className="glass-card p-4 space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Messaging</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Select the DSS mail channel used for outreach emails. Only email-type messaging channels are listed.
          </p>
        </div>
        <label className="block space-y-1 max-w-sm">
          <span className="text-sm font-medium text-[var(--text-primary)]">DSS Mail Channel</span>
          {mailChannels.length > 0 ? (
            <select
              value={selectedChannel}
              onChange={(e) => handleChange(e.target.value)}
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
    </div>
  );
}
