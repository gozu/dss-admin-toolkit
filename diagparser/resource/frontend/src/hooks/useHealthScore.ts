import { useMemo } from 'react';
import type {
  ParsedData,
  HealthScore,
  HealthCategoryScore,
  HealthIssue,
  HealthCategory,
  HealthSeverity,
} from '../types';

/**
 * Category weights for overall score calculation
 * Excludes license and log errors - focuses on system health only
 */
const CATEGORY_WEIGHTS: Record<HealthCategory, number> = {
  version: 0.20,   // 20% - Python, Spark versions
  system: 0.25,    // 25% - Memory, disk, resources
  config: 0.20,    // 20% - Disabled features, Java memory settings
  memory: 0.20,    // 20% - Memory provisioning analysis
  security: 0.15,  // 15% - Impersonation, cgroups
  license: 0,      // Not used
  errors: 0,       // Not used
  project_footprint: 0,  // Not used in diag-parser
  code_envs: 0,          // Not used in diag-parser
};

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
 * Parse memory size string like "16000064 kB" to GB
 */
function parseMemorySizeToGB(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^(\d+)\s*(kB|MB|GB|B)?$/i);
  if (!match) return 0;

  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'kB').toLowerCase();

  switch (unit) {
    case 'gb':
      return num;
    case 'mb':
      return num / 1024;
    case 'kb':
      return num / (1024 * 1024);
    case 'b':
      return num / (1024 * 1024 * 1024);
    default:
      return num / (1024 * 1024); // Assume kB
  }
}

/**
 * Parse a Python version string and return major.minor as numbers
 */
function parsePythonVersion(version: string): { major: number; minor: number } | null {
  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
  };
}

/**
 * Check if a Python version is supported (>= 3.10)
 */
function isPythonVersionSupported(version: string): boolean {
  const parsed = parsePythonVersion(version);
  if (!parsed) return false;
  return parsed.major >= 3 && parsed.minor >= 10;
}

/**
 * Calculate Python version score based on percentage of code environments
 * with supported Python versions (>= 3.10)
 *
 * Scoring:
 * - 90%+ supported: 100
 * - 70-89% supported: 80
 * - 50-69% supported: 60
 * - 30-49% supported: 40
 * - <30% supported: 20
 */
function scorePythonVersion(codeEnvs: ParsedData['codeEnvs']): { score: number; issue?: HealthIssue } {
  if (!codeEnvs || codeEnvs.length === 0) {
    return { score: 75 }; // No code envs = neutral score
  }

  const pythonEnvs = codeEnvs.filter(env => env.language === 'python');
  if (pythonEnvs.length === 0) {
    return { score: 75 }; // No Python envs = neutral score
  }

  const total = pythonEnvs.length;
  const supported = pythonEnvs.filter(env => isPythonVersionSupported(env.version)).length;
  const unsupported = total - supported;
  const supportedPercent = (supported / total) * 100;

  if (supportedPercent >= 90) {
    return { score: 100 };
  }

  if (supportedPercent >= 70) {
    return {
      score: 80,
      issue: {
        id: 'python-versions-aging',
        category: 'version',
        severity: 'info',
        title: `${unsupported} of ${total} code envs on older Python`,
        description: `${supportedPercent.toFixed(0)}% of code environments use Python 3.10+. ${unsupported} environment${unsupported > 1 ? 's' : ''} use older versions.`,
        recommendation: 'Consider upgrading older code environments to Python 3.10 or later.',
        value: `${supportedPercent.toFixed(0)}%`,
        threshold: '≥90%',
      },
    };
  }

  if (supportedPercent >= 50) {
    return {
      score: 60,
      issue: {
        id: 'python-versions-old',
        category: 'version',
        severity: 'warning',
        title: `${unsupported} of ${total} code envs on older Python`,
        description: `Only ${supportedPercent.toFixed(0)}% of code environments use Python 3.10+. ${unsupported} environment${unsupported > 1 ? 's' : ''} use older, potentially unsupported versions.`,
        recommendation: 'Upgrade code environments to Python 3.10 or later.',
        value: `${supportedPercent.toFixed(0)}%`,
        threshold: '≥90%',
      },
    };
  }

  if (supportedPercent >= 30) {
    return {
      score: 40,
      issue: {
        id: 'python-versions-critical',
        category: 'version',
        severity: 'warning',
        title: `${unsupported} of ${total} code envs on older Python`,
        description: `Only ${supportedPercent.toFixed(0)}% of code environments use Python 3.10+. Most environments use older, potentially unsupported versions.`,
        recommendation: 'Prioritize upgrading code environments to Python 3.10 or later.',
        value: `${supportedPercent.toFixed(0)}%`,
        threshold: '≥90%',
      },
    };
  }

  return {
    score: 20,
    issue: {
      id: 'python-versions-critical',
      category: 'version',
      severity: 'critical',
      title: `${unsupported} of ${total} code envs on unsupported Python`,
      description: `Only ${supportedPercent.toFixed(0)}% of code environments use Python 3.10+. Most environments use older, unsupported Python versions that no longer receive security updates.`,
      recommendation: 'Upgrade code environments to Python 3.10 or later ASAP.',
      value: `${supportedPercent.toFixed(0)}%`,
      threshold: '≥90%',
    },
  };
}

