import { Modal } from './Modal';
import type { Project, AgentInfo } from '../types';

interface AgenticDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

const COLOR_STYLES = {
  cyan: {
    badge: 'bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/25',
    pill: 'bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/25',
  },
  purple: {
    badge: 'bg-[var(--neon-purple)]/10 text-[var(--neon-purple)] border border-[var(--neon-purple)]/25',
    pill: 'bg-[var(--neon-purple)]/15 text-[var(--neon-purple)] border border-[var(--neon-purple)]/25',
  },
  green: {
    badge: 'bg-[var(--neon-green)]/10 text-[var(--neon-green)] border border-[var(--neon-green)]/25',
    pill: 'bg-[var(--neon-green)]/15 text-[var(--neon-green)] border border-[var(--neon-green)]/25',
  },
  amber: {
    badge: 'bg-[var(--neon-amber)]/10 text-[var(--neon-amber)] border border-[var(--neon-amber)]/25',
    pill: 'bg-[var(--neon-amber)]/15 text-[var(--neon-amber)] border border-[var(--neon-amber)]/25',
  },
  muted: {
    badge: 'bg-[var(--text-secondary)]/10 text-[var(--text-secondary)] border border-[var(--text-secondary)]/25',
    pill: 'bg-[var(--text-secondary)]/15 text-[var(--text-secondary)] border border-[var(--text-secondary)]/25',
  },
} as const;

type ColorKey = keyof typeof COLOR_STYLES;

export function AgenticDetailsModal({
  isOpen,
  onClose,
  project,
}: AgenticDetailsModalProps) {
  if (!project || !project.agenticFeatures) return null;

  const feat = project.agenticFeatures;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Agentic Features: ${project.name}`}
    >
      {/* Project summary */}
      <div className="bg-[var(--bg-elevated)] rounded-lg p-4 mb-6 border border-[var(--border-glass)]">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">Project Key:</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">{project.key}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Owner:</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">{project.owner}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Total Features:</span>
            <span className="ml-2 font-medium text-[var(--neon-purple)]">{feat.total}</span>
          </div>
        </div>
      </div>

      {feat.agents.length > 0 && (
        <FeatureSection title="Agents" count={feat.agents.length} color="cyan" items={feat.agents} />
      )}

      {feat.agentTools.length > 0 && (
        <FeatureSection title="Agent Tools" count={feat.agentTools.length} color="purple" items={feat.agentTools} />
      )}

      {feat.chatUIs.length > 0 && (
        <FeatureSection title="Chat UIs" count={feat.chatUIs.length} color="green" items={feat.chatUIs} />
      )}

      {feat.agentReviews.length > 0 && (
        <FeatureSection title="Agent Reviews" count={feat.agentReviews.length} color="amber" items={feat.agentReviews} />
      )}

      {feat.knowledgeBanks > 0 && (
        <div className="mb-6">
          <h4 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Knowledge Banks
            <span className={`ml-2 px-2 py-0.5 text-xs font-medium rounded-full ${COLOR_STYLES.muted.badge}`}>
              {feat.knowledgeBanks}
            </span>
          </h4>
          <div className="border border-[var(--border-glass)] rounded-lg p-4 bg-[var(--bg-surface)]">
            <span className="text-sm text-[var(--text-secondary)]">
              {feat.knowledgeBanks} knowledge bank{feat.knowledgeBanks !== 1 ? 's' : ''} configured
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FeatureSection({
  title,
  count,
  color,
  items,
}: {
  title: string;
  count: number;
  color: ColorKey;
  items: AgentInfo[];
}) {
  const styles = COLOR_STYLES[color];

  return (
    <div className="mb-6">
      <h4 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
        {title}
        <span className={`ml-2 px-2 py-0.5 text-xs font-medium rounded-full ${styles.badge}`}>
          {count}
        </span>
      </h4>

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="border border-[var(--border-glass)] rounded-lg p-3 bg-[var(--bg-surface)] flex items-center justify-between"
          >
            <span className="font-medium text-[var(--text-primary)]">{item.name}</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${styles.pill}`}>
              {item.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
