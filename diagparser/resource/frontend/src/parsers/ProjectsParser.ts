import type { Project, Permission, AgentInfo, AgenticFeatures, ExtractedFiles } from '../types';

interface ProjectsResult {
  projects: Project[];
}

interface ProjectData {
  name?: string;
  owner?: string;
  versionTag?: {
    versionNumber?: number;
  };
  permissions?: Array<{
    group?: string;
    user?: string;
    [key: string]: unknown;
  }>;
}

const AGENT_MODEL_TYPES: Record<string, string> = {
  TOOLS_USING_AGENT: 'Visual Agent',
  PYTHON_AGENT: 'Code Agent',
  STRUCTURED_AGENT: 'Structured Agent',
};

const AGENT_WEBAPP_TYPES: Record<string, string> = {
  'webapp_agent-connect_portal': 'Agent Connect',
  'webapp_agent-hub_agent-hub': 'Agent Hub',
  'webapp_document-question-answering_document-intelligence-explorer': 'Answers',
};

export class ProjectsParser {
  private extractedFiles: ExtractedFiles;
  private projectFiles: string[];
  private log: (message: string) => void;

  constructor(
    extractedFiles: ExtractedFiles,
    projectFiles: string[],
    log: (message: string) => void
  ) {
    this.extractedFiles = extractedFiles;
    this.projectFiles = projectFiles;
    this.log = log;
  }

  private buildAgenticFeatures(projectKey: string): AgenticFeatures {
    const agents: AgentInfo[] = [];
    const agentTools: AgentInfo[] = [];
    const chatUIs: AgentInfo[] = [];
    const agentReviews: AgentInfo[] = [];
    let knowledgeBanks = 0;

    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      // Match files belonging to this project
      if (!filePath.includes(`/projects/${projectKey}/`)) continue;

      try {
        if (filePath.includes('/saved_models/') && filePath.endsWith('.json')) {
          const data = JSON.parse(content);
          const modelType = data.savedModelType;
          if (modelType && modelType in AGENT_MODEL_TYPES) {
            agents.push({
              name: data.name || filePath.split('/').pop()?.replace('.json', '') || 'Unknown',
              type: AGENT_MODEL_TYPES[modelType],
              rawType: modelType,
            });
          }
        } else if (filePath.includes('/web_apps/') && filePath.endsWith('.json')) {
          const data = JSON.parse(content);
          const waType = data.type;
          if (waType && waType in AGENT_WEBAPP_TYPES) {
            chatUIs.push({
              name: data.name || filePath.split('/').pop()?.replace('.json', '') || 'Unknown',
              type: AGENT_WEBAPP_TYPES[waType],
              rawType: waType,
            });
          }
        } else if (filePath.includes('/agent-tools/') && filePath.endsWith('.json')) {
          const data = JSON.parse(content);
          agentTools.push({
            name: data.name || filePath.split('/').pop()?.replace('.json', '') || 'Unknown',
            type: data.type || 'Unknown',
            rawType: data.type || 'Unknown',
          });
        } else if (filePath.includes('/agent_reviews/') && filePath.endsWith('.json')) {
          const data = JSON.parse(content);
          agentReviews.push({
            name: data.name || filePath.split('/').pop()?.replace('.json', '') || 'Unknown',
            type: 'Agent Review',
            rawType: 'agent_review',
          });
        } else if (filePath.includes('/knowledge-banks/') && filePath.endsWith('.json')) {
          knowledgeBanks++;
        }
      } catch {
        // Skip unparseable files
      }
    }

    const total = agents.length + agentTools.length + chatUIs.length + agentReviews.length + knowledgeBanks;
    return { agents, agentTools, chatUIs, agentReviews, knowledgeBanks, total };
  }

  parse(): ProjectsResult {
    const projects: Project[] = [];
    const sortedProjectFiles = [...this.projectFiles].sort();

    for (const projectFilePath of sortedProjectFiles) {
      try {
        const content = this.extractedFiles[projectFilePath];
        if (!content) {
          this.log(`Project file not found or empty: ${projectFilePath}`);
          continue;
        }

        const projectData: ProjectData = JSON.parse(content);
        const pathParts = projectFilePath.split('/');
        const projectKey = pathParts[pathParts.indexOf('projects') + 1];

        let projectName = projectData.name || projectKey;
        projectName = projectName.replace(/_/g, ' ');

        let versionNumber = 0;
        if (
          projectData.versionTag &&
          typeof projectData.versionTag.versionNumber === 'number'
        ) {
          versionNumber = projectData.versionTag.versionNumber;
        }

        const permissions: Permission[] = [];
        if (projectData.permissions && Array.isArray(projectData.permissions)) {
          for (const perm of projectData.permissions) {
            const permissionEntry: Permission = {
              type: perm.group ? 'Group' : 'User',
              name: perm.group || perm.user || 'Unknown',
              permissions: {},
            };

            for (const [key, value] of Object.entries(perm)) {
              if (key !== 'group' && key !== 'user') {
                permissionEntry.permissions[key] = value as boolean;
              }
            }

            permissions.push(permissionEntry);
          }
        }

        const agenticFeatures = this.buildAgenticFeatures(projectKey);

        const project: Project = {
          key: projectKey,
          name: projectName,
          owner: projectData.owner || 'Unknown',
          permissions: permissions,
          versionNumber: versionNumber,
          agenticFeatures: agenticFeatures.total > 0 ? agenticFeatures : undefined,
        };

        projects.push(project);
      } catch (error) {
        this.log(
          `Error parsing project ${projectFilePath}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    return { projects };
  }
}