/**
 * Calculate Spark version score
 * 3.x: 100, 2.x: 50, unknown: 75
 */
function scoreSparkVersion(sparkSettings: ParsedData['sparkSettings']): { score: number; issue?: HealthIssue } {
  if (!sparkSettings) return { score: 75 }; // No Spark = neutral

  const version = sparkSettings['Spark Version'];
  if (!version || typeof version !== 'string') return { score: 75 };

  const match = version.match(/^(\d+)/);
  if (!match) return { score: 75 };

  const major = parseInt(match[1], 10);

  if (major < 3) {
    return {
      score: 50,
      issue: {
        id: 'spark-version-old',
        category: 'version',
        severity: 'warning',
        title: `Spark ${version} is outdated`,
        description: `Spark 2.x is deprecated and lacks many performance improvements.`,
        recommendation: 'Upgrade to Spark 3.x for better performance and features.',
        value: version,
        threshold: '3.0+',
      },
    };
  }

  return { score: 100 };
}

/**
 * Calculate memory availability score
 * >30% available: 100, 10-30%: 70, <10%: 30
 */
function scoreMemoryAvailability(memoryInfo: ParsedData['memoryInfo']): { score: number; issue?: HealthIssue } {
  if (!memoryInfo) return { score: 75 };

  const totalStr = memoryInfo['MemTotal'] || memoryInfo['total'];
  const availableStr = memoryInfo['MemAvailable'] || memoryInfo['available'];

  if (!totalStr || !availableStr) return { score: 75 };

  const totalGB = parseMemorySizeToGB(totalStr);
  const availableGB = parseMemorySizeToGB(availableStr);

  if (totalGB <= 0) return { score: 75 };

  const availablePercent = (availableGB / totalGB) * 100;

  if (availablePercent < 10) {
    return {
      score: 30,
      issue: {
        id: 'memory-critical',
        category: 'system',
        severity: 'critical',
        title: `Memory critically low (${availablePercent.toFixed(0)}% available)`,
        description: `Only ${availableGB.toFixed(1)}GB of ${totalGB.toFixed(1)}GB memory is available.`,
        recommendation: 'Investigate memory usage, consider adding more RAM or reducing load.',
        value: `${availablePercent.toFixed(0)}%`,
        threshold: '>30%',
      },
    };
  }

  if (availablePercent < 30) {
    return {
      score: 70,
      issue: {
        id: 'memory-low',
        category: 'system',
        severity: 'warning',
        title: `Memory running low (${availablePercent.toFixed(0)}% available)`,
        description: `${availableGB.toFixed(1)}GB of ${totalGB.toFixed(1)}GB memory is available.`,
        recommendation: 'Monitor memory usage and consider scaling resources.',
        value: `${availablePercent.toFixed(0)}%`,
        threshold: '>30%',
      },
    };
  }

  return { score: 100 };
}

/**
 * Calculate filesystem score based on worst mount point
 * >20% available: 100, 10-20%: 70, <10%: 30
 */
