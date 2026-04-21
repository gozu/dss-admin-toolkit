import type { ExtractedFiles } from '../types';

export interface PluginDetail {
  id: string;
  label: string;
  installedVersion?: string;
  isDev?: boolean;
}

interface PluginDiscoveryResult {
  plugins: string[];
  pluginsCount: number;
  pluginDetails: PluginDetail[];
}

interface PluginJSON {
  id?: string;
  version?: string;
  kind?: string;
  meta?: {
    label?: string;
    version?: string;
    kind?: string;
  };
}

export class PluginDiscoveryParser {
  private extractedFiles: ExtractedFiles;

  constructor(extractedFiles: ExtractedFiles) {
    this.extractedFiles = extractedFiles;
  }

  parse(): PluginDiscoveryResult {
    const pluginDirs = new Set<string>();
    const detailsByDir = new Map<string, PluginDetail>();

    for (const path in this.extractedFiles) {
      if (!path.includes('/plugins/')) continue;

      const parts = path.split('/');
      const pluginsIndex = parts.indexOf('plugins');
      if (pluginsIndex < 0 || pluginsIndex + 1 >= parts.length) continue;

      const pluginDir = parts[pluginsIndex + 1];
      if (!pluginDir || pluginDir.length === 0 || pluginDir.includes('.')) continue;

      pluginDirs.add(pluginDir);

      // Parse plugin.json if this is one
      if (path.endsWith('/plugin.json')) {
        try {
          const data: PluginJSON = JSON.parse(this.extractedFiles[path]);
          const id = data.id || pluginDir;
          const label = data.meta?.label || id;
          const installedVersion = data.meta?.version || data.version;
          const kind = data.meta?.kind || data.kind;
          const isDev = kind === 'DEV';
          detailsByDir.set(pluginDir, { id, label, installedVersion, isDev });
        } catch {
          // ignore unparseable plugin.json
        }
      }
    }

    const plugins = Array.from(pluginDirs).sort();
    const pluginDetails: PluginDetail[] = plugins.map((dir) => {
      const detail = detailsByDir.get(dir);
      if (detail) return detail;
      return { id: dir, label: dir };
    });

    return {
      plugins,
      pluginsCount: pluginDirs.size,
      pluginDetails,
    };
  }
}
