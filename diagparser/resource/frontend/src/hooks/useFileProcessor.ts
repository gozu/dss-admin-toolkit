import { useState, useCallback } from 'react';
import {
  configure,
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  type Entry,
} from '@zip.js/zip.js';
import pako from 'pako';
import { timer } from '../utils/timing';
import type { ExtractedFiles, DiagType } from '../types';

// Configure zip.js for maximum performance - ENABLE WEB WORKERS
configure({
  useWebWorkers: true,
  maxWorkers: 6,
  chunkSize: 512 * 1024,
});

const CONCURRENCY = 50; // High concurrency for parallel extraction
const DEFAULT_DSSHOME = 'data/dataiku/dss_data/';

// Helper to safely get data from an entry
async function getEntryText(entry: Entry): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (entry as any).getData(new TextWriter());
}

async function getEntryBlob(entry: Entry, mimeType?: string): Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (entry as any).getData(new BlobWriter(mimeType));
}

// Escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CategorizedEntries {
  clusters: Entry[];
  projects: Entry[];
  plugins: Entry[];
  codeEnvs: Entry[];
  rootFiles: Entry[];
  outputLog: Entry | null;
  outputLogGz: Entry | null;
  savedModels: Entry[];
  webApps: Entry[];
  agentTools: Entry[];
  agentReviews: Entry[];
  knowledgeBanks: Entry[];
  recipes: Entry[];
  codeStudios: Entry[];
  datasets: Entry[];
  retrievalLlms: Entry[];
}

interface FileProcessorResult {
  extractedFiles: ExtractedFiles;
  diagType: DiagType;
  dsshome: string;
  rootFiles: string[];
  projectFiles: string[];
  originalFile: File;  // Pass original file for deferred extraction of large files
}

interface UseFileProcessorReturn {
  processFile: (file: File) => Promise<FileProcessorResult>;
  isProcessing: boolean;
  progress: string;
  error: string | null;
}

// Single-pass entry categorization
function categorizeEntries(
  entries: Entry[],
  configRoot: string
): CategorizedEntries {
  const escapedRoot = escapeRegex(configRoot);

  const patterns = {
    clusterJson: new RegExp(`^${escapedRoot}config/clusters/[^/]+\\.json$`),
    clusterConfig: new RegExp(`^${escapedRoot}clusters/([^/]+)/exec/\\1_config.*\\.yaml$`),
    kubeConfig: new RegExp(`^${escapedRoot}clusters/([^/]+)/exec/kube_config$`),
    startLog: new RegExp(`^${escapedRoot}clusters/([^/]+)/log/start\\.log$`),
    stopLog: new RegExp(`^${escapedRoot}clusters/([^/]+)/log/stop\\.log$`),
    project: new RegExp(`^${escapedRoot}config/projects/[^/]+/params\\.json$`),
    plugin: new RegExp(`^${escapedRoot}config/plugins/[^/]+/(settings|plugin)\\.json$`),
    codeEnv: new RegExp(`^${escapedRoot}code-envs/desc/[^/]+/[^/]+/desc\\.json$`),
    savedModel: new RegExp(`^${escapedRoot}config/projects/[^/]+/saved_models/[^/]+\\.json$`),
    webApp: new RegExp(`^${escapedRoot}config/projects/[^/]+/web_apps/[^/]+\\.json$`),
    agentTool: new RegExp(`^${escapedRoot}config/projects/[^/]+/agent-tools/[^/]+\\.json$`),
    agentReview: new RegExp(`^${escapedRoot}config/projects/[^/]+/agent_reviews/[^/]+\\.json$`),
    knowledgeBank: new RegExp(`^${escapedRoot}config/projects/[^/]+/knowledge-banks/[^/]+\\.json$`),
    recipe: new RegExp(`^${escapedRoot}config/projects/[^/]+/recipes/[^/]+\\.json$`),
    codeStudio: new RegExp(`^${escapedRoot}config/projects/[^/]+/code-studios/[^/]+\\.json$`),
    dataset: new RegExp(`^${escapedRoot}config/projects/[^/]+/datasets/[^/]+\\.json$`),
    retrievalLlm: new RegExp(`^${escapedRoot}config/projects/[^/]+/retrieval-augmented-llms/[^/]+\\.json$`),
  };

  const result: CategorizedEntries = {
    clusters: [],
    projects: [],
    plugins: [],
    codeEnvs: [],
    rootFiles: [],
    outputLog: null,
    outputLogGz: null,
    savedModels: [],
    webApps: [],
    agentTools: [],
    agentReviews: [],
    knowledgeBanks: [],
    recipes: [],
    codeStudios: [],
    datasets: [],
    retrievalLlms: [],
  };

  for (const entry of entries) {
    if (entry.directory) continue;

    const filename = entry.filename;

    // Check categories (ordered by likelihood)
    if (patterns.project.test(filename)) {
      result.projects.push(entry);
    } else if (patterns.plugin.test(filename)) {
      result.plugins.push(entry);
    } else if (patterns.codeEnv.test(filename)) {
      result.codeEnvs.push(entry);
    } else if (patterns.savedModel.test(filename)) {
      result.savedModels.push(entry);
    } else if (patterns.webApp.test(filename)) {
      result.webApps.push(entry);
    } else if (patterns.agentTool.test(filename)) {
      result.agentTools.push(entry);
    } else if (patterns.agentReview.test(filename)) {
      result.agentReviews.push(entry);
    } else if (patterns.knowledgeBank.test(filename)) {
      result.knowledgeBanks.push(entry);
    } else if (patterns.recipe.test(filename)) {
      result.recipes.push(entry);
    } else if (patterns.codeStudio.test(filename)) {
      result.codeStudios.push(entry);
    } else if (patterns.dataset.test(filename)) {
      result.datasets.push(entry);
    } else if (patterns.retrievalLlm.test(filename)) {
      result.retrievalLlms.push(entry);
    } else if (
      patterns.clusterJson.test(filename) ||
      patterns.clusterConfig.test(filename) ||
      patterns.kubeConfig.test(filename) ||
      patterns.startLog.test(filename) ||
      patterns.stopLog.test(filename)
    ) {
      result.clusters.push(entry);
    } else if (!filename.includes('/')) {
      // Root file
      if (filename === 'output.log' || filename.endsWith('/output.log')) {
        result.outputLog = entry;
      } else if (filename === 'output.log.gz' || filename.endsWith('/output.log.gz')) {
        result.outputLogGz = entry;
      } else if (entry.uncompressedSize < 10 * 1024 * 1024) {
        result.rootFiles.push(entry);
      }
    }
  }

  return result;
}