function scoreFilesystem(filesystemInfo: ParsedData['filesystemInfo']): { score: number; issues: HealthIssue[] } {
  if (!filesystemInfo || filesystemInfo.length === 0) return { score: 75, issues: [] };

  let worstScore = 100;
  const issues: HealthIssue[] = [];

  for (const fs of filesystemInfo) {
    const usage = parsePercentage(fs['Use%']);
    const mountPoint = fs['Mounted on'] || fs.Filesystem;

    // Skip invalid entries
    if (usage > 100 || usage <= 0) continue;

    const available = 100 - usage;

    if (available < 10) {
      worstScore = Math.min(worstScore, 30);
      issues.push({
        id: `disk-critical-${mountPoint}`,
        category: 'system',
        severity: 'critical',
        title: `Disk ${usage}% full on ${mountPoint}`,
        description: `Only ${available}% disk space remaining on ${mountPoint}.`,
        recommendation: 'Free up disk space or expand storage immediately.',
        value: `${usage}%`,
        threshold: '<80%',
      });
    } else if (available < 20) {
      worstScore = Math.min(worstScore, 70);
      issues.push({
        id: `disk-warning-${mountPoint}`,
        category: 'system',
        severity: 'warning',
        title: `Disk ${usage}% used on ${mountPoint}`,
        description: `${available}% disk space remaining on ${mountPoint}.`,
        recommendation: 'Monitor disk usage and plan for cleanup or expansion.',
        value: `${usage}%`,
        threshold: '<80%',
      });
    }
  }

  return { score: worstScore, issues };
}

/**
 * Calculate disabled features score
 * 0: 100, 1-2: 80, 3-5: 60, >5: 40
 */
function scoreDisabledFeatures(disabledFeatures: ParsedData['disabledFeatures']): { score: number; issue?: HealthIssue } {
  if (!disabledFeatures) return { score: 100 };

  const count = Object.keys(disabledFeatures).length;

  if (count === 0) return { score: 100 };

  if (count <= 2) {
    return {
      score: 80,
      issue: {
        id: 'features-disabled-few',
        category: 'config',
        severity: 'info',
        title: `${count} feature${count > 1 ? 's' : ''} disabled`,
        description: `Some features are disabled which may limit functionality.`,
        recommendation: 'Review disabled features to ensure they are intentionally disabled.',
        value: count,
        threshold: 0,
      },
    };
  }

  if (count <= 5) {
    return {
      score: 60,
      issue: {
        id: 'features-disabled-several',
        category: 'config',
        severity: 'warning',
        title: `${count} features disabled`,
        description: `Multiple features are disabled which may significantly limit functionality.`,
        recommendation: 'Review disabled features and enable those needed for your use case.',
        value: count,
        threshold: '0-2',
      },
    };
  }

  return {
    score: 40,
    issue: {
      id: 'features-disabled-many',
      category: 'config',
      severity: 'warning',
      title: `${count} features disabled`,
      description: `Many features are disabled. This may indicate licensing limitations or configuration issues.`,
      recommendation: 'Review disabled features list and discuss with your admin or Dataiku support.',
      value: count,
      threshold: '0-2',
    },
  };
}

/**
 * Calculate security settings score (impersonation, cgroups)
 */
