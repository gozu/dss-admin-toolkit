import { useEffect, useMemo } from 'react';
import { useDiag } from '../context/DiagContext';
import { ProjectFootprintParser } from '../parsers';
import type { ProjectFootprintRow, ProjectRow } from '../types';

interface UseProjectRowsReturn {
  rows: ProjectRow[];
  footprintReady: boolean;
  avgProjectGB: number;
}

export function useProjectRows(): UseProjectRowsReturn {
  const { state, setParsedData } = useDiag();
  const { parsedData, extractedFiles } = state;
  const projects = useMemo(() => parsedData.projects || [], [parsedData.projects]);

  // Compute footprint once the dir tree is available. Until then `computed` is null.
  const computed = useMemo(() => {
    if (!parsedData.dirTree?.root) return null;
    if (!projects || projects.length === 0) return null;
    const parser = new ProjectFootprintParser(
      extractedFiles,
      parsedData.dirTree,
      projects,
      () => {},
    );
    return parser.parse();
  }, [parsedData.dirTree, projects, extractedFiles]);

  // Persist parser output to global state so the report pipeline sees it.
  useEffect(() => {
    if (!computed) return;
    setParsedData({
      projectFootprint: computed.projectFootprint,
      projectFootprintSummary: computed.projectFootprintSummary,
    });
  }, [computed, setParsedData]);

  const rows = useMemo<ProjectRow[]>(() => {
    const fpByKey = new Map<string, ProjectFootprintRow>();
    if (computed) {
      for (const row of computed.projectFootprint) {
        fpByKey.set(row.projectKey, row);
      }
    }
    return projects.map((p) => {
      const fp = fpByKey.get(p.key);
      const base: ProjectRow = {
        key: p.key,
        name: p.name,
        owner: p.owner,
        permissions: p.permissions,
        versionNumber: p.versionNumber,
        agenticFeatures: p.agenticFeatures,
      };
      if (fp) {
        base.footprint = {
          codeEnvCount: fp.codeEnvCount,
          codeStudioCount: fp.codeStudioCount,
          codeEnvBytes: fp.codeEnvBytes,
          managedDatasetsBytes: fp.managedDatasetsBytes,
          managedFoldersBytes: fp.managedFoldersBytes,
          bundleBytes: fp.bundleBytes,
          bundleCount: fp.bundleCount,
          totalBytes: fp.totalBytes,
          totalGB: fp.totalGB,
          instanceAvgProjectGB: fp.instanceAvgProjectGB,
          projectSizeIndex: fp.projectSizeIndex,
          projectSizeHealth: fp.projectSizeHealth,
          codeEnvHealth: fp.codeEnvHealth,
          codeEnvRisk: fp.codeEnvRisk,
          projectRisk: fp.projectRisk,
        };
      }
      return base;
    });
  }, [projects, computed]);

  return {
    rows,
    footprintReady: computed !== null,
    avgProjectGB: computed?.projectFootprintSummary?.instanceAvgProjectGB ?? 0,
  };
}
