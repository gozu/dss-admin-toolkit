/**
 * LlmAuditParser — builds one LlmAuditRow per LLM-Mesh connection found in
 * connections.json, counting project references from recipes and agentic assets.
 *
 * Classification (status, currentModel, pricing) is NOT done here; it is
 * applied later in LlmAuditPage once the LiteLLM catalog has been fetched.
 */

import type { ConnectionDetail, ExtractedFiles, LlmAuditRow } from '../types';
import { NOT_APPLICABLE_TYPES } from '../lib/llmAudit';

// Connection types that map to LLM-Mesh entries in connections.json.
// These match the `params.llm.type` values used by DSS.
const LLM_DSS_TYPES = new Set([
  'OPENAI',
  'AZURE_OPENAI_DEPLOYMENT',
  'ANTHROPIC',
  'BEDROCK',
  'VERTEX',
  'SNOWFLAKE_CORTEX',
  'HUGGINGFACE_TRANSFORMER_LOCAL',
  'CUSTOM',
  // Wrapper types — included so we can surface them but they will be
  // classified as not_applicable and filtered out before display.
  'SAVED_MODEL_AGENT',
  'RETRIEVAL_AUGMENTED',
]);

// Assets we scan for `llmId` / connection references.
const AGENTIC_PATH_SEGMENTS = [
  'agent-tools',
  'retrieval-augmented-llms',
  'knowledge-banks',
  'saved_models',
];

function projectKeyFromPath(path: string): string | null {
  const idx = path.indexOf('/projects/');
  if (idx < 0) return null;
  const rest = path.slice(idx + '/projects/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return rest.slice(0, slash);
}

interface LlmAuditParserResult {
  rows: LlmAuditRow[];
}

export class LlmAuditParser {
  private extractedFiles: ExtractedFiles;
  private connectionDetails: ConnectionDetail[];

  constructor(extractedFiles: ExtractedFiles, connectionDetails: ConnectionDetail[]) {
    this.extractedFiles = extractedFiles;
    this.connectionDetails = connectionDetails;
  }

  parse(): LlmAuditParserResult {
    // Build a map of connectionName -> LlmAuditRow skeleton for every LLM-Mesh connection.
    const rowMap = new Map<string, LlmAuditRow>();

    for (const cd of this.connectionDetails) {
      if (!cd.llmParams) continue;
      const llmType = cd.llmParams.type || '';
      if (!LLM_DSS_TYPES.has(llmType)) continue;
      // Filter out not-applicable wrapper types before they reach the table.
      if (NOT_APPLICABLE_TYPES.has(llmType)) continue;

      const llmId = cd.name;
      rowMap.set(cd.name, {
        llmId,
        status: 'unknown',
        friendlyName: cd.name,
        friendlyNameShort: cd.name,
        type: llmType,
        connection: cd.name,
        rawModel: cd.llmParams.model || '',
        effectiveModel: cd.llmParams.model || cd.llmParams.deployment || '',
        currentModel: '',
        modelInputPrice: null,
        modelOutputPrice: null,
        currentInputPrice: null,
        currentOutputPrice: null,
        provider: '',
        family: '',
        projectsUsing: 0,
        referencingProjects: [],
      });
    }

    if (rowMap.size === 0) return { rows: [] };

    // Scan project files to count how many projects reference each connection.
    // We match on `llmId` values whose prefix (before ":") is a known connection name,
    // and on direct `connection` / `modelConnection` string fields.
    const referencingSet = new Map<string, Set<string>>(); // connectionName -> Set<projectKey>

    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      const projectKey = projectKeyFromPath(filePath);
      if (!projectKey) continue;
      if (!filePath.endsWith('.json')) continue;

      const isRecipe = filePath.includes(`/projects/${projectKey}/recipes/`);
      const isAgentic = AGENTIC_PATH_SEGMENTS.some((seg) =>
        filePath.includes(`/projects/${projectKey}/${seg}/`),
      );
      if (!isRecipe && !isAgentic) continue;

      let data: unknown;
      try { data = JSON.parse(content); } catch { continue; }

      // Walk the parsed JSON tree collecting llmId-like strings.
      const foundIds = new Set<string>();
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj['llmId'] === 'string') foundIds.add(obj['llmId']);
        if (typeof obj['connection'] === 'string') foundIds.add(obj['connection']);
        if (typeof obj['modelConnection'] === 'string') foundIds.add(obj['modelConnection']);
        if (obj['llm'] && typeof obj['llm'] === 'object') {
          const llm = obj['llm'] as Record<string, unknown>;
          if (typeof llm['id'] === 'string') foundIds.add(llm['id']);
          if (typeof llm['connection'] === 'string') foundIds.add(llm['connection']);
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') walk(v);
        }
      };
      walk(data);

      for (const id of foundIds) {
        // Extract connection name: either the whole string or the part before ":"
        const colon = id.indexOf(':');
        const connName = colon > 0 ? id.slice(0, colon) : id;
        if (rowMap.has(connName)) {
          if (!referencingSet.has(connName)) referencingSet.set(connName, new Set());
          referencingSet.get(connName)!.add(projectKey);
        }
      }
    }

    // Populate project reference counts.
    for (const [connName, projects] of referencingSet.entries()) {
      const row = rowMap.get(connName);
      if (!row) continue;
      row.projectsUsing = projects.size;
      row.referencingProjects = Array.from(projects).sort();
    }

    return { rows: Array.from(rowMap.values()) };
  }
}
