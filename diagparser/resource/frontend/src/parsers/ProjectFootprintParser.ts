import type {
  DirEntry,
  DirTreeData,
  ExtractedFiles,
  Project,
  ProjectFootprintHealth,
  ProjectFootprintRow,
  ProjectFootprintSummary,
} from '../types';

interface ProjectFootprintResult {
  projectFootprint: ProjectFootprintRow[];
  projectFootprintSummary: ProjectFootprintSummary;
}

interface ProjectStorage {
  managedDatasetsBytes: number;
  managedFoldersBytes: number;
  bundleBytes: number;
  bundleCount: number;
  savedModelsBytes: number;
  analysisDataBytes: number;
}

function emptyStorage(): ProjectStorage {
  return {
    managedDatasetsBytes: 0,
    managedFoldersBytes: 0,
    bundleBytes: 0,
    bundleCount: 0,
    savedModelsBytes: 0,
    analysisDataBytes: 0,
  };
}

function projectSizeIndex(totalGb: number, avgGb: number): number {
  const safeTotal = Math.max(0, totalGb);
  if (safeTotal >= 40.0) return 1.0;
  const absNorm = Math.log1p(Math.min(safeTotal, 40.0)) / Math.log1p(40.0);
  const ratio = safeTotal / Math.max(avgGb, 0.1);
  const relNorm = Math.log1p(Math.min(Math.max(ratio, 0.0), 4.0)) / Math.log1p(4.0);
  return Math.max(0.0, Math.min(1.0, 0.6 * absNorm + 0.4 * relNorm));
}

function projectSizeHealth(totalGb: number, sizeIndex: number): ProjectFootprintHealth {
  if (totalGb >= 40.0) return 'angry-red';
  if (sizeIndex >= 0.85) return 'angry-red';
  if (sizeIndex >= 0.60) return 'red';
  if (sizeIndex >= 0.35) return 'orange';
  return 'green';
}

function codeEnvHealth(count: number): ProjectFootprintHealth {
  if (count >= 5) return 'angry-red';
  if (count === 4) return 'red';
  if (count === 3) return 'orange';
  if (count === 2) return 'yellow';
  return 'green';
}

function codeEnvRisk(count: number): number {
  if (count <= 1) return 0;
  if (count === 2) return 0.45;
  if (count === 3) return 0.75;
  return 1.0;
}

export class ProjectFootprintParser {
  private extractedFiles: ExtractedFiles;
  private dirTree: DirTreeData | undefined;
  private projects: Project[];
  private log: (message: string) => void;

  constructor(
    extractedFiles: ExtractedFiles,
    dirTree: DirTreeData | undefined,
    projects: Project[],
    log: (message: string) => void,
  ) {
    this.extractedFiles = extractedFiles;
    this.dirTree = dirTree;
    this.projects = projects;
    this.log = log;
  }

