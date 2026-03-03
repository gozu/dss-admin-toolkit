import { useMemo } from 'react';
import type { ParsedData } from '../types';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface DetectedIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  category: string;
  scrollTarget?: string;
}

/**
 * Parse memory string like "4g", "2048m", "512m" to MB
 */
function parseMemoryToMB(value: string | undefined): number {
  if (!value) return 0;
  const match = value.toLowerCase().match(/^(\d+)([gmk]?)$/);
  if (!match) return 0;

  const num = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'g':
      return num * 1024;
    case 'k':
      return num / 1024;
    case 'm':
    default:
      return num;
  }
}

/**
 * Parse filesystem percentage like "85%" to number
 */
function parsePercentage(value: string | undefined): number {
  if (!value) return 0;
  return parseInt(value.replace('%', ''), 10) || 0;
}

/**
 * Hook to detect issues in parsed diagnostic data
 */
export function useIssueDetection(parsedData: ParsedData) {
  return useMemo(() => {
    const issues: DetectedIssue[] = [];

    // ============================================
    // FILESYSTEM ISSUES
    // ============================================
    if (parsedData.filesystemInfo) {
      for (const fs of parsedData.filesystemInfo) {
        const usage = parsePercentage(fs['Use%']);
        const mountPoint = fs['Mounted on'] || fs['Filesystem'];

        // Skip invalid entries (bad parsing can cause >100% values)
        if (usage > 100 || usage <= 0) continue;

        if (usage >= 80) {
          issues.push({
            id: `fs-critical-${mountPoint}`,
            severity: 'critical',
            title: `Filesystem ${usage}% full`,
            description: `${mountPoint} is at ${usage}% capacity`,
            category: 'filesystem',
            scrollTarget: 'filesystem-table',
          });
        } else if (usage >= 70) {
          issues.push({
            id: `fs-warning-${mountPoint}`,
            severity: 'warning',
            title: `Filesystem ${usage}% used`,
            description: `${mountPoint} is at ${usage}% capacity`,
            category: 'filesystem',
            scrollTarget: 'filesystem-table',
          });
        }
      }
    }

    // ============================================
    // OPEN FILES LIMIT
    // ============================================
    if (parsedData.systemLimits) {
      const maxOpenFiles = parsedData.systemLimits['Max open files'];
      if (maxOpenFiles) {
        const limit = parseInt(String(maxOpenFiles), 10);
        if (limit < 65535) {
          issues.push({
            id: 'open-files-low',
            severity: 'critical',
            title: 'Open files limit too low',
            description: `Max open files is ${limit}, should be >= 65535`,
            category: 'system',
            scrollTarget: 'systemLimits-table',
          });
        }
      }
    }

    // ============================================
    // JAVA MEMORY SETTINGS
    // ============================================
    if (parsedData.javaMemorySettings) {
      const settings = parsedData.javaMemorySettings;

      // Backend heap check (should be >= 2GB)
      const backendMB = parseMemoryToMB(settings['BACKEND']);
      if (backendMB > 0 && backendMB < 2048) {
        issues.push({
          id: 'backend-heap-low',
          severity: 'warning',
          title: 'Backend heap < 2GB',
          description: `Backend heap is ${settings['BACKEND']}, recommended >= 2GB`,
          category: 'memory',
          scrollTarget: 'javaMemoryLimits-table',
        });
      }

      // JEK heap check (should be >= 2GB)
      const jekMB = parseMemoryToMB(settings['JEK']);
      if (jekMB > 0 && jekMB < 2048) {
        issues.push({
          id: 'jek-heap-low',
          severity: 'warning',
          title: 'JEK heap < 2GB',
          description: `JEK heap is ${settings['JEK']}, recommended >= 2GB`,
          category: 'memory',
          scrollTarget: 'javaMemoryLimits-table',
        });
      }

      // FEK heap check (should be >= 2GB)
      const fekMB = parseMemoryToMB(settings['FEK']);
      if (fekMB > 0 && fekMB < 2048) {
        issues.push({
          id: 'fek-heap-low',
          severity: 'warning',
          title: 'FEK heap < 2GB',
          description: `FEK heap is ${settings['FEK']}, recommended >= 2GB`,
          category: 'memory',
          scrollTarget: 'javaMemoryLimits-table',
        });
      }
    }

    // ============================================
    // CGROUPS ISSUES
    // ============================================
    if (parsedData.cgroupSettings) {
      const emptyTargets = parsedData.cgroupSettings['Empty Target Types'];
      if (emptyTargets && String(emptyTargets).trim() !== '') {
        issues.push({
          id: 'cgroups-empty-targets',
          severity: 'critical',
          title: 'CGroups empty target types',
          description: `Empty target types detected: ${emptyTargets}`,
          category: 'cgroups',
          scrollTarget: 'cgroupSettings-table',
        });
      }
    }

    // ============================================
    // PYTHON VERSION
    // ============================================
    if (parsedData.pythonVersion) {
      const versionMatch = parsedData.pythonVersion.match(/(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1], 10);
        const minor = parseInt(versionMatch[2], 10);

        if (major < 3 || (major === 3 && minor < 8)) {
          issues.push({
            id: 'python-eol',
            severity: 'critical',
            title: 'Python version EOL',
            description: `Python ${parsedData.pythonVersion} is end-of-life`,
            category: 'python',
            scrollTarget: 'code-envs-table',
          });
        } else if (major === 3 && minor < 10) {
          issues.push({
            id: 'python-old',
            severity: 'warning',
            title: 'Python version outdated',
            description: `Python ${parsedData.pythonVersion} is deprecated, consider upgrading`,
            category: 'python',
            scrollTarget: 'code-envs-table',
          });
        }
      }
    }

    // ============================================
    // SPARK VERSION
    // ============================================
    if (parsedData.sparkSettings) {
      const sparkVersion = parsedData.sparkSettings['Spark Version'];
      if (sparkVersion && typeof sparkVersion === 'string') {
        const versionMatch = sparkVersion.match(/^(\d+)/);
        if (versionMatch) {
          const majorVersion = parseInt(versionMatch[1], 10);
          if (majorVersion < 3) {
            issues.push({
              id: 'spark-old',
              severity: 'warning',
              title: `Spark ${sparkVersion} outdated`,
              description: `Spark version ${sparkVersion} is < 3.0, consider upgrading`,
              category: 'spark',
              scrollTarget: 'sparkSettings-table',
            });
          }
        }
      }
    }

    // ============================================
    // PROJECT COUNT
    // ============================================
    if (parsedData.projects && parsedData.projects.length > 500) {
      issues.push({
        id: 'large-project-count',
        severity: 'warning',
        title: 'Large project count',
        description: `${parsedData.projects.length} projects may impact performance`,
        category: 'data',
        scrollTarget: 'projects-table',
      });
    }

    // ============================================
    // AI FEATURES NOT ENABLED
    // ============================================
    if (parsedData.disabledFeatures) {
      const aiFeatures = Object.keys(parsedData.disabledFeatures).filter(
        key => key.startsWith('AI:') || key === 'AI Assistants' || key === 'Code Assistant' || key === 'Ask Dataiku'
      );

      if (aiFeatures.length > 0) {
        issues.push({
          id: 'ai-features-disabled',
          severity: 'info',
          title: `${aiFeatures.length} AI feature${aiFeatures.length > 1 ? 's' : ''} disabled`,
          description: aiFeatures.join(', '),
          category: 'ai',
          scrollTarget: 'disabledFeatures-table',
        });
      }
    }

    // ============================================
    // DISABLED FEATURES COUNT (non-AI)
    // ============================================
    if (parsedData.disabledFeatures) {
      const nonAiDisabled = Object.keys(parsedData.disabledFeatures).filter(
        key => !key.startsWith('AI:') && key !== 'AI Assistants' && key !== 'Code Assistant' && key !== 'Ask Dataiku'
      );

      if (nonAiDisabled.length > 0) {
        issues.push({
          id: 'disabled-features',
          severity: nonAiDisabled.length > 5 ? 'warning' : 'info',
          title: `${nonAiDisabled.length} feature${nonAiDisabled.length > 1 ? 's' : ''} disabled`,
          description: nonAiDisabled.slice(0, 3).join(', ') + (nonAiDisabled.length > 3 ? '...' : ''),
          category: 'features',
          scrollTarget: 'disabledFeatures-table',
        });
      }
    }

    // ============================================
    // MEMORY INFO
    // ============================================
    if (parsedData.memoryInfo) {
      const swapTotal = parsedData.memoryInfo['SwapTotal'];
      if (swapTotal && (swapTotal === '0' || swapTotal === '0 kB' || swapTotal === '0 B')) {
        issues.push({
          id: 'no-swap',
          severity: 'warning',
          title: 'No swap memory',
          description: 'System has no swap configured',
          category: 'memory',
          scrollTarget: 'memory-chart',
        });
      }
    }

    // Sort by severity: critical first, then warning, then info
    const severityOrder: Record<IssueSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      issues,
      criticalCount: issues.filter(i => i.severity === 'critical').length,
      warningCount: issues.filter(i => i.severity === 'warning').length,
      infoCount: issues.filter(i => i.severity === 'info').length,
      totalCount: issues.length,
    };
  }, [parsedData]);
}