function scoreSecuritySettings(parsedData: ParsedData): { score: number; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  let totalScore = 100;
  let checksPerformed = 0;

  // Check impersonation setting
  if (parsedData.enabledSettings) {
    const impersonation = parsedData.enabledSettings['User Isolation'];
    if (impersonation !== undefined) {
      checksPerformed++;
      if (!impersonation) {
        totalScore -= 25;
        issues.push({
          id: 'impersonation-disabled',
          category: 'security',
          severity: 'warning',
          title: 'User isolation disabled',
          description: 'User isolation (impersonation) is not enabled.',
          recommendation: 'Consider enabling user isolation for better security in multi-user environments.',
        });
      }
    }
  }

  // Check cgroups setting
  if (parsedData.cgroupSettings) {
    const cgroupsEnabled = parsedData.cgroupSettings['Enabled'];
    checksPerformed++;
    if (!cgroupsEnabled) {
      totalScore -= 15;
      issues.push({
        id: 'cgroups-disabled',
        category: 'security',
        severity: 'info',
        title: 'CGroups not enabled',
        description: 'CGroups resource limits are not configured.',
        recommendation: 'Consider enabling CGroups for better resource isolation.',
      });
    }

    // Check for empty target types
    const emptyTargets = parsedData.cgroupSettings['Empty Target Types'];
    if (emptyTargets && String(emptyTargets).trim() !== '') {
      totalScore -= 20;
      issues.push({
        id: 'cgroups-empty-targets',
        category: 'security',
        severity: 'warning',
        title: 'CGroups empty target types',
        description: `Some target types have empty cgroup configurations: ${emptyTargets}`,
        recommendation: 'Configure cgroup settings for all target types.',
      });
    }
  }

  // Check open files limit
  if (parsedData.systemLimits) {
    const maxOpenFiles = parsedData.systemLimits['Max open files'];
    if (maxOpenFiles) {
      checksPerformed++;
      const limit = parseInt(String(maxOpenFiles), 10);
      if (limit < 65535) {
        totalScore -= 20;
        issues.push({
          id: 'open-files-low',
          category: 'system',
          severity: 'critical',
          title: `Open files limit too low (${limit})`,
          description: `Max open files is ${limit}, should be at least 65535.`,
          recommendation: 'Increase the open files limit in system configuration.',
          value: limit,
          threshold: '>=65535',
        });
      }
    }
  }

  // If no checks were performed, return neutral score
  if (checksPerformed === 0) return { score: 75, issues: [] };

  return { score: Math.max(0, totalScore), issues };
}

/**
 * Calculate Java memory settings score
 */
function scoreJavaMemory(javaMemorySettings: ParsedData['javaMemorySettings']): { score: number; issues: HealthIssue[] } {
  if (!javaMemorySettings) return { score: 75, issues: [] };

  const issues: HealthIssue[] = [];
  let totalScore = 100;
  let checksPerformed = 0;

  const components: Array<{ key: string; name: string }> = [
    { key: 'BACKEND', name: 'Backend' },
    { key: 'JEK', name: 'JEK' },
    { key: 'FEK', name: 'FEK' },
  ];

  for (const { key, name } of components) {
    const value = javaMemorySettings[key];
    if (value) {
      checksPerformed++;
      const memoryMB = parseMemoryToMB(value);
      if (memoryMB > 0 && memoryMB < 2048) {
        totalScore -= 15;
        issues.push({
          id: `java-memory-${key.toLowerCase()}`,
          category: 'config',
          severity: 'warning',
          title: `${name} heap < 2GB (${value})`,
          description: `${name} heap is configured to ${value}, recommended minimum is 2GB.`,
          recommendation: `Increase ${name} heap size in install.ini or environment settings.`,
          value: value,
          threshold: '>=2GB',
        });
      }
    }
  }

  if (checksPerformed === 0) return { score: 75, issues: [] };

  return { score: Math.max(0, totalScore), issues };
}

/**
 * Standalone function to calculate health score from parsed data
 * Use this when you need to calculate outside of React component context
 */