  parse(): ProjectFootprintResult {
    if (!this.projects || this.projects.length === 0) {
      return {
        projectFootprint: [],
        projectFootprintSummary: {
          projectCount: 0,
          instanceAvgProjectGB: 0,
          instanceProjectRiskAvg: 0,
        },
      };
    }

    // 1. Build per-project storage from dir tree
    const storageByProject = this.aggregateStorage();

    // 2. Code envs per project
    const envsByProject = this.aggregateCodeEnvs();

    // 3. Code studios per project
    const codeStudiosByProject = this.countCodeStudios();

    // 4. Build raw rows
    const rawRows: Array<{
      row: Omit<ProjectFootprintRow, 'instanceAvgProjectGB' | 'projectSizeIndex' | 'projectSizeHealth' | 'codeEnvRisk' | 'projectRisk'>;
      totalGb: number;
    }> = [];

    for (const project of this.projects) {
      const storage = storageByProject.get(project.key) || emptyStorage();
      const bucketSum =
        storage.managedDatasetsBytes +
        storage.managedFoldersBytes +
        storage.bundleBytes +
        storage.savedModelsBytes +
        storage.analysisDataBytes;

      // Mirror admin-toolkit: if total falls short of bucket sum, fall back to the sum
      let totalBytes = bucketSum;
      if (totalBytes <= 0) {
        totalBytes =
          storage.managedDatasetsBytes +
          storage.managedFoldersBytes +
          storage.bundleBytes;
      }

      const totalGb = totalBytes / (1024 ** 3);
      const envCount = envsByProject.get(project.key)?.size || 0;
      const codeStudioCount = codeStudiosByProject.get(project.key) || 0;

      rawRows.push({
        row: {
          projectKey: project.key,
          name: project.name,
          owner: project.owner || 'Unknown',
          codeEnvCount: envCount,
          codeStudioCount,
          codeEnvBytes: 0,
          managedDatasetsBytes: storage.managedDatasetsBytes,
          managedFoldersBytes: storage.managedFoldersBytes,
          bundleBytes: storage.bundleBytes,
          bundleCount: storage.bundleCount,
          totalBytes,
          totalGB: totalGb,
          codeEnvHealth: codeEnvHealth(envCount),
        },
        totalGb,
      });
    }

    // 5. Compute averages & health scores
    const totalGbValues = rawRows.map((r) => r.totalGb);
    const avgProjectGb =
      totalGbValues.length > 0
        ? totalGbValues.reduce((a, b) => a + b, 0) / totalGbValues.length
        : 0;

    const projectRisks: number[] = [];
    const projectFootprint: ProjectFootprintRow[] = rawRows.map(({ row, totalGb }) => {
      const sizeIndex = projectSizeIndex(totalGb, avgProjectGb);
      const sizeHealth = projectSizeHealth(totalGb, sizeIndex);
      const envRisk = codeEnvRisk(row.codeEnvCount);
      const projectRisk = 0.7 * envRisk + 0.3 * sizeIndex;
      projectRisks.push(projectRisk);
      return {
        ...row,
        instanceAvgProjectGB: Number(avgProjectGb.toFixed(4)),
        projectSizeIndex: Number(sizeIndex.toFixed(4)),
        projectSizeHealth: sizeHealth,
        codeEnvRisk: Number(envRisk.toFixed(4)),
        projectRisk: Number(projectRisk.toFixed(4)),
      };
    });

    const instanceProjectRiskAvg =
      projectRisks.length > 0
        ? projectRisks.reduce((a, b) => a + b, 0) / projectRisks.length
        : 0;

    this.log(
      `ProjectFootprint: ${projectFootprint.length} projects, avg ${avgProjectGb.toFixed(2)} GB`,
    );

    return {
      projectFootprint,
      projectFootprintSummary: {
        projectCount: projectFootprint.length,
        instanceAvgProjectGB: Number(avgProjectGb.toFixed(4)),
        instanceProjectRiskAvg: Number(instanceProjectRiskAvg.toFixed(4)),
      },
    };
  }

