import type { ParsedData, PageId } from '../types';
import { hasInactiveProjectsCache } from '../components/InactiveProjectCleaner';

export type PageAvailability = 'ready' | 'partial' | 'loading' | 'independent';

/**
 * Returns visual availability state for sidebar dimming.
 * - 'independent': always full color (instant data, self-fetching, or always-available)
 * - 'ready': all data loaded — full color + light-up animation
 * - 'partial': core data loaded, supplementary still loading — reduced opacity
 * - 'loading': data not yet loaded — show dimmed
 *
 * NOTE: This is purely visual. All pages remain navigable regardless of state.
 */
export function getPageAvailability(d: ParsedData, pageId: PageId): PageAvailability {
  // Shared: outreach core data fully loaded?
  const outreachReady =
    Array.isArray(d.codeEnvs) && d.codeEnvs.length > 0 &&
    Array.isArray(d.projectFootprint) && d.projectFootprint.length > 0 &&
    Array.isArray(d.users) && d.users.length > 0 &&
    d.analysisLoading?.active === false;

  switch (pageId) {
    // Always available — instant, self-loading, or independent
    case 'summary':
    case 'issues':
    case 'project-cleaner':
      return hasInactiveProjectsCache() ? 'ready' : 'loading';
    case 'plugins': // PluginComparator fetches its own data
    case 'directory': // manual-only, loads on user action
    case 'db-health': // self-fetching, queries PG directly
      return 'independent';

    // Compliance depends on outreach data — mirrors outreach states
    case 'tracking':
      if (!outreachReady) return 'loading';
      return d.outreachApiLoaded ? 'ready' : 'partial';

    // Report needs everything completely finished
    case 'report':
      return (outreachReady && d.outreachApiLoaded) ? 'ready' : 'loading';

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
      return Array.isArray(d.projectFootprint) && d.projectFootprint.length > 0 && d.analysisLoading?.active === false
        ? 'ready'
        : 'loading';
    case 'code-env-cleaner':
      return Array.isArray(d.codeEnvs) && d.codeEnvs.length > 0 && d.codeEnvsLoading?.active === false
        ? 'ready'
        : 'loading';
    case 'code-envs': {
      const envsLoaded = Array.isArray(d.codeEnvs) && d.codeEnvs.length > 0 && d.codeEnvsLoading?.active === false;
      if (!envsLoaded) return 'loading';
      return d.codeEnvSizes && Object.keys(d.codeEnvSizes).length > 0 ? 'ready' : 'partial';
    }
    case 'code-envs-comparison':
      return d.codeEnvsCompare != null
        ? 'ready'
        : 'loading';
    case 'outreach':
      if (!outreachReady) return 'loading';
      return d.outreachApiLoaded ? 'ready' : 'partial';

    default:
      return 'independent';
  }
}
