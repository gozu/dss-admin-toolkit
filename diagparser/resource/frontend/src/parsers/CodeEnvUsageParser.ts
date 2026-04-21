import type { CodeEnvUsage, ExtractedFiles } from '../types';

interface CodeEnvUsageResult {
  codeEnvUsages: Record<string, CodeEnvUsage[]>;
}

interface ProjectParamsJSON {
  settings?: {
    codeEnvs?: {
      python?: { mode?: string; envName?: string };
      r?: { mode?: string; envName?: string };
    };
  };
}

interface RecipeJSON {
  type?: string;
  params?: {
    envSelection?: {
      envMode?: string;
      envName?: string;
    };
  };
}

// Recipe types that consume a Python or R code env. Any other type has no envSelection.
const PYTHON_RECIPE_TYPES = new Set([
  'python',
  'python_step',
  'custom_python',
  'pyspark',
  'streaming_python',
  'code_studio',
]);
const R_RECIPE_TYPES = new Set(['r', 'custom_r']);

function recipeLang(type?: string): 'python' | 'r' | null {
  if (!type) return null;
  if (PYTHON_RECIPE_TYPES.has(type)) return 'python';
  if (R_RECIPE_TYPES.has(type)) return 'r';
  return null;
}

export class CodeEnvUsageParser {
  private extractedFiles: ExtractedFiles;

  constructor(extractedFiles: ExtractedFiles) {
    this.extractedFiles = extractedFiles;
  }

  parse(): CodeEnvUsageResult {
    const usages: Record<string, CodeEnvUsage[]> = {};
    // Remember per-project default Python/R envs so INHERIT-mode recipes can resolve.
    const projectDefaults: Record<string, { python?: string; r?: string }> = {};

    const append = (envName: string, usage: CodeEnvUsage) => {
      if (!envName) return;
      if (!usages[envName]) usages[envName] = [];
      usages[envName].push(usage);
    };

    // First pass: project defaults from params.json
    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      const m = filePath.match(/\/projects\/([^/]+)\/params\.json$/);
      if (!m) continue;
      const projectKey = m[1];
      try {
        const data: ProjectParamsJSON = JSON.parse(content);
        const codeEnvs = data.settings?.codeEnvs;
        if (!codeEnvs) continue;
        const defaults: { python?: string; r?: string } = {};

        const py = codeEnvs.python;
        if (py && py.mode && py.mode !== 'USE_BUILTIN_ENV' && py.envName) {
          defaults.python = py.envName;
          append(py.envName, {
            projectKey,
            usageType: 'project-default-python',
          });
        }

        const r = codeEnvs.r;
        if (r && r.mode && r.mode !== 'USE_BUILTIN_ENV' && r.envName) {
          defaults.r = r.envName;
          append(r.envName, {
            projectKey,
            usageType: 'project-default-r',
          });
        }

        projectDefaults[projectKey] = defaults;
      } catch {
        // ignore
      }
    }

    // Second pass: per-recipe envSelection
    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      const m = filePath.match(/\/projects\/([^/]+)\/recipes\/([^/]+)\.json$/);
      if (!m) continue;
      const [, projectKey, recipeName] = m;
      try {
        const data: RecipeJSON = JSON.parse(content);
        const sel = data.params?.envSelection;
        if (!sel) continue;

        let envName = sel.envName;
        if (sel.envMode === 'INHERIT' || !envName) {
          // Resolve to project default for the recipe's language.
          const lang = recipeLang(data.type);
          if (!lang) continue;
          envName = projectDefaults[projectKey]?.[lang];
          if (!envName) continue;
        } else if (sel.envMode === 'USE_BUILTIN_ENV') {
          continue;
        }

        append(envName, {
          projectKey,
          recipeName,
          usageType: 'recipe',
        });
      } catch {
        // ignore
      }
    }

    return { codeEnvUsages: usages };
  }
}