export function calculateHealthScore(parsedData: ParsedData): HealthScore {
    const categoryScores: HealthCategoryScore[] = [];
    const allIssues: HealthIssue[] = [];

    // ============================================
    // VERSION CATEGORY (25%)
    // ============================================
    const pythonResult = scorePythonVersion(parsedData.codeEnvs);
    const sparkResult = scoreSparkVersion(parsedData.sparkSettings);

    const versionScore = (pythonResult.score * 0.7) + (sparkResult.score * 0.3);
    const versionIssues: HealthIssue[] = [];
    if (pythonResult.issue) versionIssues.push(pythonResult.issue);
    if (sparkResult.issue) versionIssues.push(sparkResult.issue);

    categoryScores.push({
      category: 'version',
      label: 'Software Versions',
      score: versionScore,
      weight: CATEGORY_WEIGHTS.version,
      issues: versionIssues,
    });
    allIssues.push(...versionIssues);

    // ============================================
    // SYSTEM CATEGORY (30%)
    // ============================================
    const memoryResult = scoreMemoryAvailability(parsedData.memoryInfo);
    const filesystemResult = scoreFilesystem(parsedData.filesystemInfo);
    const securityResult = scoreSecuritySettings(parsedData);

    const systemScore = (
      (memoryResult.score * 0.4) +
      (filesystemResult.score * 0.4) +
      (securityResult.score * 0.2)
    );

    const systemIssues: HealthIssue[] = [...filesystemResult.issues];
    if (memoryResult.issue) systemIssues.push(memoryResult.issue);
    // Open files issue goes to system category
    const openFilesIssue = securityResult.issues.find(i => i.id === 'open-files-low');
    if (openFilesIssue) systemIssues.push(openFilesIssue);

    categoryScores.push({
      category: 'system',
      label: 'System Resources',
      score: systemScore,
      weight: CATEGORY_WEIGHTS.system,
      issues: systemIssues,
    });
    allIssues.push(...systemIssues);

    // ============================================
    // CONFIG CATEGORY (30%)
    // ============================================
    const disabledResult = scoreDisabledFeatures(parsedData.disabledFeatures);
    const javaMemoryResult = scoreJavaMemory(parsedData.javaMemorySettings);

    const configScore = (disabledResult.score * 0.50) + (javaMemoryResult.score * 0.50);
    const configIssues: HealthIssue[] = [...javaMemoryResult.issues];
    if (disabledResult.issue) configIssues.push(disabledResult.issue);

    categoryScores.push({
      category: 'config',
      label: 'Configuration',
      score: configScore,
      weight: CATEGORY_WEIGHTS.config,
      issues: configIssues,
    });
    allIssues.push(...configIssues);

    // ============================================
    // MEMORY PROVISIONING CATEGORY (20%)
    // Dataiku minimum: 32GB RAM, backend 12-20g, JEK default 2g (up to 4g)
    // Model: VM Total - Backend (Xmx) - Workloads CGroup = Available for JEK
    // ============================================
    let memoryScore = 100;
    const memoryIssues: HealthIssue[] = [];

    const totalVmStr = parsedData.memoryInfo?.total || '';
    const backendStr = parsedData.javaMemorySettings?.BACKEND || '0g';
    const jekStr = parsedData.javaMemorySettings?.JEK || '0g';
    const maxActivitiesRaw = parsedData.maxRunningActivities?.['Max Running Activities'];
    const maxActivitiesPerJobRaw = parsedData.maxRunningActivities?.['Max Running Activities Per Job'];
    const cgroupLimitStr = String(parsedData.cgroupSettings?.['Memory Limit'] || '0');

    const totalVm = parseInt(totalVmStr.replace(/[^0-9]/g, '')) || 0;
    const backendGB = parseInt(backendStr.replace(/[^0-9]/g, '')) || 0;
    const jekGB = parseInt(jekStr.replace(/[^0-9]/g, '')) || 0;
    const cgroupLimit = parseInt(cgroupLimitStr.replace(/[^0-9]/g, '')) || 0;
    const maxActivities = typeof maxActivitiesRaw === 'number' ? maxActivitiesRaw : 0;
    const maxActivitiesPerJob = typeof maxActivitiesPerJobRaw === 'number' && maxActivitiesPerJobRaw > 0 ? maxActivitiesPerJobRaw : 1;
    const maxJobs = Math.ceil(maxActivities / maxActivitiesPerJob);

    // Check: Dataiku requires minimum 32GB RAM
    if (totalVm > 0 && totalVm < 32) {
      memoryScore = Math.min(memoryScore, 40);
      memoryIssues.push({
        id: 'vm-below-minimum',
        category: 'memory',
        severity: 'warning',
        title: `VM has ${totalVm}GB RAM (Dataiku minimum: 32GB)`,
        description: 'Dataiku requires a minimum of 32GB RAM for DSS instances.',
        recommendation: 'Increase VM memory to at least 32GB.',
        docUrl: 'https://doc.dataiku.com/dss/latest/installation/custom/requirements.html',
      });
    }

    // Check: Memory provisioning waterfall
    if (totalVm > 0 && cgroupLimit > 0) {
      const availableForJEK = totalVm - backendGB - cgroupLimit;
      const jekTotal = jekGB * maxJobs;
      const jekHeadroom = availableForJEK - jekTotal;

      if (availableForJEK < 0) {
        // Red: Backend + workloads cgroup exceed VM total
        memoryScore = Math.min(memoryScore, 10);
        memoryIssues.push({
          id: 'memory-overcommitted',
          category: 'memory',
          severity: 'critical',
          title: `Backend + workloads cgroup exceed VM total by ${Math.abs(availableForJEK)}GB`,
          description: 'No memory left for JEK processes. OOM kills likely.',
          recommendation: 'Reduce backend Xmx, cgroup limit, or increase VM memory.',
        });
      } else if (jekHeadroom < 0) {
        // Red: JEK allocation exceeds available memory
        memoryScore = Math.min(memoryScore, 20);
        memoryIssues.push({
          id: 'jek-overprovisioned',
          category: 'memory',
          severity: 'critical',
          title: `JEK over-provisioned by ${Math.abs(jekHeadroom)}GB`,
          description: `JEK ${jekGB}g × ${maxJobs} jobs = ${jekTotal}GB but only ${availableForJEK}GB available. OOM kills likely under full load.`,
          recommendation: 'Reduce JEK heap, max running activities, or increase VM memory.',
        });
      } else if (jekHeadroom < jekGB) {
        // Orange: Less than one JEK worth of headroom
        memoryScore = Math.min(memoryScore, 45);
        memoryIssues.push({
          id: 'memory-low-headroom',
          category: 'memory',
          severity: 'warning',
          title: `Only ${jekHeadroom}GB headroom (less than 1 JEK)`,
          description: `After all allocations, less than one JEK (${jekGB}GB) of headroom remains.`,
          recommendation: 'Consider reducing JEK heap or max concurrent jobs, or increase VM memory.',
        });
      } else if (jekHeadroom < 10) {
        // Yellow: Tight but functional
        memoryScore = Math.min(memoryScore, 70);
        memoryIssues.push({
          id: 'memory-tight',
          category: 'memory',
          severity: 'info',
          title: `Tight memory headroom (${jekHeadroom}GB after JEK allocation)`,
          description: 'Limited headroom after all allocations. Monitor for memory pressure under peak load.',
        });
      }
    }

    categoryScores.push({
      category: 'memory',
      label: 'Memory Provisioning',
      score: memoryScore,
      weight: CATEGORY_WEIGHTS.memory,
      issues: memoryIssues,
    });
    allIssues.push(...memoryIssues);

    // ============================================
    // SECURITY CATEGORY (15%)
    // ============================================
    const securityIssues = securityResult.issues.filter(i => i.id !== 'open-files-low');
    const securityScore = securityIssues.length === 0 ? 100 :
      Math.max(0, 100 - (securityIssues.length * 25));

    categoryScores.push({
      category: 'security',
      label: 'Security',
      score: securityScore,
      weight: CATEGORY_WEIGHTS.security,
      issues: securityIssues,
    });
    allIssues.push(...securityIssues);

    // ============================================
    // CALCULATE OVERALL SCORE
    // ============================================
    const overallScore = categoryScores.reduce((sum, cat) => {
      return sum + (cat.score * cat.weight);
    }, 0);

    // Deduplicate issues by id
    const uniqueIssues = allIssues.filter(
      (issue, index, self) => index === self.findIndex(i => i.id === issue.id)
    );

    // Sort issues by severity
    const severityOrder: Record<HealthSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
      good: 3,
    };
    uniqueIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Determine status based on score only
    let status: HealthScore['status'] = 'healthy';
    if (overallScore < 50) {
      status = 'critical';
    } else if (overallScore < 80) {
      status = 'warning';
    }

  return {
    overall: Math.round(overallScore),
    status,
    categories: categoryScores,
    issues: uniqueIssues,
    criticalCount: uniqueIssues.filter(i => i.severity === 'critical').length,
    warningCount: uniqueIssues.filter(i => i.severity === 'warning').length,
    infoCount: uniqueIssues.filter(i => i.severity === 'info').length,
  };
}

/**
 * React hook for calculating health score with memoization
 * Use this in React components
 */
export function useHealthScore(parsedData: ParsedData): HealthScore {
  return useMemo(() => calculateHealthScore(parsedData), [parsedData]);
}