  private aggregateStorage(): Map<string, ProjectStorage> {
    const result = new Map<string, ProjectStorage>();
    if (!this.dirTree || !this.dirTree.root) return result;

    // Prime the map so unknown project keys still get an empty storage if found.
    for (const p of this.projects) {
      result.set(p.key, emptyStorage());
    }

    const projectKeySet = new Set(this.projects.map((p) => p.key));

    // Walk the tree. For each bucket kind, find the bucket root dir and
    // aggregate sizes for each project key under it.
    const bucketHandlers: Array<{
      match: (name: string) => boolean;
      handle: (bucket: DirEntry, parent: DirEntry | null) => void;
    }> = [
      {
        match: (n) => n === 'managed_datasets',
        handle: (bucket) => {
          for (const child of bucket.children) {
            if (!child.isDirectory) continue;
            // `managed_datasets/<KEY>.*`
            const dotIdx = child.name.indexOf('.');
            const key = dotIdx > 0 ? child.name.substring(0, dotIdx) : child.name;
            const storage = this.ensureStorage(result, key);
            storage.managedDatasetsBytes += child.size;
          }
        },
      },
      {
        match: (n) => n === 'managed_folders',
        handle: (bucket) => {
          for (const child of bucket.children) {
            if (!child.isDirectory) continue;
            const storage = this.ensureStorage(result, child.name);
            storage.managedFoldersBytes += child.size;
          }
        },
      },
      {
        match: (n) => n === 'prepared_bundles' || n === 'bundles',
        handle: (bucket, parent) => {
          if (parent && projectKeySet.has(parent.name)) {
            // Per-project layout: .../config/projects/<KEY>/bundles/<BUNDLE_ID>/…
            const storage = this.ensureStorage(result, parent.name);
            storage.bundleBytes += bucket.size;
            storage.bundleCount += bucket.children.filter((c) => c.isDirectory).length;
          } else {
            // Top-level layout: $DATADIR/bundles/<KEY>/<BUNDLE_ID>/…
            for (const child of bucket.children) {
              if (!child.isDirectory) continue;
              const storage = this.ensureStorage(result, child.name);
              storage.bundleBytes += child.size;
              storage.bundleCount += child.children.filter((g) => g.isDirectory).length;
            }
          }
        },
      },
      {
        match: (n) => n === 'saved_models',
        handle: (bucket, parent) => {
          if (parent && projectKeySet.has(parent.name)) {
            const storage = this.ensureStorage(result, parent.name);
            storage.savedModelsBytes += bucket.size;
          } else {
            for (const child of bucket.children) {
              if (!child.isDirectory) continue;
              const storage = this.ensureStorage(result, child.name);
              storage.savedModelsBytes += child.size;
            }
          }
        },
      },
      {
        match: (n) => n === 'analysis-data',
        handle: (bucket) => {
          for (const child of bucket.children) {
            if (!child.isDirectory) continue;
            const storage = this.ensureStorage(result, child.name);
            storage.analysisDataBytes += child.size;
          }
        },
      },
    ];

    const visit = (node: DirEntry, parent: DirEntry | null) => {
      if (!node.isDirectory) return;
      for (const handler of bucketHandlers) {
        if (handler.match(node.name)) {
          handler.handle(node, parent);
          // A dir typically only matches one bucket; don't recurse inside it
          return;
        }
      }
      for (const child of node.children) {
        visit(child, node);
      }
    };

    visit(this.dirTree.root, null);
    return result;
  }

  private ensureStorage(map: Map<string, ProjectStorage>, key: string): ProjectStorage {
    let s = map.get(key);
    if (!s) {
      s = emptyStorage();
      map.set(key, s);
    }
    return s;
  }

  private aggregateCodeEnvs(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const p of this.projects) result.set(p.key, new Set());

    for (const [filePath, content] of Object.entries(this.extractedFiles)) {
      const projectKey = this.projectKeyFromPath(filePath);
      if (!projectKey) continue;

      // project default envs from params.json
      if (filePath.endsWith(`/projects/${projectKey}/params.json`)) {
        try {
          const data = JSON.parse(content);
          const codeEnvs = data?.settings?.codeEnvs;
          if (codeEnvs) {
            const set = this.ensureSet(result, projectKey);
            for (const lang of ['python', 'r'] as const) {
              const cfg = codeEnvs[lang];
              if (cfg && cfg.mode && cfg.mode !== 'USE_BUILTIN_ENV' && cfg.envName) {
                set.add(cfg.envName);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      // recipe envSelection
      if (filePath.includes(`/projects/${projectKey}/recipes/`) && filePath.endsWith('.json')) {
        try {
          const data = JSON.parse(content);
          const envSel = data?.params?.envSelection;
          if (envSel && envSel.envMode !== 'INHERIT' && envSel.envName) {
            const set = this.ensureSet(result, projectKey);
            set.add(envSel.envName);
          }
        } catch {
          // ignore
        }
      }
    }

    return result;
  }

  private ensureSet(map: Map<string, Set<string>>, key: string): Set<string> {
    let s = map.get(key);
    if (!s) {
      s = new Set();
      map.set(key, s);
    }
    return s;
  }

  private countCodeStudios(): Map<string, number> {
    const result = new Map<string, number>();
    for (const p of this.projects) result.set(p.key, 0);

    for (const filePath of Object.keys(this.extractedFiles)) {
      const projectKey = this.projectKeyFromPath(filePath);
      if (!projectKey) continue;
      if (filePath.includes(`/projects/${projectKey}/code-studios/`) && filePath.endsWith('.json')) {
        result.set(projectKey, (result.get(projectKey) || 0) + 1);
      }
    }
    return result;
  }

  private projectKeyFromPath(filePath: string): string | null {
    const idx = filePath.indexOf('/projects/');
    if (idx < 0) return null;
    const rest = filePath.substring(idx + '/projects/'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    return rest.substring(0, slash);
  }
}