// Parallel batch extraction
async function extractBatch(
  entries: Entry[],
  extractedFiles: ExtractedFiles,
  concurrency = CONCURRENCY
): Promise<string[]> {
  const extracted: string[] = [];

  // Process all at once if small enough, otherwise batch
  if (entries.length <= concurrency) {
    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          const content = await getEntryText(entry);
          return { filename: entry.filename, content };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result) {
        extractedFiles[result.filename] = result.content;
        extracted.push(result.filename);
      }
    }
  } else {
    // Batch processing for large sets
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            const content = await getEntryText(entry);
            return { filename: entry.filename, content };
          } catch {
            return null;
          }
        })
      );

      for (const result of results) {
        if (result) {
          extractedFiles[result.filename] = result.content;
          extracted.push(result.filename);
        }
      }
    }
  }

  return extracted;
}

export function useFileProcessor(): UseFileProcessorReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File): Promise<FileProcessorResult> => {
    setIsProcessing(true);
    setError(null);
    setProgress('Initializing...');

    const extractedFiles: ExtractedFiles = {};
    let diagType: DiagType = 'unknown';
    let dsshome = DEFAULT_DSSHOME;
    const rootFiles: string[] = [];
    const projectFiles: string[] = [];

    try {
      timer.start();

      // 1. Get entries
      timer.mark('getEntries');
      setProgress('Reading ZIP structure...');
      const reader = new BlobReader(file);
      const zipReader = new ZipReader(reader);
      const entries = await zipReader.getEntries();
      timer.measure('extract:getEntries', 'getEntries');

      // 2. Detect diag type
      timer.mark('detectType');
      const diagTxtEntry = entries.find(
        (e) => e.filename === 'diag.txt' || e.filename.endsWith('/diag.txt')
      );
      const localconfigZipEntry = entries.find(
        (e) => e.filename === 'localconfig.zip' || e.filename.endsWith('/localconfig.zip')
      );
      const localconfigFolderEntry = entries.find((e) => {
        const parts = e.filename.split('/');
        return parts.includes('localconfig');
      });

      if (diagTxtEntry) {
        diagType = 'instance';
        const diagContent = await getEntryText(diagTxtEntry);
        extractedFiles[diagTxtEntry.filename] = diagContent;

        // Extract DSSHOME
        const lines = diagContent.split('\n');
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('DIP_HOME=')) {
            dsshome = trimmedLine.substring('DIP_HOME='.length).replace(/^\//, '');
            if (!dsshome.endsWith('/')) dsshome += '/';
            break;
          }
        }
      } else if (localconfigZipEntry || localconfigFolderEntry) {
        diagType = 'job';
        dsshome = '';
      }
      timer.measure('extract:detectType', 'detectType');

      // 3. Process localconfig.zip if present
      if (localconfigZipEntry) {
        timer.mark('localconfig');
        try {
          const blob = await getEntryBlob(localconfigZipEntry, 'application/zip');
          const innerZipReader = new ZipReader(new BlobReader(blob));
          const innerEntries = await innerZipReader.getEntries();
          await extractBatch(innerEntries.filter(e => !e.directory), extractedFiles);
          await innerZipReader.close();
        } catch {
          // Ignore localconfig errors
        }
        timer.measure('extract:localconfig', 'localconfig');
      }

      // 4. Single-pass categorization
      timer.mark('categorize');
      setProgress('Categorizing files...');
      const configRoot = diagType === 'job' ? '' : dsshome;
      const categorized = categorizeEntries(entries, configRoot);
      timer.measure('extract:categorize', 'categorize');

      // 5. Find main files (need specific lookups)
      timer.mark('mainFiles');
      setProgress('Extracting configuration files...');
      const filesToExtract = [
        'install.ini',
        'config/connections.json',
        'config/general-settings.json',
        'config/license.json',
        'config/users.json',
        'dss-version.json',
        'run/backend.log',
        'run/fmmain.log',
        'run/supervisord.log',
        'run/ipython.log',
        'bin/env-default.sh',
        'bin/env-site.sh',
        'config/dip.properties',
      ];

      // Note: datadir_listing.txt extraction is deferred to DirTreeSection
      // to avoid blocking the main UI. It will extract from originalFile when needed.

      // Find all main file entries first
      const mainFileEntries: Entry[] = [];
      for (const pathSuffix of filesToExtract) {
        const targetPath = configRoot + pathSuffix;
        const targetPathNormalized = targetPath.replace(/\\/g, '/').replace(/^\.\//, '');

        let targetEntry = entries.find((entry) => entry.filename === targetPathNormalized);

        if (!targetEntry) {
          const targetParts = targetPathNormalized.split('/');
          const targetFile = targetParts[targetParts.length - 1];
          const contextPattern = targetParts[targetParts.length - 2] + '/' + targetFile;
          targetEntry = entries.find((entry) => entry.filename.endsWith(contextPattern));
        }

        if (!targetEntry) {
          const targetParts = targetPathNormalized.split('/');
          const targetFile = targetParts[targetParts.length - 1];
          targetEntry = entries.find((entry) => {
            const entryPath = entry.filename.replace(/\\/g, '/');
            return (
              entryPath.endsWith('/' + targetFile) &&
              !entry.directory &&
              !entryPath.includes('/datasets/') &&
              !entryPath.includes('/projects/')
            );
          });
        }

        if (targetEntry) {
          mainFileEntries.push(targetEntry);
        }
      }

      // Extract main files in parallel
      await extractBatch(mainFileEntries, extractedFiles);
      timer.measure('extract:mainFiles', 'mainFiles');

      // 6. Parallel extraction of ALL categories simultaneously
      timer.mark('parallel');
      setProgress('Extracting data files...');

      const [, projectsExtracted, , , rootFilesExtracted] = await Promise.all([
        extractBatch(categorized.clusters, extractedFiles),
        extractBatch(categorized.projects, extractedFiles),
        extractBatch(categorized.plugins, extractedFiles),
        extractBatch(categorized.codeEnvs, extractedFiles),
        extractBatch(categorized.rootFiles, extractedFiles),
        extractBatch(categorized.savedModels, extractedFiles),
        extractBatch(categorized.webApps, extractedFiles),
        extractBatch(categorized.agentTools, extractedFiles),
        extractBatch(categorized.agentReviews, extractedFiles),
        extractBatch(categorized.knowledgeBanks, extractedFiles),
        extractBatch(categorized.recipes, extractedFiles),
        extractBatch(categorized.codeStudios, extractedFiles),
        extractBatch(categorized.datasets, extractedFiles),
        extractBatch(categorized.retrievalLlms, extractedFiles),
      ]);

      projectFiles.push(...projectsExtracted);
      rootFiles.push(...rootFilesExtracted);
      timer.measure('extract:parallel', 'parallel');

      // 7. Handle output.log (may need decompression)
      timer.mark('outputLog');
      const outputLogEntry = categorized.outputLogGz || categorized.outputLog;
      if (outputLogEntry) {
        try {
          const isGzipped = !!categorized.outputLogGz;
          let content: string;
          if (isGzipped) {
            const blob = await getEntryBlob(outputLogEntry);
            const gzipData = await new BlobReader(blob).readUint8Array(0, blob.size);
            content = new TextDecoder().decode(pako.ungzip(gzipData));
          } else {
            content = await getEntryText(outputLogEntry);
          }
          extractedFiles['output.log'] = content;
        } catch {
          // Ignore output.log errors
        }
      }
      timer.measure('extract:outputLog', 'outputLog');

      await zipReader.close();
      timer.measure('extract:total');

      setProgress('Extraction complete');

      return {
        extractedFiles,
        diagType,
        dsshome,
        rootFiles,
        projectFiles,
        originalFile: file,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return { processFile, isProcessing, progress, error };
}
