import { useCallback } from 'react';
import { useDiag } from '../context/DiagContext';
import {
  VersionParser,
  ConnectionsParser,
  RestartTimeParser,
  VersionExtractionParser,
  UsersParser,
  LicenseParser,
  GeneralSettingsParser,
  LogParser,
  JavaMemoryParser,
  DiagTextParser,
  ClustersParser,
  ProjectsParser,
  CodeEnvsParser,
  PluginDiscoveryParser,
  DirListingParser,
  InstallIniParser,
  CodeEnvUsageParser,
  ConnectionUsageParser,
  LlmAuditParser,
} from '../parsers';
import { timer } from '../utils/timing';
import type { ExtractedFiles, ParsedData } from '../types';

interface UseDataParserReturn {
  parseFiles: (
    extractedFiles: ExtractedFiles,
    dsshome: string,
    projectFiles: string[]
  ) => ParsedData;
  parseFilesSync: (
    extractedFiles: ExtractedFiles,
    dsshome: string,
    projectFiles: string[]
  ) => ParsedData;
}

export function useDataParser(): UseDataParserReturn {
  const { setParsedData } = useDiag();

  const log = useCallback((message: string) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }, []);

  const findFile = useCallback((
    extractedFiles: ExtractedFiles,
    targetPath: string
  ): string | null => {
    if (extractedFiles[targetPath]) return targetPath;
    // Ends-with match
    for (const path in extractedFiles) {
      if (path.endsWith(targetPath)) return path;
    }
    // Filename-only match (if unique)
    const fileName = targetPath.split('/').pop();
    if (fileName) {
      const matches = Object.keys(extractedFiles).filter(
        (p) => p.endsWith('/' + fileName) || p === fileName
      );
      if (matches.length === 1) return matches[0];
    }
    return null;
  }, []);

  const parseFiles = useCallback((
    extractedFiles: ExtractedFiles,
    dsshome: string,
    projectFiles: string[]
  ): ParsedData => {
    timer.mark('parse:total');
    const parsedData: ParsedData = {};

    // Parse diag.txt
    const diagPath = findFile(extractedFiles, 'diag.txt');
    if (diagPath) {
      timer.mark('parse:diagText');
      log('Parsing diag.txt file');
      const parser = new DiagTextParser();
      const result = parser.parse(extractedFiles[diagPath], 'diag.txt');
      parsedData.cpuCores = result.cpuCores || undefined;
      parsedData.osInfo = result.osInfo;
      parsedData.memoryInfo = result.memoryInfo || {};
      parsedData.systemLimits = result.systemLimits || {};
      parsedData.filesystemInfo = result.filesystemInfo || [];

      // Parse Python and Spark versions
      const versionExtractionParser = new VersionExtractionParser();
      const versionResult = versionExtractionParser.parse(
        extractedFiles[diagPath],
        'diag.txt'
      );
      parsedData.pythonVersion = versionResult.pythonVersion;
      if (versionResult.sparkVersion) {
        if (!parsedData.sparkSettings) parsedData.sparkSettings = {};
        parsedData.sparkSettings['Spark Version'] = versionResult.sparkVersion;
      }
      timer.measure('parse:diagText', 'parse:diagText');
    }

    // Parse connections.json
    timer.mark('parse:connections');
    const connectionsPath = findFile(
      extractedFiles,
      dsshome + 'config/connections.json'
    );
    if (connectionsPath) {
      log('Parsing connections.json');
      const parser = new ConnectionsParser();
      const result = parser.parse(extractedFiles[connectionsPath], 'connections.json');
      parsedData.connections = result.connections || {};
      parsedData.connectionCounts = result.connections || {};
      parsedData.connectionDetails = result.connectionDetails || [];
    }
    timer.measure('parse:connections', 'parse:connections');

    // Parse general-settings.json
    timer.mark('parse:settings');
    const generalSettingsPath = findFile(
      extractedFiles,
      dsshome + 'config/general-settings.json'
    );
    if (generalSettingsPath) {
      log('Parsing general-settings.json');
      const parser = new GeneralSettingsParser();
      parser.setExternalData({
        sparkSettings: parsedData.sparkSettings,
        memoryInfo: parsedData.memoryInfo,
        javaMemorySettings: parsedData.javaMemorySettings,
        resourceLimits: parsedData.resourceLimits,
      });
      const result = parser.parse(
        extractedFiles[generalSettingsPath],
        'general-settings.json'
      );

      parsedData.generalSettings = result.generalSettings || {};
      parsedData.enabledSettings = result.enabledSettings || {};
      parsedData.sparkSettings = {
        ...parsedData.sparkSettings,
        ...result.sparkSettings,
      };
      parsedData.maxRunningActivities = result.maxRunningActivities || {};
      parsedData.authSettings = result.authSettings || {};
      parsedData.containerSettings = result.containerSettings || {};
      parsedData.integrationSettings = result.integrationSettings || {};
      parsedData.resourceLimits = result.resourceLimits || {};
      parsedData.cgroupSettings = result.cgroupSettings || {};
      parsedData.proxySettings = result.proxySettings || {};
      parsedData.disabledFeatures = result.disabledFeatures || {};
    }
    timer.measure('parse:settings', 'parse:settings');

    // Parse license.json
    timer.mark('parse:license');
    const licensePath = findFile(
      extractedFiles,
      dsshome + 'config/license.json'
    );
    if (licensePath) {
      log('Parsing license.json');
      const parser = new LicenseParser();
      const result = parser.parse(extractedFiles[licensePath], 'license.json');
      parsedData.license = result.license as Record<string, unknown> || {};
      parsedData.licenseInfo = result.license as Record<string, unknown> || {};
      parsedData.company = result.company || undefined;
      parsedData.licenseProperties = result.licenseProperties || {};
      parsedData.hasLicenseUsage = result.hasLicenseUsage || false;
    }
    timer.measure('parse:license', 'parse:license');

    // Parse dss-version.json
    timer.mark('parse:version');
    const versionPath = findFile(extractedFiles, dsshome + 'dss-version.json');
    if (versionPath) {
      log('Parsing dss-version.json');
      const parser = new VersionParser();
      const result = parser.parse(extractedFiles[versionPath], 'dss-version.json');
      if (result.dssVersion) {
        parsedData.dssVersion = result.dssVersion;
      }
    }
    timer.measure('parse:version', 'parse:version');

    // Parse users.json
    timer.mark('parse:users');
    const usersPath = findFile(extractedFiles, dsshome + 'config/users.json');
    if (usersPath) {
      log('Parsing users.json');
      const parser = new UsersParser();
      const result = parser.parse(extractedFiles[usersPath], 'users.json');
      if (result.userStats && Object.keys(result.userStats).length > 0) {
        parsedData.userStats = result.userStats;
      } else {
        parsedData.userStats = { 'Total Users': 'Error parsing' };
      }
      parsedData.users = result.users || [];
    }
    timer.measure('parse:users', 'parse:users');

    // Parse clusters
    timer.mark('parse:clusters');
    log('Parsing clusters');
    const clustersParser = new ClustersParser();
    const clustersResult = clustersParser.parse(extractedFiles, dsshome);
    parsedData.clusters = clustersResult.clusters || [];
    if (parsedData.clusters.length > 0) {
      log(`Found ${parsedData.clusters.length} Kubernetes clusters`);
    }
    timer.measure('parse:clusters', 'parse:clusters');

    // Parse supervisord.log for last restart time
    timer.mark('parse:restartTime');
    const supervisordLogPath = findFile(
      extractedFiles,
      dsshome + 'run/supervisord.log'
    );
    if (supervisordLogPath) {
      log('Parsing supervisord.log');
      const parser = new RestartTimeParser();
      const result = parser.parse(
        extractedFiles[supervisordLogPath],
        'supervisord.log'
      );
      parsedData.lastRestartTime = result.lastRestartTime || undefined;
    }
    timer.measure('parse:restartTime', 'parse:restartTime');

    // Parse env-default.sh
    timer.mark('parse:javaMemory');
    const envDefaultPath = findFile(
      extractedFiles,
      dsshome + 'bin/env-default.sh'
    );
    if (envDefaultPath) {
      log('Parsing env-default.sh');
      const parser = new JavaMemoryParser();
      const result = parser.parse(
        extractedFiles[envDefaultPath],
        'env-default.sh'
      );
      parsedData.javaMemorySettings = result.javaMemorySettings || {};
      parsedData.javaMemoryLimits = result.javaMemorySettings || {};
      if (result.dssVersion && !parsedData.dssVersion) {
        parsedData.dssVersion = result.dssVersion;
        log(`Extracted DSS version from env-default.sh: ${result.dssVersion}`);
      }
    }
    timer.measure('parse:javaMemory', 'parse:javaMemory');

    // Parse install.ini for instance info
    timer.mark('parse:installIni');
    const installIniPath = findFile(extractedFiles, dsshome + 'install.ini');
    if (installIniPath) {
      log('Parsing install.ini');
      const parser = new InstallIniParser();
      const result = parser.parse(extractedFiles[installIniPath], 'install.ini');
      if (result.nodeId || result.installId) {
        parsedData.instanceInfo = {
          nodeId: result.nodeId,
          installId: result.installId,
        };
        log(`Found instance info: nodeId=${result.nodeId}, installId=${result.installId}`);
      }
    }
    timer.measure('parse:installIni', 'parse:installIni');

    // Parse plugins
    timer.mark('parse:plugins');
    log('Parsing plugins');
    const pluginDiscoveryParser = new PluginDiscoveryParser(extractedFiles);
    const pluginsResult = pluginDiscoveryParser.parse();
    parsedData.plugins = pluginsResult.plugins;
    parsedData.pluginsCount = pluginsResult.pluginsCount;
    parsedData.pluginDetails = pluginsResult.pluginDetails;
    timer.measure('parse:plugins', 'parse:plugins');

    // Parse code envs
    timer.mark('parse:codeEnvs');
    log('Parsing code environments');
    const codeEnvsParser = new CodeEnvsParser(extractedFiles);
    const codeEnvsResult = codeEnvsParser.parse();
    parsedData.codeEnvs = codeEnvsResult.codeEnvs || [];
    parsedData.pythonVersionCounts = codeEnvsResult.pythonVersionCounts || {};
    parsedData.rVersionCounts = codeEnvsResult.rVersionCounts || {};

    // Map usage of each code env to projects/recipes
    const codeEnvUsageParser = new CodeEnvUsageParser(extractedFiles);
    parsedData.codeEnvUsages = codeEnvUsageParser.parse().codeEnvUsages;
    timer.measure('parse:codeEnvs', 'parse:codeEnvs');

    // Scan connection usage across datasets + LLM-mesh references
    timer.mark('parse:connectionUsage');
    const connectionUsageParser = new ConnectionUsageParser(
      extractedFiles,
      parsedData.connectionDetails || [],
    );
    const connUsage = connectionUsageParser.parse();
    parsedData.connectionDatasetUsages = connUsage.connectionDatasetUsages;
    parsedData.connectionLlmUsages = connUsage.connectionLlmUsages;
    parsedData.connectionUsageTotal = connUsage.connectionUsageTotal;
    parsedData.connectionUsageScanned = connUsage.connectionUsageScanned;
    timer.measure('parse:connectionUsage', 'parse:connectionUsage');

    // Build LLM audit rows (classification happens later in LlmAuditPage)
    timer.mark('parse:llmAudit');
    log('Building LLM audit rows');
    const llmAuditParser = new LlmAuditParser(
      extractedFiles,
      parsedData.connectionDetails || [],
    );
    const llmAuditResult = llmAuditParser.parse();
    parsedData.llmAudit = {
      rows: llmAuditResult.rows,
      lookupLoadedAt: null,
      lookupError: null,
    };
    timer.measure('parse:llmAudit', 'parse:llmAudit');

    // Parse projects
    timer.mark('parse:projects');
    log('Parsing projects');
    const projectsParser = new ProjectsParser(
      extractedFiles,
      projectFiles,
      log
    );
    const projectsResult = projectsParser.parse();
    parsedData.projects = projectsResult.projects || [];
    timer.measure('parse:projects', 'parse:projects');

    // Compute users by project count
    if (parsedData.projects?.length && parsedData.users?.length) {
      const userEmailMap: Record<string, string> = {};
      parsedData.users.forEach((u) => {
        userEmailMap[u.login] = u.email || u.login;
      });

      const projectCounts: Record<string, number> = {};
      parsedData.projects.forEach((p) => {
        projectCounts[p.owner] = (projectCounts[p.owner] || 0) + 1;
      });

      const usersByProjects: Record<string, string> = {};
      Object.entries(projectCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([login, count]) => {
          const email = userEmailMap[login] || login;
          usersByProjects[email] = String(count);
        });

      if (Object.keys(usersByProjects).length > 0) {
        parsedData.usersByProjects = usersByProjects;
      }
    }

    // Parse backend.log for errors (if available)
    timer.mark('parse:logs');
    const backendLogPath = findFile(
      extractedFiles,
      dsshome + 'run/backend.log'
    );
    if (backendLogPath) {
      log('Parsing backend.log');
      const parser = new LogParser();
      const result = parser.parse(
        extractedFiles[backendLogPath],
        'backend.log'
      );
      parsedData.formattedLogErrors = result.formattedLogErrors || 'No log errors found';
      parsedData.rawLogErrors = result.rawLogErrors || [];
      parsedData.logStats = result.logStats || {
        'Total Lines': 0,
        'Unique Errors': 0,
        'Displayed Errors': 0,
      };
    }
    timer.measure('parse:logs', 'parse:logs');

    // Parse datadir_listing.txt for directory tree (only for small files)
    // Large files are handled by DirTreeSection using async blob streaming
    timer.mark('parse:dirListing');
    const dirListingPath = findFile(extractedFiles, 'datadir_listing.txt');
    if (dirListingPath) {
      const content = extractedFiles[dirListingPath];

      // Skip if this is a marker for blob storage (large file)
      if (content === '__BLOB_STORED__') {
        log('datadir_listing.txt: Large file, will be parsed async via DirTreeSection');
      } else {
        log('Parsing datadir_listing.txt (small file, sync)');
        log(`datadir_listing.txt: ${content.length} chars, ${content.split('\n').length} lines`);

        // Debug: show first few lines
        const firstLines = content.split('\n').slice(0, 3);
        log(`First lines: ${JSON.stringify(firstLines)}`);

        const parser = new DirListingParser();
        const result = parser.parse(content, 'datadir_listing.txt');

        log(`Parse result: root=${!!result.root}, totalSize=${result.totalSize}, totalFiles=${result.totalFiles}, rootPath=${result.rootPath}`);

        if (result.root) {
          parsedData.dirTree = result;
          log(`Parsed directory tree: ${result.totalFiles} files, ${(result.totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`);
        } else {
          log('WARNING: dirTree root is null - parsing may have failed');
        }
      }
    } else {
      log('datadir_listing.txt not found in extracted files');
    }
    timer.measure('parse:dirListing', 'parse:dirListing');

    // Note: project footprint parsing runs later inside useProjectRows,
    // gated on the async dir tree being loaded.

    timer.measure('parse:total', 'parse:total');

    // Print timing summary
    timer.printSummary();

    // Update context with parsed data
    setParsedData(parsedData);

    return parsedData;
  }, [findFile, log, setParsedData]);

  // Sync version that doesn't update context - for comparison mode
  const parseFilesSync = useCallback((
    extractedFiles: ExtractedFiles,
    dsshome: string,
    projectFiles: string[]
  ): ParsedData => {
    const parsedData: ParsedData = {};

    // Parse diag.txt
    const diagPath = findFile(extractedFiles, 'diag.txt');
    if (diagPath) {
      const parser = new DiagTextParser();
      const result = parser.parse(extractedFiles[diagPath], 'diag.txt');
      parsedData.cpuCores = result.cpuCores || undefined;
      parsedData.osInfo = result.osInfo;
      parsedData.memoryInfo = result.memoryInfo || {};
      parsedData.systemLimits = result.systemLimits || {};
      parsedData.filesystemInfo = result.filesystemInfo || [];

      const versionExtractionParser = new VersionExtractionParser();
      const versionResult = versionExtractionParser.parse(extractedFiles[diagPath], 'diag.txt');
      parsedData.pythonVersion = versionResult.pythonVersion;
      if (versionResult.sparkVersion) {
        if (!parsedData.sparkSettings) parsedData.sparkSettings = {};
        parsedData.sparkSettings['Spark Version'] = versionResult.sparkVersion;
      }
    }

    // Parse connections.json
    const connectionsPath = findFile(extractedFiles, dsshome + 'config/connections.json');
    if (connectionsPath) {
      const parser = new ConnectionsParser();
      const result = parser.parse(extractedFiles[connectionsPath], 'connections.json');
      parsedData.connections = result.connections || {};
      parsedData.connectionCounts = result.connections || {};
      parsedData.connectionDetails = result.connectionDetails || [];
    }

    // Parse general-settings.json
    const generalSettingsPath = findFile(extractedFiles, dsshome + 'config/general-settings.json');
    if (generalSettingsPath) {
      const parser = new GeneralSettingsParser();
      parser.setExternalData({
        sparkSettings: parsedData.sparkSettings,
        memoryInfo: parsedData.memoryInfo,
        javaMemorySettings: parsedData.javaMemorySettings,
        resourceLimits: parsedData.resourceLimits,
      });
      const result = parser.parse(extractedFiles[generalSettingsPath], 'general-settings.json');
      parsedData.generalSettings = result.generalSettings || {};
      parsedData.enabledSettings = result.enabledSettings || {};
      parsedData.sparkSettings = { ...parsedData.sparkSettings, ...result.sparkSettings };
      parsedData.maxRunningActivities = result.maxRunningActivities || {};
      parsedData.authSettings = result.authSettings || {};
      parsedData.containerSettings = result.containerSettings || {};
      parsedData.integrationSettings = result.integrationSettings || {};
      parsedData.resourceLimits = result.resourceLimits || {};
      parsedData.cgroupSettings = result.cgroupSettings || {};
      parsedData.proxySettings = result.proxySettings || {};
      parsedData.disabledFeatures = result.disabledFeatures || {};
    }

    // Parse license.json
    const licensePath = findFile(extractedFiles, dsshome + 'config/license.json');
    if (licensePath) {
      const parser = new LicenseParser();
      const result = parser.parse(extractedFiles[licensePath], 'license.json');
      parsedData.license = result.license as Record<string, unknown> || {};
      parsedData.licenseInfo = result.license as Record<string, unknown> || {};
      parsedData.company = result.company || undefined;
      parsedData.licenseProperties = result.licenseProperties || {};
      parsedData.hasLicenseUsage = result.hasLicenseUsage || false;
    }

    // Parse dss-version.json
    const versionPath = findFile(extractedFiles, dsshome + 'dss-version.json');
    if (versionPath) {
      const parser = new VersionParser();
      const result = parser.parse(extractedFiles[versionPath], 'dss-version.json');
      if (result.dssVersion) parsedData.dssVersion = result.dssVersion;
    }

    // Parse users.json
    const usersPath = findFile(extractedFiles, dsshome + 'config/users.json');
    if (usersPath) {
      const parser = new UsersParser();
      const result = parser.parse(extractedFiles[usersPath], 'users.json');
      parsedData.userStats = result.userStats && Object.keys(result.userStats).length > 0
        ? result.userStats
        : { 'Total Users': 'Error parsing' };
      parsedData.users = result.users || [];
    }

    // Parse clusters
    const clustersParser = new ClustersParser();
    const clustersResult = clustersParser.parse(extractedFiles, dsshome);
    parsedData.clusters = clustersResult.clusters || [];

    // Parse supervisord.log for last restart time
    const supervisordLogPath = findFile(extractedFiles, dsshome + 'run/supervisord.log');
    if (supervisordLogPath) {
      const parser = new RestartTimeParser();
      const result = parser.parse(extractedFiles[supervisordLogPath], 'supervisord.log');
      parsedData.lastRestartTime = result.lastRestartTime || undefined;
    }

    // Parse env-default.sh
    const envDefaultPath = findFile(extractedFiles, dsshome + 'bin/env-default.sh');
    if (envDefaultPath) {
      const parser = new JavaMemoryParser();
      const result = parser.parse(extractedFiles[envDefaultPath], 'env-default.sh');
      parsedData.javaMemorySettings = result.javaMemorySettings || {};
      parsedData.javaMemoryLimits = result.javaMemorySettings || {};
      if (result.dssVersion && !parsedData.dssVersion) {
        parsedData.dssVersion = result.dssVersion;
      }
    }

    // Parse install.ini for instance info
    const installIniPath = findFile(extractedFiles, dsshome + 'install.ini');
    if (installIniPath) {
      const parser = new InstallIniParser();
      const result = parser.parse(extractedFiles[installIniPath], 'install.ini');
      if (result.nodeId || result.installId) {
        parsedData.instanceInfo = {
          nodeId: result.nodeId,
          installId: result.installId,
        };
      }
    }

    // Parse plugins
    const pluginDiscoveryParser = new PluginDiscoveryParser(extractedFiles);
    const pluginsResult = pluginDiscoveryParser.parse();
    parsedData.plugins = pluginsResult.plugins;
    parsedData.pluginsCount = pluginsResult.pluginsCount;
    parsedData.pluginDetails = pluginsResult.pluginDetails;

    // Parse code envs
    const codeEnvsParser = new CodeEnvsParser(extractedFiles);
    const codeEnvsResult = codeEnvsParser.parse();
    parsedData.codeEnvs = codeEnvsResult.codeEnvs || [];
    parsedData.pythonVersionCounts = codeEnvsResult.pythonVersionCounts || {};
    parsedData.rVersionCounts = codeEnvsResult.rVersionCounts || {};

    const codeEnvUsageParser = new CodeEnvUsageParser(extractedFiles);
    parsedData.codeEnvUsages = codeEnvUsageParser.parse().codeEnvUsages;

    const connectionUsageParser = new ConnectionUsageParser(
      extractedFiles,
      parsedData.connectionDetails || [],
    );
    const connUsage = connectionUsageParser.parse();
    parsedData.connectionDatasetUsages = connUsage.connectionDatasetUsages;
    parsedData.connectionLlmUsages = connUsage.connectionLlmUsages;
    parsedData.connectionUsageTotal = connUsage.connectionUsageTotal;
    parsedData.connectionUsageScanned = connUsage.connectionUsageScanned;

    // Build LLM audit rows
    const llmAuditParserSync = new LlmAuditParser(
      extractedFiles,
      parsedData.connectionDetails || [],
    );
    const llmAuditResultSync = llmAuditParserSync.parse();
    parsedData.llmAudit = {
      rows: llmAuditResultSync.rows,
      lookupLoadedAt: null,
      lookupError: null,
    };

    // Parse projects
    const projectsParser = new ProjectsParser(extractedFiles, projectFiles, () => {});
    const projectsResult = projectsParser.parse();
    parsedData.projects = projectsResult.projects || [];

    // Compute users by project count
    if (parsedData.projects?.length && parsedData.users?.length) {
      const userEmailMap: Record<string, string> = {};
      parsedData.users.forEach((u) => { userEmailMap[u.login] = u.email || u.login; });
      const projectCounts: Record<string, number> = {};
      parsedData.projects.forEach((p) => { projectCounts[p.owner] = (projectCounts[p.owner] || 0) + 1; });
      const usersByProjects: Record<string, string> = {};
      Object.entries(projectCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([login, count]) => {
          usersByProjects[userEmailMap[login] || login] = String(count);
        });
      if (Object.keys(usersByProjects).length > 0) parsedData.usersByProjects = usersByProjects;
    }

    // Parse backend.log for errors
    const backendLogPath = findFile(extractedFiles, dsshome + 'run/backend.log');
    if (backendLogPath) {
      const parser = new LogParser();
      const result = parser.parse(extractedFiles[backendLogPath], 'backend.log');
      parsedData.formattedLogErrors = result.formattedLogErrors || 'No log errors found';
      parsedData.rawLogErrors = result.rawLogErrors || [];
      parsedData.logStats = result.logStats || { 'Total Lines': 0, 'Unique Errors': 0, 'Displayed Errors': 0 };
    }

    return parsedData;
  }, [findFile]);

  return { parseFiles, parseFilesSync };
}
