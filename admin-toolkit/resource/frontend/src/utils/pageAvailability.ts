import type { ParsedData, PageId } from '../types';

export type PageAvailability = 'ready' | 'loading' | 'independent';

/**
 * Returns visual availability state for sidebar dimming.
 * - 'independent': always full color (instant data, self-fetching, or always-available)
 * - 'ready': data loaded — full color
 * - 'loading': data not yet loaded — show dimmed
 *
 * NOTE: This is purely visual. All pages remain navigable regardless of state.
 */
export function getPageAvailability(d: ParsedData, pageId: PageId): PageAvailability {
  switch (pageId) {
    // Always available — instant, self-loading, or independent
    case 'summary':
    case 'issues':
    case 'settings':
    case 'tracking': // independent DB
    case 'directory': // on-demand via apiDirTree
    case 'project-cleaner': // fetches /api/tools/inactive-projects itself
    case 'plugins': // PluginComparator fetches its own data
      return 'independent';

    // Phase 1 — overview data
    case 'filesystem':
      return d.filesystemInfo ? 'ready' : 'loading';
    case 'memory':
      return d.memoryInfo ? 'ready' : 'loading';

    // Phase 2 — secondary data
    case 'connections':
      return d.connections && Object.keys(d.connections).length > 0 ? 'ready' : 'loading';
    case 'runtime-config':
      return d.generalSettings && Object.keys(d.generalSettings).length > 0 ? 'ready' : 'loading';
    case 'logs':
      return d.formattedLogErrors !== undefined ? 'ready' : 'loading';

    // Phase 3 — heavy data (must wait for analysis to complete, not just list to load)
    case 'projects':
      return Array.isArray(d.projects) && d.analysisLoading?.active === false ? 'ready' : 'loading';
    case 'code-envs':
    case 'code-env-cleaner':
      return Array.isArray(d.codeEnvs) && d.codeEnvs.length > 0 && d.codeEnvsLoading?.active === false
        ? 'ready'
        : 'loading';
    case 'outreach':
      return (
        Array.isArray(d.codeEnvs) &&
        d.codeEnvs.length > 0 &&
        Array.isArray(d.projects) &&
        d.projects.length > 0 &&
        Array.isArray(d.users) &&
        d.users.length > 0 &&
        d.analysisLoading?.active === false
      )
        ? 'ready'
        : 'loading';

    default:
      return 'independent';
  }
}
