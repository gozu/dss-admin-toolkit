import type { ConnectionDetail, ExtractedFiles } from '../types';

export interface ConnectionDatasetUsage {
  connectionName: string;
  projectKey: string;
  datasetName: string;
}

export interface ConnectionLlmUsage {
  connectionName: string;
  projectKey: string;
  llmId?: string;
  usageContext: 'agent' | 'agent-tool' | 'retrieval-llm' | 'knowledge-bank';
  objectName: string;
}

export interface ConnectionUsageResult {
  connectionDatasetUsages: ConnectionDatasetUsage[];
  connectionLlmUsages: ConnectionLlmUsage[];
  connectionUsageTotal: number;
  connectionUsageScanned: number;
}

// saved_models/ holds both agents and regular ML models. Only these types are agents.
const AGENT_SAVED_MODEL_TYPES = new Set([
  'TOOLS_USING_AGENT',
  'PYTHON_AGENT',
  'STRUCTURED_AGENT',
]);

// Connection types considered LLM-Mesh-capable. Mirrors the hardcoded set used
// by admin-toolkit's connection-usage scan.
const LLM_MESH_CONNECTION_TYPES = new Set([
  'OpenAI',
  'AzureOpenAI',
  'Anthropic',
  'Bedrock',
  'VertexAI',
  'PaLM',
  'HuggingFace',
  'Mistral',
  'Cohere',
  'LLMAPIGateway',
  'LocalLLM',
  'OpenAICompatible',
  'OpenAIAzureManaged',
  'DataikuLLMMesh',
]);

interface DatasetJSON {
  name?: string;
  params?: { connection?: string };
}

interface LlmRefHolder {
  llmId?: string;
  llm?: { id?: string; connection?: string };
  connection?: string;
  modelConnection?: string;
}

function projectKeyFromPath(path: string): string | null {
  const idx = path.indexOf('/projects/');
  if (idx < 0) return null;
  const rest = path.substring(idx + '/projects/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return rest.substring(0, slash);
}

function lastSegment(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1].replace(/\.json$/, '');
}

export class ConnectionUsageParser {
  private extractedFiles: ExtractedFiles;
  private connectionDetails: ConnectionDetail[];

  constructor(extractedFiles: ExtractedFiles, connectionDetails: ConnectionDetail[]) {
    this.extractedFiles = extractedFiles;
    this.connectionDetails = connectionDetails;
  }

  parse(): ConnectionUsageResult {
    const datasetUsages: ConnectionDatasetUsage[] = [];
    const llmUsages: ConnectionLlmUsage[] = [];

    const llmConnectionNames = new Set(
      this.connectionDetails
        .filter((c) => LLM_MESH_CONNECTION_TYPES.has(c.type))
        .map((c) => c.name),
    );

    let scanned = 0;
    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      const projectKey = projectKeyFromPath(filePath);
      if (!projectKey) continue;

      // Datasets: params.connection
      if (filePath.includes(`/projects/${projectKey}/datasets/`) && filePath.endsWith('.json')) {
        scanned++;
        try {
          const data: DatasetJSON = JSON.parse(content);
          const conn = data.params?.connection;
          if (conn) {
            datasetUsages.push({
              connectionName: conn,
              projectKey,
              datasetName: data.name || lastSegment(filePath),
            });
          }
        } catch {
          // ignore
        }
        continue;
      }

      // Agents live in saved_models/ in DSS 13+. Filter by savedModelType so we
      // don't tag regular ML saved_models as agents.
      if (filePath.includes(`/projects/${projectKey}/saved_models/`) && filePath.endsWith('.json')) {
        let modelType: string | undefined;
        try {
          modelType = JSON.parse(content)?.savedModelType;
        } catch {
          continue;
        }
        if (!modelType || !AGENT_SAVED_MODEL_TYPES.has(modelType)) continue;
        scanned++;
        this.collectLlmRefs(content, {
          projectKey,
          usageContext: 'agent',
          objectName: lastSegment(filePath),
          llmConnectionNames,
          out: llmUsages,
        });
        continue;
      }

      if (filePath.includes(`/projects/${projectKey}/agent-tools/`) && filePath.endsWith('.json')) {
        scanned++;
        this.collectLlmRefs(content, {
          projectKey,
          usageContext: 'agent-tool',
          objectName: lastSegment(filePath),
          llmConnectionNames,
          out: llmUsages,
        });
        continue;
      }

      if (filePath.includes(`/projects/${projectKey}/retrieval-augmented-llms/`) && filePath.endsWith('.json')) {
        scanned++;
        this.collectLlmRefs(content, {
          projectKey,
          usageContext: 'retrieval-llm',
          objectName: lastSegment(filePath),
          llmConnectionNames,
          out: llmUsages,
        });
        continue;
      }

      if (filePath.includes(`/projects/${projectKey}/knowledge-banks/`) && filePath.endsWith('.json')) {
        scanned++;
        this.collectLlmRefs(content, {
          projectKey,
          usageContext: 'knowledge-bank',
          objectName: lastSegment(filePath),
          llmConnectionNames,
          out: llmUsages,
        });
      }
    }

    return {
      connectionDatasetUsages: datasetUsages,
      connectionLlmUsages: llmUsages,
      connectionUsageTotal: datasetUsages.length + llmUsages.length,
      connectionUsageScanned: scanned,
    };
  }

  private collectLlmRefs(
    content: string,
    opts: {
      projectKey: string;
      usageContext: ConnectionLlmUsage['usageContext'];
      objectName: string;
      llmConnectionNames: Set<string>;
      out: ConnectionLlmUsage[];
    },
  ) {
    // LLM refs can appear in many shapes. Best-effort: parse JSON, recursively
    // search for `llmId` / `connection` fields, match against LLM-Mesh connections.
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      return;
    }

    const foundLlmIds = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown> & LlmRefHolder;

      if (typeof obj.llmId === 'string') foundLlmIds.add(obj.llmId);
      if (obj.llm && typeof obj.llm === 'object' && typeof obj.llm.id === 'string') {
        foundLlmIds.add(obj.llm.id);
      }

      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(data);

    // A DSS LLM ref typically looks like `<connectionName>:<model>`. Extract prefix.
    for (const llmId of foundLlmIds) {
      const colon = llmId.indexOf(':');
      const connName = colon > 0 ? llmId.substring(0, colon) : llmId;
      if (opts.llmConnectionNames.has(connName)) {
        opts.out.push({
          connectionName: connName,
          projectKey: opts.projectKey,
          llmId,
          usageContext: opts.usageContext,
          objectName: opts.objectName,
        });
      }
    }
  }
}
