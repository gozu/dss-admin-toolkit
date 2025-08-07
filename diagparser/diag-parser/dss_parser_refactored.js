// Base parser classes
class BaseJSONParser {
    constructor() {
        this.parsedData = {};
    }
    
    parse(content, filename) {
        try {
            const data = JSON.parse(content);
            this.log(`Successfully parsed JSON file: ${filename}`);
            return this.processData(data, filename);
        } catch (error) {
            this.log(`Error parsing JSON file ${filename}: ${error.message}`);
            // Try alternative parsing for malformed JSON
            try {
                const lines = content.split('\n');
                const result = {};
                for (const line of lines) {
                    if (line.includes(':')) {
                        const [key, ...valueParts] = line.split(':');
                        const value = valueParts.join(':').trim().replace(/['"]/g, '');
                        result[key.trim()] = value;
                    }
                }
                return this.processData(result, filename);
            } catch (altError) {
                this.log(`Alternative parsing failed for ${filename}: ${altError.message}`);
                return {};
            }
        }
    }
    
    processData(data, filename) {
        // Override in subclasses
        return data;
    }
    
    validateJSON(content) {
        try {
            JSON.parse(content);
            return true;
        } catch {
            return false;
        }
    }
    
    log(message, data) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}${data ? `: ${JSON.stringify(data, null, 2)}` : ''}`;
        console.log(logMessage);
    }
}

class BaseTextParser {
    constructor() {
        this.parsedData = {};
    }
    
    parse(content, filename) {
        if (!content) {
            this.log(`${filename} content is empty`);
            return {};
        }
        this.log(`Parsing ${filename} file`);
        return this.processContent(content, filename);
    }
    
    processContent(content, filename) {
        // Override in subclasses
        return {};
    }
    
    extractSection(content, startPattern, endPattern) {
        const startMatch = content.match(startPattern);
        if (!startMatch) return null;
        
        const startIndex = startMatch.index + startMatch[0].length;
        const remainingContent = content.substring(startIndex);
        
        if (endPattern) {
            const endMatch = remainingContent.match(endPattern);
            if (endMatch) {
                return remainingContent.substring(0, endMatch.index).trim();
            }
        }
        
        return remainingContent.trim();
    }
    
    parseKeyValue(line, delimiter = '=') {
        const index = line.indexOf(delimiter);
        if (index === -1) return null;
        
        const key = line.substring(0, index).trim();
        const value = line.substring(index + 1).trim();
        return { key, value };
    }
    
    log(message, data) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}${data ? `: ${JSON.stringify(data, null, 2)}` : ''}`;
        console.log(logMessage);
    }
}

// JSON Parser implementations
class GeneralSettingsParser extends BaseJSONParser {
    processData(data, filename) {
        const result = {
            enabledSettings: {},
            sparkSettings: {},
            authSettings: {},
            containerSettings: {},
            integrationSettings: {},
            resourceLimits: {},
            maxRunningActivities: {},
            cgroupSettings: {},
            proxySettings: {}
        };
        
        // Extract enabled settings (boolean values)
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'boolean') {
                result.enabledSettings[key] = value;
            }
        }
        
        // Extract max running activities
        for (const [key, value] of Object.entries(data)) {
            if (key.includes('maxRunning') && typeof value !== 'object') {
                result.maxRunningActivities[key] = value;
            }
        }
        
        result.sparkSettings = this.parseSparkSettings(data);
        result.authSettings = this.parseAuthSettings(data);
        result.containerSettings = this.parseContainerSettings(data);
        result.integrationSettings = this.parseIntegrationSettings(data);
        result.resourceLimits = this.parseResourceLimits(data);
        result.cgroupSettings = this.parseCgroupsSettings(data);
        result.proxySettings = this.parseProxySettings(data);
        
        return result;
    }
    
    parseAuthSettings(data) {
        const authSettings = {};
        
        if (data.ldapSettings) {
            authSettings['LDAP Authentication'] = data.ldapSettings.enabled === true ? 'Enabled' : 'Disabled';
        }
        
        if (data.ssoSettings) {
            const isSSOConfigured = data.ssoSettings.enabled;
            authSettings['SSO Authentication'] = isSSOConfigured ? 
                `Enabled (${data.ssoSettings.protocol})` : 'Disabled';
            
            if (isSSOConfigured) {
                if (data.ssoSettings.protocol === 'SAML' && data.ssoSettings.samlSPParams) {
                    const samlParams = data.ssoSettings.samlSPParams;
                    if (samlParams.entityId) {
                        authSettings['SSO Entity ID'] = {
                            value: samlParams.entityId,
                            truncate: true,
                            maxLength: 20
                        };
                    }
                    if (samlParams.displayNameAttribute) {
                        authSettings['SSO Display Name Attribute'] = samlParams.displayNameAttribute;
                    }
                    if (samlParams.emailAttribute) {
                        authSettings['SSO Email Attribute'] = samlParams.emailAttribute;
                    }
                    authSettings['SSO Sign Requests'] = samlParams.signRequests === true ? 'Yes' : 'No';
                    authSettings['SSO Groups Enabled'] = samlParams.enableGroups === true ? 'Yes' : 'No';
                    if (samlParams.groupsAttribute) {
                        authSettings['SSO Groups Attribute'] = samlParams.groupsAttribute;
                    }
                }
            }
        }
        
        if (data.azureADSettings) {
            authSettings['Azure AD Authentication'] = data.azureADSettings.enabled === true ? 'Enabled' : 'Disabled';
        }
        
        if (data.customAuthSettings) {
            authSettings['Custom Authentication'] = data.customAuthSettings.enabled === true ? 'Enabled' : 'Disabled';
        }
        
        if (data.impersonation) {
            authSettings['Impersonation'] = data.impersonation.enabled === true ? 'Enabled' : 'Disabled';
        }
        
        return authSettings;
    }
    
    parseSparkSettings(data) {
        const sparkSettings = {};
        
        if (data.sparkSettings && typeof data.sparkSettings === 'object') {
            for (const [key, value] of Object.entries(data.sparkSettings)) {
                if (typeof value !== 'object' && !Array.isArray(value)) {
                    sparkSettings[key] = value;
                }
            }
            
            if (data.sparkSettings.additionalSparkSubmitJars && Array.isArray(data.sparkSettings.additionalSparkSubmitJars)) {
                sparkSettings['additionalSparkSubmitJars'] = `${data.sparkSettings.additionalSparkSubmitJars.length} jar(s)`;
            }
            
            if (data.sparkSettings.executionConfigs && Array.isArray(data.sparkSettings.executionConfigs)) {
                sparkSettings['executionConfigs'] = `${data.sparkSettings.executionConfigs.length} configuration(s)`;
                
                const configNames = data.sparkSettings.executionConfigs
                    .map(config => config.name)
                    .filter(Boolean)
                    .join(', ');
                
                if (configNames) {
                    sparkSettings['executionConfigNames'] = configNames;
                }
            }
        }
        
        return sparkSettings;
    }
    
    parseContainerSettings(data) {
        const containerSettings = {};
        if (data.containerSettings) {
            containerSettings['Default Execution Config'] = data.containerSettings.defaultExecutionConfig || 'Not set';
            containerSettings['Container Execution Configs'] = data.containerSettings.executionConfigs ? 
                data.containerSettings.executionConfigs.length : 0;
        }
        return containerSettings;
    }
    
    parseIntegrationSettings(data) {
        const integrationSettings = {};
        if (data.governIntegrationSettings) {
            integrationSettings['Govern Integration'] = data.governIntegrationSettings.enabled === true ? 
                `Enabled (${data.governIntegrationSettings.nodeUrl || ''})` : 'Disabled';
        }
        
        if (data.deployerClientSettings) {
            integrationSettings['Deployer Mode'] = data.deployerClientSettings.mode || 'Unknown';
        }
        
        return integrationSettings;
    }
    
    parseResourceLimits(data) {
        const resourceLimits = {};
        if (data.limits && data.limits.memSampleBytes) {
            const softLimit = data.limits.memSampleBytes.soft;
            resourceLimits['Memory Sample Soft Limit'] = softLimit > 0 ? Math.round(softLimit / (1024 * 1024)) + ' MB' : 'None';
            
            const hardLimit = data.limits.memSampleBytes.hard;
            resourceLimits['Memory Sample Hard Limit'] = hardLimit > 0 ? Math.round(hardLimit / (1024 * 1024)) + ' MB' : 'None';
        }
        
        resourceLimits['Max Running Activities'] = data.maxRunningActivities || 'Not set';
        resourceLimits['Max Running Activities Per Job'] = data.maxRunningActivitiesPerJob || 'Not set';
        
        return resourceLimits;
    }
    
    parseCgroupsSettings(data) {
        if (!data.cgroupSettings) return {};
        
        const cgroupSettings = {};
        const cgroups = data.cgroupSettings;
        
        cgroupSettings['Enabled'] = cgroups.enabled === true ? 'Yes' : 'No';
        cgroupSettings['CGroups Version'] = cgroups.cgroupsVersion || 'Not specified';
        cgroupSettings['V2 Controllers'] = cgroups.cgroupsV2Controllers || 'Not specified';
        cgroupSettings['Mount Point'] = cgroups.hierarchiesMountPoint || 'Not specified';
        
        if (cgroups.cgroups && cgroups.cgroups.length > 0) {
            const mainCgroup = cgroups.cgroups[0];
            if (mainCgroup.limits && mainCgroup.limits.length > 0) {
                for (const limit of mainCgroup.limits) {
                    if (limit.key === 'memory.limit_in_bytes' && limit.value) {
                        cgroupSettings['Memory Limit'] = limit.value;
                        break;
                    }
                }
            }
            if (mainCgroup.cgroupPathTemplate) {
                cgroupSettings['Main Path Template'] = mainCgroup.cgroupPathTemplate;
            }
        }
        
        const targetTypes = [
            'mlKernels', 'pythonRRecipes', 'pythonRSparkRecipes', 'pythonScenarios', 
            'jupyterKernels', 'mlRecipes', 'pythonMacros', 'rmarkdownBuilders', 
            'webappDevBackends', 'eda', 'edaRecipes', 'metricsChecks', 
            'deploymentHooks', 'devLambdaServer', 'customPythonDataAccessComponents',
            'jobExecutionKernels'
        ];
        
        let configuredTargets = 0;
        let emptyTargets = 0;
        
        for (const type of targetTypes) {
            if (cgroups[type] && cgroups[type].targets) {
                if (cgroups[type].targets.length > 0) {
                    configuredTargets++;
                } else {
                    emptyTargets++;
                }
            }
        }
        
        cgroupSettings['Configured Target Types'] = configuredTargets;
        cgroupSettings['Empty Target Types'] = emptyTargets;
        
        return cgroupSettings;
    }
    
    parseProxySettings(data) {
        if (!data.proxySettings) return {};
        
        const proxySettings = {};
        const proxy = data.proxySettings;
        
        const isProxyConfigured = proxy.port > 0 && proxy.host;
        proxySettings['Proxy Configured'] = isProxyConfigured ? 'Yes' : 'No';
        
        if (isProxyConfigured) {
            proxySettings['Host'] = proxy.host || 'Not set';
            proxySettings['Port'] = proxy.port || 'Not set';
            proxySettings['Protocol'] = proxy.protocol || 'http';
            
            if (proxy.useAuthentication) {
                proxySettings['Authentication'] = 'Yes';
                proxySettings['Username'] = proxy.username || 'Not set';
                proxySettings['Password'] = proxy.password ? '[Set]' : '[Not set]';
            } else {
                proxySettings['Authentication'] = 'No';
            }
            
            if (proxy.noProxy && Array.isArray(proxy.noProxy)) {
                proxySettings['No Proxy Hosts'] = proxy.noProxy.join(', ') || 'None';
            }
        } else {
            proxySettings['Port'] = proxy.port || 0;
            proxySettings['Details'] = 'No proxy configured';
        }
        
        return proxySettings;
    }
}

class ConnectionsParser extends BaseJSONParser {
    processData(content, filename) {
        const lines = typeof content === 'string' ? content.split('\n') : [JSON.stringify(content)];
        const connectionTypes = {};
        
        for (const line of lines) {
            if (line.includes('"type":')) {
                const type = line.match(/"type"\s*:\s*"([^"]+)"/);
                if (type && type[1]) {
                    let connectionType = type[1];
                    if (connectionType === 'EC2') {
                        connectionType = 'S3';
                    }
                    
                    if (!connectionTypes[connectionType]) {
                        connectionTypes[connectionType] = 0;
                    }
                    connectionTypes[connectionType]++;
                }
            }
        }
        
        return { connections: connectionTypes };
    }
}

class LicenseParser extends BaseJSONParser {
    processData(data, filename) {
        const result = {
            company: null,
            licenseProperties: {}
        };
        
        if (data.content && data.content.licensee) {
            result.company = data.content.licensee.company;
        }
        
        if (data.content && data.content.properties) {
            for (const [key, value] of Object.entries(data.content.properties)) {
                let formattedKey = key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase())
                    .replace(/\./g, ' ')
                    .trim();
                
                formattedKey = formattedKey
                    .replace('Max', 'Maximum')
                    .replace('Min', 'Minimum');
                
                let formattedValue = value;
                if (key === 'emittedOn' && value && value.length === 8) {
                    formattedValue = this.formatDate(value);
                }
                
                result.licenseProperties[formattedKey] = formattedValue;
            }
        }
        
        if (data.content && data.content.expiresOn) {
            const expiresOn = data.content.expiresOn;
            if (expiresOn && expiresOn.length === 8) {
                result.licenseProperties['Expires On'] = this.formatDate(expiresOn);
            } else {
                result.licenseProperties['Expires On'] = expiresOn;
            }
        }
        
        // Extract license usage information
        if (data.content && data.content.usage) {
            const usage = data.content.usage;
            
            if (usage.namedUsers) {
                const { current, limit } = usage.namedUsers;
                result.licenseProperties['Named Users'] = `${current} / ${limit} (${Math.round(current/limit*100)}%)`;
            }
            
            if (usage.concurrentUsers) {
                const { current, limit } = usage.concurrentUsers;
                result.licenseProperties['Concurrent Users'] = `${current} / ${limit} (${Math.round(current/limit*100)}%)`;
            }
            
            if (usage.connections) {
                const { current, limit } = usage.connections;
                result.licenseProperties['Connections'] = `${current} / ${limit} (${Math.round(current/limit*100)}%)`;
            }
            
            if (usage.projects) {
                const { current, limit } = usage.projects;
                result.licenseProperties['Projects'] = `${current} / ${limit} (${Math.round(current/limit*100)}%)`;
            }
            
            if (usage.features) {
                for (const feature of usage.features) {
                    if (feature.name && feature.current !== undefined && feature.limit !== undefined) {
                        const featureName = feature.name
                            .replace(/([A-Z])/g, ' $1')
                            .replace(/^./, str => str.toUpperCase());
                        
                        const percentage = feature.limit > 0 ? Math.round(feature.current/feature.limit*100) : 0;
                        result.licenseProperties[featureName] = 
                            `${feature.current} / ${feature.limit} (${percentage}%)`;
                    }
                }
            }
        }
        
        return result;
    }
    
    formatDate(dateString) {
        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);
        
        const date = new Date(year, month - 1, day);
        return date.getDate() + ' ' + 
            date.toLocaleString('en-US', { month: 'short' }) + ' ' + 
            date.getFullYear();
    }
}

class UsersParser extends BaseJSONParser {
    processData(data, filename) {
        const userStats = {};
        
        if (data && data.users && Array.isArray(data.users)) {
            const allUsers = data.users;
            const enabledUsers = data.users.filter(user => user.enabled === true);
            
            userStats['Total Users'] = allUsers.length;
            userStats['Active Users'] = enabledUsers.length;
            
            const profileCounts = {};
            for (const user of enabledUsers) {
                if (user && user.userProfile) {
                    if (!profileCounts[user.userProfile]) {
                        profileCounts[user.userProfile] = 0;
                    }
                    profileCounts[user.userProfile]++;
                }
            }
            
            Object.assign(userStats, profileCounts);
            
            if (data.groups && Array.isArray(data.groups)) {
                userStats['Total Groups'] = data.groups.length;
            }
        }
        
        return { userStats };
    }
}

class VersionParser extends BaseJSONParser {
    processData(data, filename) {
        if (data.product_version) {
            return { dssVersion: data.product_version };
        }
        return {};
    }
}

class ProjectParamsParser extends BaseJSONParser {
    processData(data, filename) {
        const projectKey = this.extractProjectKey(filename);
        
        let projectName = data.name || projectKey;
        projectName = projectName.replace(/_/g, ' ');
        
        let versionNumber = 0;
        if (data.versionTag && typeof data.versionTag.versionNumber === 'number') {
            versionNumber = data.versionTag.versionNumber;
        }
        
        const permissions = this.parsePermissions(data);
        
        return {
            key: projectKey,
            name: projectName,
            owner: data.owner || 'Unknown',
            permissions: permissions,
            versionNumber: versionNumber
        };
    }
    
    extractProjectKey(filepath) {
        const pathParts = filepath.split('/');
        const projectsIndex = pathParts.indexOf('projects');
        if (projectsIndex >= 0 && projectsIndex + 1 < pathParts.length) {
            return pathParts[projectsIndex + 1];
        }
        return 'unknown';
    }
    
    parsePermissions(data) {
        const permissions = [];
        if (data.permissions && Array.isArray(data.permissions)) {
            for (const perm of data.permissions) {
                const permissionEntry = {
                    type: perm.group ? 'Group' : 'User',
                    name: perm.group || perm.user || 'Unknown',
                    permissions: {}
                };
                
                for (const [key, value] of Object.entries(perm)) {
                    if (key !== 'group' && key !== 'user') {
                        permissionEntry.permissions[key] = value;
                    }
                }
                
                permissions.push(permissionEntry);
            }
        }
        return permissions;
    }
}

class PluginSettingsParser extends BaseJSONParser {
    processData(data, filename) {
        // Extract plugin name from path
        const pathParts = filename.split('/');
        const pluginsIndex = pathParts.indexOf('plugins');
        
        if (pluginsIndex >= 0 && pluginsIndex + 1 < pathParts.length) {
            const pluginName = pathParts[pluginsIndex + 1];
            return { pluginName, settings: data };
        }
        
        return {};
    }
}

class CodeEnvDescParser extends BaseJSONParser {
    processData(data, filename) {
        const pythonVersion = this.extractPythonVersion(data);
        
        // Extract env name from path
        const pathParts = filename.split('/');
        const envName = pathParts[pathParts.length - 2];
        
        return {
            name: envName,
            version: pythonVersion,
            fullData: data
        };
    }
    
    extractPythonVersion(data) {
        let pythonVersion = 'NA';
        if (data.pythonInterpreter) {
            const verString = data.pythonInterpreter.replace("PYTHON", "");
            
            if (verString.length > 0) {
                const majorVersion = verString[0];
                const minorVersion = verString.substring(1);
                pythonVersion = majorVersion + "." + minorVersion;
            }
        }
        return pythonVersion;
    }
}

// Text Parser implementations
class DiagParser extends BaseTextParser {
    processContent(content, filename) {
        const result = {
            dsshome: this.extractDSSHOME(content),
            filesystemInfo: this.parseFilesystemInfo(content),
            memoryInfo: this.parseMemoryInfo(content),
            systemLimits: this.parseSystemLimits(content),
            cpuCores: null,
            osInfo: null,
            pythonVersion: this.parsePythonVersion(content),
            sparkSettings: { 'Spark Version': this.parseSparkVersion(content) }
        };
        
        // Parse system info
        const cpuCoresMatch = content.match(/cpu cores\s*:\s*(\d+)/);
        result.cpuCores = cpuCoresMatch ? cpuCoresMatch[1] : null;
        
        const osMatch = content.match(/>\s*cat\s+\/etc\/[a-zA-Z-]*-release\s*\n([^\n]+)/);
        result.osInfo = osMatch ? osMatch[1].trim() : null;
        
        this.log(`System info - CPU cores: ${result.cpuCores}, OS: ${result.osInfo}`);
        
        return result;
    }
    
    extractDSSHOME(content) {
        this.log("Parsing diag.txt for DIP_HOME path");
        
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('DIP_HOME=')) {
                this.log(`Found DIP_HOME line: ${line}`);
                
                let dsshome = line.substring('DIP_HOME='.length);
                dsshome = dsshome.replace(/^\//, '');
                
                if (!dsshome.endsWith('/')) {
                    dsshome += '/';
                }
                
                this.log(`Parsed DSSHOME path: ${dsshome}`);
                return dsshome;
            }
        }
        
        this.log("DIP_HOME not found in diag.txt, using default path");
        return 'data/dataiku/dss_data/';
    }
    
    parseFilesystemInfo(content) {
        const dfMatch = content.match(/>\s*df\s+-h\n([\s\S]+?)(?=\n>|\n\n|$)/);
        
        if (!dfMatch || !dfMatch[1]) {
            this.log('Could not find df -h output in diag.txt');
            return [];
        }
        
        const filesystemInfo = [];
        const lines = dfMatch[1].trim().split('\n');
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(/\s+/);
            
            if (parts.length >= 6) {
                filesystemInfo.push({
                    'Filesystem': parts[0],
                    'Size': parts[1],
                    'Used': parts[2],
                    'Available': parts[3],
                    'Use%': parts[4],
                    'Mounted on': parts.slice(5).join(' ')
                });
            }
        }
        
        this.log(`Parsed ${filesystemInfo.length} filesystem entries`);
        return filesystemInfo;
    }
    
    parseMemoryInfo(content) {
        const freeMatch = content.match(/>\s*free\s+-m\n([\s\S]+?)(?=\n>|\n\n|$)/);
        
        if (!freeMatch || !freeMatch[1]) {
            this.log('Could not find free -m output in diag.txt');
            return {};
        }
        
        const memoryInfo = {};
        const lines = freeMatch[1].trim().split('\n');
        
        if (lines.length >= 2) {
            const headers = lines[0].trim().split(/\s+/);
            const memValues = lines[1].trim().split(/\s+/);
            
            const startIndex = memValues[0] === "Mem:" ? 1 : 0;
            
            for (let i = 0; i < headers.length; i++) {
                const valueIndex = i + startIndex;
                if (valueIndex < memValues.length) {
                    const mbValue = parseInt(memValues[valueIndex]);
                    if (!isNaN(mbValue)) {
                        if (mbValue >= 1024) {
                            const gbValue = Math.round(mbValue / 1024);
                            memoryInfo[headers[i]] = `${gbValue} GB`;
                        } else {
                            memoryInfo[headers[i]] = `${mbValue.toLocaleString()} MB`;
                        }
                    }
                }
            }
        }
        
        // Process swap line if available
        if (lines.length >= 3) {
            const swapValues = lines[2].trim().split(/\s+/);
            
            if (swapValues.length > 1 && parseInt(swapValues[1]) > 0) {
                const swapTotal = parseInt(swapValues[1]);
                const swapUsed = parseInt(swapValues[2]);
                const swapFree = parseInt(swapValues[3]);
                
                memoryInfo['Swap total'] = swapTotal >= 1024 ? 
                    `${(swapTotal / 1024).toFixed(2)} GB` : 
                    `${swapTotal.toLocaleString()} MB`;
                    
                memoryInfo['Swap used'] = swapUsed >= 1024 ? 
                    `${(swapUsed / 1024).toFixed(2)} GB` : 
                    `${swapUsed.toLocaleString()} MB`;
                    
                memoryInfo['Swap free'] = swapFree >= 1024 ? 
                    `${(swapFree / 1024).toFixed(2)} GB` : 
                    `${swapFree.toLocaleString()} MB`;
            } else {
                memoryInfo['Swap'] = 'Not configured';
            }
        }
        
        // Reorder keys for logical display
        const orderedMemoryInfo = {};
        const order = ['total', 'used', 'free', 'available', 'shared', 'buff/cache', 'Swap', 'Swap total', 'Swap used', 'Swap free'];
        
        for (const key of order) {
            if (key in memoryInfo) {
                orderedMemoryInfo[key] = memoryInfo[key];
            }
        }
        
        for (const key in memoryInfo) {
            if (!order.includes(key)) {
                orderedMemoryInfo[key] = memoryInfo[key];
            }
        }
        
        this.log('Parsed memory information');
        return orderedMemoryInfo;
    }
    
    parseSystemLimits(content) {
        const ulimitMatch = content.match(/>\s*ulimit\s+-a\n([\s\S]+?)(?=\n>|\n\n|$)/);
        
        if (!ulimitMatch || !ulimitMatch[1]) {
            this.log('Could not find ulimit -a output in diag.txt');
            return {};
        }
        
        const systemLimits = {};
        const lines = ulimitMatch[1].trim().split('\n');
        
        const priorityLimits = [
            'open files',
            'max user processes',
            'max memory size',
            'stack size',
            'max locked memory',
            'pending signals'
        ];
        
        const tempLimits = {};
        for (const line of lines) {
            const match = line.match(/^([^(]+)\s+\(([^)]+)\)\s+(.+)$/);
            if (match) {
                const name = match[1].trim();
                const details = match[2].trim();
                let value = match[3].trim();
                
                if (value === 'unlimited') {
                    tempLimits[name] = 'Unlimited';
                    continue;
                }
                
                if (!isNaN(parseInt(value))) {
                    const numValue = parseInt(value);
                    value = numValue.toLocaleString();
                    
                    if (details.includes('kbytes')) {
                        if (numValue >= 1024) {
                            value = (numValue / 1024).toFixed(2) + ' MB';
                        } else {
                            value = value + ' KB';
                        }
                    } else if (details.includes('bytes')) {
                        if (numValue >= 1024 * 1024) {
                            value = (numValue / (1024 * 1024)).toFixed(2) + ' MB';
                        } else if (numValue >= 1024) {
                            value = (numValue / 1024).toFixed(2) + ' KB';
                        } else {
                            value = value + ' bytes';
                        }
                    }
                }
                
                tempLimits[name] = value;
            }
        }
        
        // Add priority limits first
        for (const limit of priorityLimits) {
            if (tempLimits[limit]) {
                systemLimits[limit] = tempLimits[limit];
                delete tempLimits[limit];
            }
        }
        
        Object.assign(systemLimits, tempLimits);
        
        this.log(`Parsed ${Object.keys(systemLimits).length} system limits`);
        return systemLimits;
    }
    
    parsePythonVersion(content) {
        const pythonMatch = content.match(/Python\s+([\d\.]+)|python.*?version\s+([\d\.]+)|>\s*\/.*?python\s+-V\n([^\n]+)/i);
        const version = pythonMatch ? (pythonMatch[1] || pythonMatch[2] || pythonMatch[3]).trim() : 'Unknown';
        this.log(`Python version: ${version}`);
        return version;
    }
    
    parseSparkVersion(content) {
        const sparkVersionMatch = content.match(/DKU_SPARK_VERSION=([^\s\n]+)/);
        
        if (sparkVersionMatch && sparkVersionMatch[1]) {
            const sparkVersion = sparkVersionMatch[1];
            this.log(`Found Spark version: ${sparkVersion}`);
            return sparkVersion;
        } else {
            this.log('Could not find Spark version in diag.txt');
            return null;
        }
    }
}

class LogParser extends BaseTextParser {
    constructor() {
        super();
        this.LINES_BEFORE = 10;
        this.LINES_AFTER = 100;
        this.TIME_THRESHOLD_SECONDS = 5;
        this.MAX_ERRORS = 5;
    }
    
    processContent(content, filename) {
        const LOG_LEVELS = [
            '\\[ERROR\\]',
            '\\[FATAL\\]',
            '\\[SEVERE\\]'
        ];
        
        const logLevelRegex = new RegExp(`(${LOG_LEVELS.join('|')})`);
        const timestampRegex = /\[(\d{4}\/\d{2}\/\d{2}-\d{2}:\d{2}:\d{2}\.\d{3})\]/;
        
        this.log('Starting to parse log file');
        this.log(`Context: ${this.LINES_BEFORE} lines before and ${this.LINES_AFTER} lines after each error`);
        this.log(`Time threshold: ${this.TIME_THRESHOLD_SECONDS} seconds between errors`);
        this.log(`Filtering for log levels: ${LOG_LEVELS.join(', ')}`);
        this.log(`Keeping only the last ${this.MAX_ERRORS} errors`);
        
        const lines = content.split('\n');
        let lineCount = 0;
        let errorCount = 0;
        const recentErrors = [];
        const errorSignatures = new Set();
        const beforeBuffer = [];
        let collectingAfter = 0;
        let afterBuffer = [];
        let currentErrorData = [];
        let lastErrorTimestamp = null;
        let errorLine = 0;
        let errorTimestampStr = '';
        
        for (const line of lines) {
            lineCount++;
            
            if (collectingAfter > 0) {
                afterBuffer.push(line);
                collectingAfter--;
                
                if (collectingAfter === 0) {
                    const equalsSigns = '='.repeat(40);
                    const errorHeader = `\n${equalsSigns}\nERROR FOUND AT LINE ${errorLine} (TIMESTAMP: ${errorTimestampStr}):\n${equalsSigns}\n\n\n\n`;
                    
                    currentErrorData = [errorHeader, ...beforeBuffer, ...afterBuffer];
                    
                    recentErrors.push({
                        timestamp: errorTimestampStr,
                        data: currentErrorData
                    });
                    
                    if (recentErrors.length > this.MAX_ERRORS) {
                        recentErrors.shift();
                    }
                    
                    afterBuffer = [];
                    currentErrorData = [];
                    beforeBuffer.length = 0;
                    continue;
                }
            }
            
            beforeBuffer.push(line);
            if (beforeBuffer.length > this.LINES_BEFORE) {
                beforeBuffer.shift();
            }
            
            const isError = logLevelRegex.test(line);
            if (isError) {
                const currentTimestamp = this.parseTimestamp(line);
                
                if (currentTimestamp === null) {
                    continue;
                }
                
                const date = new Date(currentTimestamp * 1000);
                const timestampStr = date.toISOString().replace('T', '-').substring(0, 19);
                
                const errorSignature = line.length > 60 ? line.slice(-60).trim() : line.trim();
                
                if (errorSignatures.has(errorSignature)) {
                    errorSignatures.delete(errorSignature);
                }
                
                if (lastErrorTimestamp !== null) {
                    const timeDiff = currentTimestamp - lastErrorTimestamp;
                    if (timeDiff < this.TIME_THRESHOLD_SECONDS) {
                        if (collectingAfter > 0) {
                            collectingAfter = Math.max(collectingAfter, this.LINES_AFTER);
                            afterBuffer.push(line);
                            collectingAfter--;
                        }
                        continue;
                    }
                }
                
                errorCount++;
                errorLine = lineCount;
                errorTimestampStr = timestampStr;
                lastErrorTimestamp = currentTimestamp;
                
                errorSignatures.add(errorSignature);
                
                collectingAfter = this.LINES_AFTER;
                afterBuffer = [line];
                collectingAfter--;
            }
        }
        
        if (collectingAfter > 0) {
            const equalsSigns = '='.repeat(40);
            const errorHeader = `\n${equalsSigns}\nERROR FOUND AT LINE ${errorLine} (TIMESTAMP: ${errorTimestampStr}):\n${equalsSigns}\n\n\n\n`;
            currentErrorData = [errorHeader, ...beforeBuffer, ...afterBuffer];
            
            recentErrors.push({
                timestamp: errorTimestampStr,
                data: currentErrorData
            });
            
            if (recentErrors.length > this.MAX_ERRORS) {
                recentErrors.shift();
            }
        }
        
        this.log(`Processing complete: Processed ${lineCount} lines, found ${errorCount} unique errors`);
        this.log(`Kept ${recentErrors.length} most recent errors`);
        
        return {
            formattedLogErrors: this.formatLogErrors(recentErrors),
            rawLogErrors: recentErrors,
            logStats: {
                'Total Lines': lineCount,
                'Unique Errors': errorCount,
                'Displayed Errors': recentErrors.length
            }
        };
    }
    
    parseTimestamp(line) {
        const timestampRegex = /\[(\d{4}\/\d{2}\/\d{2}-\d{2}:\d{2}:\d{2}\.\d{3})\]/;
        const match = timestampRegex.exec(line);
        if (!match) return null;
        
        const timestampStr = match[1];
        try {
            const year = parseInt(timestampStr.substring(0, 4));
            const month = parseInt(timestampStr.substring(5, 7)) - 1;
            const day = parseInt(timestampStr.substring(8, 10));
            const hour = parseInt(timestampStr.substring(11, 13));
            const minute = parseInt(timestampStr.substring(14, 16));
            const second = parseInt(timestampStr.substring(17, 19));
            const millisecond = parseInt(timestampStr.substring(20, 23));
            
            const dt = new Date(year, month, day, hour, minute, second, millisecond);
            return dt.getTime() / 1000;
        } catch (e) {
            this.log(`Error parsing timestamp '${timestampStr}': ${e}`);
            return null;
        }
    }
    
    formatLogErrors(errorData) {
        if (!errorData || errorData.length === 0) {
            return "No log errors found";
        }
        
        let formattedOutput = '';
        
        for (const error of errorData) {
            formattedOutput += `<div class="log-error-block">`;
            
            for (const line of error.data) {
                if (line.includes('ERROR FOUND AT LINE')) {
                    const modifiedLine = line.replace(/={40,}/g, '='.repeat(20));
                    const headerParts = modifiedLine.split('\n');
                    let formattedHeader = '';
                    
                    for (let i = 0; i < headerParts.length; i++) {
                        if (headerParts[i].trim() === '') {
                            formattedHeader += '<br>';
                        } else {
                            formattedHeader += headerParts[i] + '<br>';
                        }
                    }
                    
                    formattedHeader += '<br>';
                    formattedOutput += `<div class="log-entry log-header">${formattedHeader}</div>`;
                    continue;
                }
                
                let className = 'log-entry';
                if (line.includes('[INFO]')) {
                    className += ' log-info';
                } else if (line.includes('[WARN]')) {
                    className += ' log-warn';
                } else if (line.includes('[ERROR]')) {
                    className += ' log-error';
                } else if (line.includes('[FATAL]')) {
                    className += ' log-fatal';
                } else if (line.includes('[SEVERE]')) {
                    className += ' log-severe';
                } else if (line.includes('[DEBUG]')) {
                    className += ' log-debug';
                } else if (line.includes('[TRACE]')) {
                    className += ' log-trace';
                }
                
                let formattedLine = line;
                const timestampMatch = line.match(/\[(\d{4}\/\d{2}\/\d{2}-\d{2}:\d{2}:\d{2}\.\d{3})\]/);
                if (timestampMatch) {
                    formattedLine = line.replace(
                        timestampMatch[0],
                        `<span class="log-timestamp">${timestampMatch[0]}</span>`
                    );
                }
                
                const logLevelMatch = formattedLine.match(/\[(INFO|WARN|ERROR|FATAL|SEVERE|DEBUG|TRACE)\]/);
                if (logLevelMatch) {
                    formattedLine = formattedLine.replace(
                        logLevelMatch[0],
                        `<span class="log-level">${logLevelMatch[0]}</span>`
                    );
                }
                
                // Apply syntax highlighting patterns
                formattedLine = formattedLine.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<span class="hljs-number">$&</span>');
                formattedLine = formattedLine.replace(/\[ct: \d+\]/g, '<span class="hljs-number">$&</span>');
                formattedLine = formattedLine.replace(/\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9.\/-]+:[a-z0-9.\/-]+/g, '<span class="hljs-string">$&</span>');
                formattedLine = formattedLine.replace(/\b(pod|deployment|service|node|configmap|secret|namespace|replicaset|daemonset)s?\b/gi, '<span class="hljs-title">$&</span>');
                formattedLine = formattedLine.replace(/Process [a-z]+ done \(return code \d+\)|Running [a-z]+ \([^)]+\)/g, '<span class="hljs-comment">$&</span>');
                
                formattedOutput += `<div class="${className}">${formattedLine}</div>`;
            }
            
            formattedOutput += `</div>`;
        }
        
        return formattedOutput;
    }
}

class SupervisordLogParser extends BaseTextParser {
    processContent(content, filename) {
        this.log('Parsing DSS last restart time from supervisord.log');
        
        const lines = content.split('\n');
        let lastRestartLine = null;
        
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].includes('success: backend entered RUNNING state')) {
                lastRestartLine = lines[i];
                break;
            }
        }
        
        if (lastRestartLine) {
            const timestampMatch = lastRestartLine.match(/^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2},\d{3})/);
            if (timestampMatch && timestampMatch[1]) {
                const timestampStr = timestampMatch[1];
                try {
                    const dateStr = timestampStr.replace(',', '.');
                    const restartDate = new Date(dateStr);
                    
                    const options = { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: true
                    };
                    
                    const formattedTime = restartDate.toLocaleDateString('en-US', options);
                    this.log(`Found last restart time: ${formattedTime}`);
                    
                    return { lastRestartTime: formattedTime };
                } catch (e) {
                    this.log(`Error parsing timestamp '${timestampStr}': ${e}`);
                }
            }
        } else {
            this.log('Could not find DSS restart information in supervisord.log');
        }
        
        return {};
    }
}

class EnvScriptParser extends BaseTextParser {
    processContent(content, filename) {
        this.log(`Parsing ${filename} file`);
        
        const result = {
            javaMemorySettings: {
                'DKUJAVABIN': '',
                'BACKEND': '',
                'FEK': '',
                'JEK': ''
            }
        };
        
        const lines = content.split('\n');
        
        const javaBinRegex = /^export\s+DKUJAVABIN="([^"]+)"/;
        const backendRegex = /^export\s+DKU_BACKEND_JAVA_OPTS="([^"]+)"/;
        const fekRegex = /^export\s+DKU_FEK_JAVA_OPTS="([^"]+)"/;
        const jekRegex = /^export\s+DKU_JEK_JAVA_OPTS="([^"]+)"/;
        const xmxRegex = /-Xmx(\d+[gmk])/i;
        const installDirRegex = /^export\s+DKUINSTALLDIR=".*dataiku-dss-([0-9.]+)"/;
        
        for (const line of lines) {
            if (line.trim().startsWith('#') || !line.trim()) {
                continue;
            }
            
            // Extract DSS version if not already set
            const installDirMatch = line.match(installDirRegex);
            if (installDirMatch && installDirMatch[1]) {
                result.dssVersion = installDirMatch[1];
                this.log(`Extracted DSS version from ${filename}: ${installDirMatch[1]}`);
            }
            
            const javaBinMatch = line.match(javaBinRegex);
            if (javaBinMatch && javaBinMatch[1]) {
                result.javaMemorySettings['DKUJAVABIN'] = javaBinMatch[1];
                continue;
            }
            
            const backendMatch = line.match(backendRegex);
            if (backendMatch && backendMatch[1]) {
                const xmxMatch = backendMatch[1].match(xmxRegex);
                if (xmxMatch && xmxMatch[1]) {
                    result.javaMemorySettings['BACKEND'] = xmxMatch[1];
                }
                continue;
            }
            
            const fekMatch = line.match(fekRegex);
            if (fekMatch && fekMatch[1]) {
                const xmxMatch = fekMatch[1].match(xmxRegex);
                if (xmxMatch && xmxMatch[1]) {
                    result.javaMemorySettings['FEK'] = xmxMatch[1];
                }
                continue;
            }
            
            const jekMatch = line.match(jekRegex);
            if (jekMatch && jekMatch[1]) {
                const xmxMatch = jekMatch[1].match(xmxRegex);
                if (xmxMatch && xmxMatch[1]) {
                    result.javaMemorySettings['JEK'] = xmxMatch[1];
                }
                continue;
            }
        }
        
        this.log(`Finished parsing ${filename} file`);
        return result;
    }
}

// UI Component classes
class TableRenderer {
    constructor(container) {
        this.container = container;
        this.tableContainers = {};
    }
    
    createTable(id, title, data, filtersContainer) {
        if (!data || Object.keys(data).length === 0) {
            return;
        }
        
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        tableContainer.id = id + '-table';
        
        const titleEl = document.createElement('h4');
        titleEl.className = 'table-title';
        titleEl.textContent = title;
        tableContainer.appendChild(titleEl);
        
        const table = document.createElement('table');
        table.className = 'table';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const header1 = document.createElement('th');
        const header2 = document.createElement('th');
        
        if (id === 'enabledSettings') {
            header1.textContent = 'Setting';
            header2.textContent = 'Enabled';
        } else {
            header1.textContent = 'Name';
            header2.textContent = 'Value';
        }
        
        headerRow.appendChild(header1);
        headerRow.appendChild(header2);
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        
        let entries = Object.entries(data);
        
        // Special sorting for different table types
        if (id === 'sparkSettings' && data['Spark Version']) {
            entries = entries.filter(([key, _]) => key !== 'Spark Version');
            entries.unshift(['Spark Version', data['Spark Version']]);
        } else if (id === 'connections' || id === 'pythonVersionCounts' || id === 'userStats' || 
            entries.some(([_, value]) => !isNaN(parseInt(value)))) {
            
            entries.sort((a, b) => {
                const valA = !isNaN(parseInt(a[1])) ? parseInt(a[1]) : a[1];
                const valB = !isNaN(parseInt(b[1])) ? parseInt(b[1]) : b[1];
                
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return valB - valA;
                }
                
                return String(b[1]).localeCompare(String(a[1]));
            });
        }
        
        for (const [key, value] of entries) {
            if (key.includes('Explore') && key.includes('memory')) {
                continue;
            }
            
            const row = document.createElement('tr');
            const keyCell = document.createElement('td');
            const valCell = document.createElement('td');
            
            let formattedKey = formatKey(key);
            keyCell.innerHTML = `<strong>${formattedKey}</strong>`;
            
            if (id === 'enabledSettings') {
                const enabled = value === 'true';
                valCell.textContent = enabled ? 'Yes' : 'No';
            } else if (typeof value === 'object' && value !== null && value.truncate === true) {
                valCell.style.position = 'relative';
                
                const truncatedText = value.value.length > value.maxLength ? 
                    value.value.substring(0, value.maxLength) + '...' : 
                    value.value;
                
                valCell.textContent = truncatedText;
                valCell.title = value.value;
                valCell.style.cursor = 'help';
                valCell.style.borderBottom = '1px dotted #ccc';
            } else {
                valCell.textContent = value;
                
                // Apply conditional styling
                this.applyConditionalStyling(valCell, key, value, id);
            }
            
            row.appendChild(keyCell);
            row.appendChild(valCell);
            tbody.appendChild(row);
        }
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        
        this.tableContainers[id + '-table'] = tableContainer;
        
        // Add filter button
        this.addFilterButton(title, id + '-table', filtersContainer);
        
        return tableContainer;
    }
    
    applyConditionalStyling(cell, key, value, tableId) {
        // Python version coloring
        if (tableId === 'pythonVersionCounts' || key === 'Python Version') {
            let pythonVersion = value;
            if (typeof pythonVersion === 'string') {
                const versionMatch = pythonVersion.match(/(\d+\.\d+)/);
                if (versionMatch) {
                    const versionNum = parseFloat(versionMatch[1]);
                    if (versionNum < 3.6) {
                        cell.style.color = '#ff3b30';
                        cell.style.fontWeight = 'bold';
                    } else if (versionNum < 3.9) {
                        cell.style.color = '#ff9500';
                        cell.style.fontWeight = 'bold';
                    }
                }
            }
        }
        
        // Spark version coloring
        if (key === 'Spark Version') {
            let sparkVersion = value;
            if (typeof sparkVersion === 'string') {
                const versionMatch = sparkVersion.match(/^(\d+)/);
                if (versionMatch) {
                    const majorVersion = parseInt(versionMatch[1]);
                    if (majorVersion < 3) {
                        cell.style.color = '#ff3b30';
                        cell.style.fontWeight = 'bold';
                    }
                }
            }
        }
        
        // Impersonation coloring
        if (key === 'Impersonation' && value === 'Disabled') {
            cell.style.color = '#ff3b30';
            cell.style.fontWeight = 'bold';
        }
        
        // Default Container Execution Config coloring
        if (key === 'Default Execution Config' && value === 'Not set') {
            cell.style.color = '#ff9500';
            cell.style.fontWeight = 'bold';
        }
        
        // CGroups enabled coloring
        if ((key === 'CGroups Enabled' || key === 'Enabled') && 
            (value === 'No' || value === 'false') && 
            tableId === 'cgroupSettings') {
            cell.style.color = '#ff3b30';
            cell.style.fontWeight = 'bold';
        }
        
        // CGroups Target Types coloring
        if (key === 'Empty Target Types' && tableId === 'cgroupSettings') {
            const numTargets = parseInt(value);
            if (numTargets !== 0) {
                cell.style.color = '#ff3b30';
                cell.style.fontWeight = 'bold';
            }
        }
    }
    
    createProjectsTable(projects, filtersContainer) {
        if (!projects || projects.length === 0) return null;
        
        const projectsItem = document.createElement('div');
        projectsItem.className = 'grid-item wide';
        projectsItem.id = 'projects-table';
        
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'Projects';
        tableContainer.appendChild(title);
        
        // Add search box
        const searchBox = document.createElement('input');
        searchBox.type = 'text';
        searchBox.className = 'search-box';
        searchBox.placeholder = 'Search projects...';
        searchBox.style.marginBottom = '15px';
        tableContainer.appendChild(searchBox);
        
        // Sort projects by versionNumber in descending order
        const sortedProjects = [...projects].sort((a, b) => 
            (b.versionNumber || 0) - (a.versionNumber || 0)
        );
        
        // Track if we're showing all projects or just the top 10
        let showAllProjects = false;
        
        // Add "View All Projects" button if there are more than 10 projects
        let viewAllBtn = null;
        if (sortedProjects.length > 10) {
            viewAllBtn = document.createElement('button');
            viewAllBtn.className = 'display-log-btn';
            viewAllBtn.style.marginBottom = '15px';
            viewAllBtn.style.backgroundColor = 'var(--dataiku-primary)';
            viewAllBtn.textContent = `View All Projects (${sortedProjects.length})`;
            tableContainer.appendChild(viewAllBtn);
        }
        
        const table = document.createElement('table');
        table.className = 'table';
        table.style.tableLayout = 'auto';
        
        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const headers = ['Project Name', 'Version', 'Perms'];
        
        for (const header of headers) {
            const th = document.createElement('th');
            th.textContent = header;
            
            if (header === 'Version' || header === 'Perms') {
                th.style.width = 'min-content';
                th.style.whiteSpace = 'nowrap';
                th.style.padding = '12px 10px';
            } else if (header === 'Project Name') {
                th.style.width = '70%';
                th.style.minWidth = '300px';
            }
            
            headerRow.appendChild(th);
        }
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create table body
        const tbody = document.createElement('tbody');
        
        // Function to render project rows
        const renderProjects = () => {
            tbody.innerHTML = '';
            
            const projectsToShow = showAllProjects ? 
                sortedProjects : 
                sortedProjects.slice(0, 10);
            
            for (const project of projectsToShow) {
                const row = document.createElement('tr');
                
                // Project Name (clickable)
                const nameCell = document.createElement('td');
                nameCell.style.wordBreak = 'break-word';
                nameCell.style.maxWidth = '400px';
                const nameLink = document.createElement('a');
                nameLink.href = '#';
                nameLink.textContent = project.name;
                nameLink.style.color = 'var(--dataiku-primary)';
                nameLink.style.textDecoration = 'none';
                nameLink.style.fontWeight = '500';
                nameLink.style.cursor = 'pointer';
                
                nameLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showProjectPermissions(project);
                });
                
                nameCell.appendChild(nameLink);
                row.appendChild(nameCell);
                
                // Version Number
                const versionCell = document.createElement('td');
                versionCell.style.whiteSpace = 'nowrap';
                versionCell.textContent = project.versionNumber || 0;
                row.appendChild(versionCell);
                
                // Permissions Count
                const permissionsCell = document.createElement('td');
                permissionsCell.style.whiteSpace = 'nowrap';
                permissionsCell.textContent = `${project.permissions.length} entries`;
                row.appendChild(permissionsCell);
                
                tbody.appendChild(row);
            }
        };
        
        // Set up view all button functionality
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                showAllProjects = !showAllProjects;
                renderProjects();
                viewAllBtn.textContent = showAllProjects ? 
                    'Show Top 10 Projects Only' : 
                    `View All Projects (${sortedProjects.length})`;
            });
        }
        
        // Initial render
        renderProjects();
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        
        // Add search functionality
        searchBox.addEventListener('input', function() {
            const searchText = this.value.toLowerCase();
            const rows = tbody.querySelectorAll('tr');
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                if (text.includes(searchText)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
        
        projectsItem.appendChild(tableContainer);
        
        this.tableContainers['projects-table'] = projectsItem;
        this.addFilterButton('Projects', 'projects-table', filtersContainer);
        
        return projectsItem;
    }
    
    showProjectPermissions(project) {
        // Create modal container if it doesn't exist
        let permissionsModal = document.getElementById('permissions-modal');
        
        if (!permissionsModal) {
            permissionsModal = document.createElement('div');
            permissionsModal.id = 'permissions-modal';
            permissionsModal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0,0,0,0.8); z-index: 1000; display: flex;
                justify-content: center; align-items: center; padding: 20px;
            `;
            document.body.appendChild(permissionsModal);
        } else {
            permissionsModal.innerHTML = '';
            permissionsModal.style.display = 'flex';
        }
        
        // Create content container
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background-color: #fff; border-radius: 10px; width: 90%;
            max-width: 800px; max-height: 90%; display: flex;
            flex-direction: column; overflow: hidden;
            box-shadow: 0 5px 30px rgba(0,0,0,0.3);
        `;
        
        // Create header
        const modalHeader = document.createElement('div');
        modalHeader.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 15px 20px; border-bottom: 1px solid #eee;
        `;
        
        const projectTitle = document.createElement('h3');
        projectTitle.textContent = `Project: ${project.name}`;
        projectTitle.style.cssText = 'margin: 0; padding: 0; font-weight: 500;';
        
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;';
        closeButton.style.cssText = `
            background: none; border: none; font-size: 24px;
            cursor: pointer; padding: 0 10px; font-weight: bold;
        `;
        closeButton.onclick = () => permissionsModal.style.display = 'none';
        
        modalHeader.appendChild(projectTitle);
        modalHeader.appendChild(closeButton);
        
        // Create content area
        const contentArea = document.createElement('div');
        contentArea.style.cssText = 'overflow: auto; padding: 20px; flex-grow: 1;';
        
        // Add project details
        const projectDetails = document.createElement('div');
        projectDetails.style.cssText = `
            margin-bottom: 20px; padding: 15px;
            background-color: rgba(0, 181, 170, 0.05);
            border-radius: 8px;
        `;
        
        projectDetails.innerHTML = `
            <div><strong>Project Key:</strong> ${project.key}</div>
            <div><strong>Owner:</strong> ${project.owner}</div>
            <div><strong>Permission Entries:</strong> ${project.permissions.length}</div>
        `;
        
        contentArea.appendChild(projectDetails);
        
        // Group permissions by type
        const groupedPermissions = {
            'Group': [],
            'User': []
        };
        
        for (const perm of project.permissions) {
            if (groupedPermissions[perm.type]) {
                groupedPermissions[perm.type].push(perm);
            } else {
                groupedPermissions[perm.type] = [perm];
            }
        }
        
        // Create sections for each permission type
        for (const [type, perms] of Object.entries(groupedPermissions)) {
            if (perms.length === 0) continue;
            
            const typeHeading = document.createElement('h4');
            typeHeading.textContent = `${type} Permissions (${perms.length})`;
            typeHeading.style.cssText = `
                margin-top: 20px; margin-bottom: 10px; padding-bottom: 5px;
                border-bottom: 1px solid #eee;
            `;
            contentArea.appendChild(typeHeading);
            
            for (const perm of perms) {
                const permDiv = document.createElement('div');
                permDiv.style.cssText = `
                    margin-bottom: 15px; padding: 10px 15px;
                    background-color: #f8f9fa; border-radius: 8px;
                    border: 1px solid #e9ecef;
                `;
                
                const nameHeading = document.createElement('div');
                nameHeading.textContent = perm.name;
                nameHeading.style.cssText = `
                    font-weight: bold; padding: 5px 0; margin-bottom: 10px;
                    border-bottom: 1px dashed #e9ecef;
                `;
                permDiv.appendChild(nameHeading);
                
                const permList = document.createElement('div');
                permList.style.cssText = `
                    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 5px 15px;
                `;
                
                for (const [key, value] of Object.entries(perm.permissions)) {
                    const permItem = document.createElement('div');
                    permItem.style.cssText = 'display: flex; align-items: center;';
                    
                    const formattedKey = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, str => str.toUpperCase());
                    
                    const checkmark = value === true ? '✓' : '✗';
                    const color = value === true ? '#34c759' : '#8e8e93';
                    
                    permItem.innerHTML = `
                        <span style="color: ${color}; font-weight: bold; margin-right: 5px;">
                            ${checkmark}
                        </span>
                        <span>${formattedKey}</span>
                    `;
                    
                    permList.appendChild(permItem);
                }
                
                permDiv.appendChild(permList);
                contentArea.appendChild(permDiv);
            }
        }
        
        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(contentArea);
        permissionsModal.appendChild(modalContent);
        
        // Event listeners
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                permissionsModal.style.display = 'none';
            }
        });
        
        permissionsModal.addEventListener('click', function(e) {
            if (e.target === permissionsModal) {
                permissionsModal.style.display = 'none';
            }
        });
    }
    
    createChart(type, data, options) {
        const canvas = document.createElement('canvas');
        canvas.id = options.id || 'chart-' + Date.now();
        
        setTimeout(() => {
            const ctx = canvas.getContext('2d');
            new Chart(ctx, {
                type: type,
                data: data,
                options: options.chartOptions || {}
            });
        }, 300);
        
        return canvas;
    }
    
    createMemoryChart(memoryData, filtersContainer) {
        const memoryItem = document.createElement('div');
        memoryItem.className = 'grid-item half-width';
        memoryItem.id = 'memory-chart';
        
        const chartContainer = document.createElement('div');
        chartContainer.className = 'table-container';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'System Memory';
        chartContainer.appendChild(title);
        
        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.style.position = 'relative';
        canvasContainer.style.height = '300px';
        canvasContainer.style.width = '100%';
        canvasContainer.style.margin = '0 auto';
        
        const canvas = document.createElement('canvas');
        canvas.id = 'memory-pie-chart';
        canvasContainer.appendChild(canvas);
        chartContainer.appendChild(canvasContainer);
        
        // Extract memory data for the chart
        let totalMemory = 0;
        let usedMemory = 0;
        let freeMemory = 0;
        let buffersMemory = 0;
        
        // Parse values and convert to numbers (MB)
        for (const [key, value] of Object.entries(memoryData)) {
            const parseMemoryValue = (val) => {
                if (val.includes('GB')) {
                    return parseFloat(val) * 1024;
                } else {
                    return parseFloat(val.replace(/[^0-9.]/g, ''));
                }
            };
            
            if (key === 'total') totalMemory = parseMemoryValue(value);
            if (key === 'used') usedMemory = parseMemoryValue(value);
            if (key === 'free') freeMemory = parseMemoryValue(value);
            if (key === 'buff/cache') buffersMemory = parseMemoryValue(value);
        }
        
        // Create summary table
        const summaryTable = document.createElement('table');
        summaryTable.className = 'table';
        summaryTable.style.marginTop = '20px';
        
        const tbody = document.createElement('tbody');
        
        const addRow = (label, value, isPercent = false) => {
            const row = document.createElement('tr');
            
            const labelCell = document.createElement('td');
            labelCell.innerHTML = `<strong>${label}</strong>`;
        
            const valueCell = document.createElement('td');
            valueCell.textContent = value;
            
            if (isPercent) {
                const percent = parseFloat(value);
                if (percent > 80) {
                    valueCell.style.color = '#ff3b30';
                    valueCell.style.fontWeight = 'bold';
                } else if (percent > 70) {
                    valueCell.style.color = '#ff9500';
                    valueCell.style.fontWeight = 'bold';
                } else if (percent < 50) {
                    valueCell.style.color = '#34c759';
                }
            }
            
            row.appendChild(labelCell);
            row.appendChild(valueCell);
            tbody.appendChild(row);
        };
        
        addRow('Total Memory', memoryData.total || 'N/A');
        addRow('Used Memory', memoryData.used || 'N/A');
        addRow('Free Memory', memoryData.free || 'N/A');
        addRow('Available Memory', memoryData.available || 'N/A');
        
        if (memoryData['buff/cache']) {
            addRow('Buffers/Cache', memoryData['buff/cache']);
        }
        
        if (memoryData['Swap total'] && memoryData['Swap total'] !== 'Not configured') {
            addRow('Swap Total', memoryData['Swap total']);
            addRow('Swap Used', memoryData['Swap used']);
            addRow('Swap Free', memoryData['Swap free']);
        }
        
        summaryTable.appendChild(tbody);
        chartContainer.appendChild(summaryTable);
        
        memoryItem.appendChild(chartContainer);
        
        // Create the pie chart
        setTimeout(() => {
            const chartElement = document.getElementById('memory-pie-chart');
            if (chartElement) {
                const ctx = chartElement.getContext('2d');
                
                new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: ['Used', 'Free', 'Buffers/Cache'],
                        datasets: [{
                            data: [usedMemory, freeMemory, buffersMemory],
                            backgroundColor: [
                                'rgba(255, 59, 48, 0.7)',
                                'rgba(52, 199, 89, 0.7)',
                                'rgba(0, 122, 255, 0.7)'
                            ],
                            borderColor: [
                                'rgba(255, 59, 48, 1)',
                                'rgba(52, 199, 89, 1)',
                                'rgba(0, 122, 255, 1)'
                            ],
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.raw;
                                        const formattedValue = value >= 1024 ? 
                                            `${(value / 1024).toFixed(2)} GB` : 
                                            `${value.toLocaleString()} MB`;
                                        const percentage = Math.round((value / (usedMemory + freeMemory + buffersMemory)) * 100);
                                        return `${context.label}: ${formattedValue} (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }, 300);
        
        this.tableContainers['memory-chart'] = memoryItem;
        this.addFilterButton('System Memory', 'memory-chart', filtersContainer);
        
        return memoryItem;
    }
    
    createFilesystemChart(filesystemData, filtersContainer) {
        const filesystemItem = document.createElement('div');
        filesystemItem.className = 'grid-item wide';
        filesystemItem.id = 'filesystem-table';
        
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'Filesystem Usage (df -h)';
        tableContainer.appendChild(title);
        
        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.style.position = 'relative';
        canvasContainer.style.height = '400px';
        canvasContainer.style.width = '100%';
        canvasContainer.style.margin = '0 auto';
        
        const canvas = document.createElement('canvas');
        canvas.id = 'filesystem-bar-chart';
        canvasContainer.appendChild(canvas);
        tableContainer.appendChild(canvasContainer);
        
        if (filesystemData.length > 0) {
            // Sort by Use% (descending)
            const sortedFilesystems = [...filesystemData].sort((a, b) => {
                const useA = parseInt(a['Use%']);
                const useB = parseInt(b['Use%']);
                return useB - useA;
            });
            
            // Parse size values like "10G" or "1.5T" to GB
            const parseSize = (sizeStr) => {
                if (!sizeStr) return 0;
                
                const value = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
                if (sizeStr.includes('T')) {
                    return value * 1024;
                } else if (sizeStr.includes('G')) {
                    return value;
                } else if (sizeStr.includes('M')) {
                    return value / 1024;
                } else if (sizeStr.includes('K')) {
                    return value / (1024 * 1024);
                }
                return value;
            };
            
            // Process data for chart
            const usedSpaceData = [];
            const availableSpaceData = [];
            const filesystemNames = [];
            
            for (const filesystem of sortedFilesystems) {
                if (parseInt(filesystem['Use%']) === 0 || !filesystem['Size']) {
                    continue;
                }
                
                const sizeGB = parseSize(filesystem['Size']);
                const usedGB = parseSize(filesystem['Used']);
                const availableGB = parseSize(filesystem['Available']);
                
                if (sizeGB < 0.1) continue;
                
                usedSpaceData.push(usedGB);
                availableSpaceData.push(availableGB);
                
                const displayName = filesystem['Mounted on'] !== '' ? 
                    filesystem['Mounted on'] : 
                    filesystem['Filesystem'];
                
                filesystemNames.push(displayName);
            }
            
            // Create the chart
            setTimeout(() => {
                const chartElement = document.getElementById('filesystem-bar-chart');
                if (chartElement) {
                    const ctx = chartElement.getContext('2d');
                    
                    new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: filesystemNames,
                            datasets: [
                                {
                                    label: 'Used Space (GB)',
                                    data: usedSpaceData,
                                    backgroundColor: 'rgba(255, 59, 48, 0.7)',
                                    borderColor: 'rgba(255, 59, 48, 1)',
                                    borderWidth: 1,
                                    barPercentage: 0.8,
                                    categoryPercentage: 0.8
                                },
                                {
                                    label: 'Available Space (GB)',
                                    data: availableSpaceData,
                                    backgroundColor: 'rgba(52, 199, 89, 0.7)',
                                    borderColor: 'rgba(52, 199, 89, 1)',
                                    borderWidth: 1,
                                    barPercentage: 0.8,
                                    categoryPercentage: 0.8
                                }
                            ]
                        },
                        options: {
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                x: {
                                    stacked: true,
                                    title: {
                                        display: true,
                                        text: 'Size (GB)'
                                    }
                                },
                                y: {
                                    stacked: true,
                                    title: {
                                        display: true,
                                        text: 'Filesystem'
                                    }
                                }
                            },
                            plugins: {
                                legend: {
                                    display: true,
                                    position: 'top'
                                },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            const index = context.dataIndex;
                                            const filesystem = sortedFilesystems[index];
                                            const datasetLabel = context.dataset.label;
                                            
                                            if (datasetLabel.includes('Used')) {
                                                return [
                                                    `${datasetLabel}: ${context.raw.toFixed(2)} GB`,
                                                    `Usage: ${filesystem['Use%']}`,
                                                    `Size: ${filesystem['Size']}`
                                                ];
                                            } else {
                                                return `${datasetLabel}: ${context.raw.toFixed(2)} GB`;
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        plugins: [{
                            id: 'customBarLabels',
                            afterDatasetsDraw: function(chart) {
                                const ctx = chart.ctx;
                                
                                chart.data.datasets.forEach((dataset, datasetIndex) => {
                                    const meta = chart.getDatasetMeta(datasetIndex);
                                    if (!meta.hidden) {
                                        meta.data.forEach((bar, index) => {
                                            const value = dataset.data[index];
                                            if (value >= 1) {
                                                const position = bar.tooltipPosition();
                                                
                                                let xPos;
                                                if (datasetIndex === 0) {
                                                    xPos = Math.max(20, bar.x * 0.25); 
                                                } else {
                                                    const usedMeta = chart.getDatasetMeta(0);
                                                    const usedBar = usedMeta.data[index];
                                                    xPos = usedBar.x + ((bar.x - usedBar.x) * 0.25);
                                                }
                                                
                                                ctx.fillStyle = 'white';
                                                ctx.font = 'bold 12px Arial';
                                                ctx.textAlign = 'center';
                                                ctx.textBaseline = 'middle';
                                                
                                                const displayValue = value.toFixed(1) + ' GB';
                                                if (bar.width > 50) {
                                                    ctx.fillText(displayValue, xPos, position.y);
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                        }]
                    });
                }
            }, 300);
        }
        
        filesystemItem.appendChild(tableContainer);
        
        this.tableContainers['filesystem-table'] = filesystemItem;
        this.addFilterButton('Filesystem Usage', 'filesystem-table', filtersContainer);
        
        return filesystemItem;
    }
    
    createConnectionsChart(connectionsData, filtersContainer) {
        const connectionsItem = document.createElement('div');
        connectionsItem.className = 'grid-item';
        connectionsItem.id = 'connections-chart';
        
        const chartContainer = document.createElement('div');
        chartContainer.className = 'table-container';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'Connection Types';
        chartContainer.appendChild(title);
        
        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.style.position = 'relative';
        canvasContainer.style.height = '300px';
        canvasContainer.style.width = '100%';
        canvasContainer.style.margin = '0 auto';
        
        const canvas = document.createElement('canvas');
        canvas.id = 'connections-pie-chart';
        canvasContainer.appendChild(canvas);
        chartContainer.appendChild(canvasContainer);
        
        // Extract data for the chart
        const backgroundColors = [
            'rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)', 'rgba(255, 206, 86, 0.7)',
            'rgba(75, 192, 192, 0.7)', 'rgba(153, 102, 255, 0.7)', 'rgba(255, 159, 64, 0.7)',
            'rgba(0, 181, 204, 0.7)', 'rgba(101, 143, 241, 0.7)', 'rgba(220, 53, 69, 0.7)',
            'rgba(40, 167, 69, 0.7)'
        ];
        const borderColors = [
            'rgba(255, 99, 132, 1)', 'rgba(54, 162, 235, 1)', 'rgba(255, 206, 86, 1)',
            'rgba(75, 192, 192, 1)', 'rgba(153, 102, 255, 1)', 'rgba(255, 159, 64, 1)',
            'rgba(0, 181, 204, 1)', 'rgba(101, 143, 241, 1)', 'rgba(220, 53, 69, 1)',
            'rgba(40, 167, 69, 1)'
        ];
        
        // Sort connections by count (descending)
        const sortedConnections = Object.entries(connectionsData)
            .sort((a, b) => b[1] - a[1]);
        
        const labels = [];
        const data = [];
        let totalConnections = 0;
        
        for (const [type, count] of sortedConnections) {
            totalConnections += count;
        }
        
        title.textContent = `Connection Types (${sortedConnections.length} total)`;
        
        for (const [type, count] of sortedConnections) {
            labels.push(type.length > 16 ? type.substring(0, 16) + '...' : type);
            data.push(count);
        }
        
        // Create summary table
        const summaryTable = document.createElement('table');
        summaryTable.className = 'table';
        summaryTable.style.marginTop = '20px';
        
        const tbody = document.createElement('tbody');
        
        for (const [type, count] of sortedConnections) {
            const row = document.createElement('tr');
            const typeCell = document.createElement('td');
            typeCell.innerHTML = `<strong>${type}</strong>`;
            
            const countCell = document.createElement('td');
            countCell.textContent = count;
            
            const percentCell = document.createElement('td');
            const percent = Math.round((count / totalConnections) * 100);
            percentCell.textContent = `${percent}%`;
            
            row.appendChild(typeCell);
            row.appendChild(countCell);
            row.appendChild(percentCell);
            tbody.appendChild(row);
        }
        
        summaryTable.appendChild(tbody);
        chartContainer.appendChild(summaryTable);
        
        connectionsItem.appendChild(chartContainer);
        
        // Create the pie chart
        setTimeout(() => {
            const chartElement = document.getElementById('connections-pie-chart');
            if (chartElement) {
                const ctx = chartElement.getContext('2d');
                
                new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: backgroundColors.slice(0, data.length),
                            borderColor: borderColors.slice(0, data.length),
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    font: {
                                        size: 12
                                    }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.raw;
                                        const percentage = Math.round((value / totalConnections) * 100);
                                        const fullName = sortedConnections[context.dataIndex][0];
                                        return `${fullName}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }, 300);
        
    createPluginsCodeEnvsTables(grid, filtersContainer, parsedData) {
        // Create plugins table
        if (parsedData.plugins && parsedData.plugins.length > 0) {
            const pluginsItem = document.createElement('div');
            pluginsItem.className = 'grid-item';
            
            const pluginsTable = this.createPluginsTable(pluginsItem, filtersContainer, parsedData);
            grid.appendChild(pluginsItem);
        }
        
        // Create code envs table
        if (parsedData.codeEnvs && parsedData.codeEnvs.length > 0) {
            const codeEnvItem = document.createElement('div');
            codeEnvItem.className = 'grid-item';
            
            const codeEnvsTable = this.createCodeEnvsTable(codeEnvItem, filtersContainer, parsedData);
            grid.appendChild(codeEnvItem);
        }
    }
    
    createPluginsTable(container, filtersContainer, parsedData) {
        const pluginsTable = document.createElement('div');
        pluginsTable.className = 'table-container';
        pluginsTable.id = 'plugins-table';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'Installed Plugins';
        pluginsTable.appendChild(title);
        
        const table = document.createElement('table');
        table.className = 'table';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const header1 = document.createElement('th');
        header1.textContent = 'Type';
        const header2 = document.createElement('th');
        header2.textContent = 'Count';
        headerRow.appendChild(header1);
        headerRow.appendChild(header2);
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        const row = document.createElement('tr');
        
        const typeCell = document.createElement('td');
        typeCell.textContent = 'Total Plugins';
        
        const countCell = document.createElement('td');
        countCell.textContent = parsedData.pluginsCount || 0;
        
        row.appendChild(typeCell);
        row.appendChild(countCell);
        tbody.appendChild(row);
        table.appendChild(tbody);
        
        pluginsTable.appendChild(table);
        container.appendChild(pluginsTable);
        
        this.tableContainers['plugins-table'] = pluginsTable;
        this.addFilterButton('Plugins', 'plugins-table', filtersContainer);
        
        return pluginsTable;
    }
    
    createCodeEnvsTable(container, filtersContainer, parsedData) {
        const codeEnvsTable = document.createElement('div');
        codeEnvsTable.className = 'table-container';
        codeEnvsTable.id = 'code-envs-table';
        
        const title = document.createElement('h4');
        title.className = 'table-title';
        title.textContent = 'Code Environments';
        codeEnvsTable.appendChild(title);
        
        const table = document.createElement('table');
        table.className = 'table';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const header1 = document.createElement('th');
        header1.textContent = 'Python Version';
        const header2 = document.createElement('th');
        header2.textContent = 'Count';
        headerRow.appendChild(header1);
        headerRow.appendChild(header2);
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        if (parsedData.pythonVersionCounts) {
            const sortedVersions = Object.entries(parsedData.pythonVersionCounts)
                .sort((a, b) => b[1] - a[1]);
                
            for (const [version, count] of sortedVersions) {
                const row = document.createElement('tr');
                const versionCell = document.createElement('td');
                versionCell.textContent = version;
                const countCell = document.createElement('td');
                countCell.textContent = count;
                row.appendChild(versionCell);
                row.appendChild(countCell);
                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        
        codeEnvsTable.appendChild(table);
        container.appendChild(codeEnvsTable);
        
        this.tableContainers['code-envs-table'] = codeEnvsTable;
        this.addFilterButton('Code Environments', 'code-envs-table', filtersContainer);
        
        return codeEnvsTable;
    }
    
    createLogErrorsSection(grid, filtersContainer, parsedData) {
        if (!parsedData.formattedLogErrors && !parsedData.logStats) return;
        
        // Create container for log-related content that spans full width
        const logGroupContainer = document.createElement('div');
        logGroupContainer.className = 'grid-item wide';
        logGroupContainer.id = 'log-group';
        
        // Add Log File Statistics if available
        if (parsedData.logStats && Object.keys(parsedData.logStats).length > 0) {
            const logStatsContainer = document.createElement('div');
            logStatsContainer.className = 'table-container';
            logStatsContainer.id = 'logStats-table';
            
            const statsTable = this.createTable('logStats', 'Log File Statistics', parsedData.logStats, filtersContainer);
            if (statsTable) {
                logGroupContainer.appendChild(statsTable);
                this.tableContainers['logStats-table'] = statsTable;
            }
        }
        
        // Add log errors section if available
        if (parsedData.formattedLogErrors) {
            const logHeader = document.createElement('div');
            logHeader.className = 'table-container';
            logHeader.id = 'log-errors-section';
            
            const title = document.createElement('h4');
            title.textContent = 'Log Errors';
            title.className = 'table-title';
            logHeader.appendChild(title);
            
            // Add centered display button
            const displayLogBtn = document.createElement('button');
            displayLogBtn.textContent = 'Display log errors';
            displayLogBtn.className = 'display-log-btn';
            displayLogBtn.style.display = 'block';
            displayLogBtn.style.margin = '0 auto 15px';
            displayLogBtn.addEventListener('click', function() {
                const logContainer = document.querySelector('.log-container');
                if (logContainer.style.display === 'none') {
                    logContainer.style.display = 'block';
                    this.textContent = 'Hide log errors';
                } else {
                    logContainer.style.display = 'none';
                    this.textContent = 'Display log errors';
                }
            });
            logHeader.appendChild(displayLogBtn);
            
            // Add Pro-Tip box
            const proTipBox = document.createElement('div');
            proTipBox.className = 'pro-tip-box';
            proTipBox.innerHTML = `
                <h5>💡 Pro Tip: Understanding Log Errors</h5>
                <ul>
                    <li>It's very possible this report is misleading or incomplete; ALWAYS check the full log file to be sure</li>
                    <li>This section shows the most recent errors from the log file</li>
                    <li>Both the error line and context lines (before and after) are displayed</li>
                    <li>Errors occurring within 5 seconds of each other are ignored; assumed to be included in the context of the first error</li>
                    <li>I try to filter out duplicate error patterns when possible but it's highly experimental</li>
                </ul>
            `;
            logHeader.appendChild(proTipBox);
            
            // Add the log container
            const logContainer = document.createElement('div');
            logContainer.className = 'log-container';
            logContainer.style.display = 'none';
            logContainer.innerHTML = parsedData.formattedLogErrors;
            logHeader.appendChild(logContainer);
            
            logGroupContainer.appendChild(logHeader);
            this.tableContainers['log-errors-section'] = logHeader;
            
            // Create a filter button for log errors
            this.addFilterButton('Log Errors', 'log-errors-section', filtersContainer);
        }
        
        // Add the log group container to the grid
        grid.appendChild(logGroupContainer);
    }
    
    addFilterButton(title, filterId, container) {
        const filterBtn = document.createElement('button');
        filterBtn.textContent = title;
        filterBtn.className = 'filter-btn';
        filterBtn.dataset.filter = filterId;
        container.appendChild(filterBtn);
    }
}

class FileViewer {
    static viewFile(filename, content) {
        // Create modal for file viewing with syntax highlighting
        let fileViewerModal = document.getElementById('file-viewer-modal');
        
        if (!fileViewerModal) {
            fileViewerModal = document.createElement('div');
            fileViewerModal.id = 'file-viewer-modal';
            fileViewerModal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0,0,0,0.8); z-index: 1000; display: flex;
                justify-content: center; align-items: center; padding: 20px;
            `;
            document.body.appendChild(fileViewerModal);
        } else {
            fileViewerModal.innerHTML = '';
            fileViewerModal.style.display = 'flex';
        }
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background-color: #fff; border-radius: 10px; width: 90%;
            max-width: 1200px; max-height: 90%; display: flex;
            flex-direction: column; overflow: hidden;
            box-shadow: 0 5px 30px rgba(0,0,0,0.3);
        `;
        
        // Header
        const modalHeader = document.createElement('div');
        modalHeader.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 15px 20px; border-bottom: 1px solid #eee;
        `;
        
        const fileTitle = document.createElement('h3');
        fileTitle.textContent = filename;
        fileTitle.style.cssText = 'margin: 0; padding: 0; font-weight: 500;';
        
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;';
        closeButton.style.cssText = `
            background: none; border: none; font-size: 24px;
            cursor: pointer; padding: 0 10px; font-weight: bold;
        `;
        closeButton.onclick = () => fileViewerModal.style.display = 'none';
        
        modalHeader.appendChild(fileTitle);
        modalHeader.appendChild(closeButton);
        
        // Content area
        const fileContentArea = document.createElement('div');
        fileContentArea.style.cssText = `
            overflow: auto; padding: 20px; flex-grow: 1;
            font-family: monospace; white-space: pre;
            font-size: 13px; background-color: #1e1e1e; color: #f8f8f2;
        `;
        
        const preElement = document.createElement('pre');
        preElement.style.cssText = 'margin: 0; padding: 0; overflow: visible; background-color: transparent;';
        
        const codeElement = document.createElement('code');
        const language = this.determineSyntaxLanguage(filename);
        codeElement.className = `language-${language} hljs`;
        codeElement.textContent = content;
        
        preElement.appendChild(codeElement);
        fileContentArea.appendChild(preElement);
        
        // Footer
        const modalFooter = document.createElement('div');
        modalFooter.style.cssText = `
            display: flex; justify-content: space-between;
            padding: 15px 20px; border-top: 1px solid #eee;
        `;
        
        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = 'color: #6c757d; font-size: 14px;';
        fileInfo.textContent = `${content.split('\n').length.toLocaleString()} lines`;
        
        const downloadButton = document.createElement('button');
        downloadButton.className = 'display-log-btn';
        downloadButton.innerHTML = '📥 Download File';
        downloadButton.onclick = () => this.downloadFile(filename, content);
        
        modalFooter.appendChild(fileInfo);
        modalFooter.appendChild(downloadButton);
        
        // Assemble modal
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(fileContentArea);
        modalContent.appendChild(modalFooter);
        fileViewerModal.appendChild(modalContent);
        
        // Apply syntax highlighting
        setTimeout(() => {
            try {
                hljs.highlightElement(codeElement);
            } catch (error) {
                console.error(`Failed to highlight: ${error}`);
            }
        }, 100);
        
        // Event listeners
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                fileViewerModal.style.display = 'none';
            }
        });
        
        fileViewerModal.addEventListener('click', function(e) {
            if (e.target === fileViewerModal) {
                fileViewerModal.style.display = 'none';
            }
        });
    }
    
    static downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }
    
    static determineSyntaxLanguage(filename) {
        if (filename.endsWith('.json')) return 'json';
        if (filename.endsWith('.log') || filename === 'backend.log' || filename === 'fmmain.log' || 
            filename === 'supervisord.log' || filename === 'output.log') return 'log4j';
        if (filename.endsWith('.sh') || filename.endsWith('.bash')) return 'bash';
        if (filename.endsWith('.py')) return 'python';
        if (filename.endsWith('.txt') || filename === 'diag.txt') return 'bash';
        if (filename.endsWith('.html') || filename.endsWith('.htm')) return 'html';
        if (filename.endsWith('.css')) return 'css';
        if (filename.endsWith('.js')) return 'javascript';
        if (filename.endsWith('.xml')) return 'xml';
        if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'yaml';
        if (filename.endsWith('.md')) return 'markdown';
        if (filename.endsWith('.conf')) return 'nginx';
        return 'plaintext';
    }
}

class ProgressIndicator {
    static show(message) {
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.style.display = 'block';
            const messageEl = progressContainer.querySelector('p');
            if (messageEl && message) {
                messageEl.textContent = message;
            }
        }
    }
    
    static hide() {
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
    }
    
    static showError(message) {
        this.hide();
        alert('Error: ' + message);
    }
}

// Main orchestrator class
class DSSParser {
    constructor() {
        this.extractedFiles = {};
        this.parsedData = {};
        this.tableContainers = {};
        this.debugLogs = [];
        this.diagType = 'unknown';
        this.dsshome = 'data/dataiku/dss_data/';
        this.masonryGrid = null;
        
        // Initialize parsers
        this.parsers = {
            'general-settings.json': new GeneralSettingsParser(),
            'connections.json': new ConnectionsParser(),
            'license.json': new LicenseParser(),
            'users.json': new UsersParser(),
            'dss-version.json': new VersionParser(),
            'params.json': new ProjectParamsParser(),
            'settings.json': new PluginSettingsParser(),
            'desc.json': new CodeEnvDescParser(),
            'diag.txt': new DiagParser(),
            'backend.log': new LogParser(),
            'fmmain.log': new LogParser(),
            'output.log': new LogParser(),
            'supervisord.log': new SupervisordLogParser(),
            'env-default.sh': new EnvScriptParser(),
            'env-site.sh': new EnvScriptParser()
        };
        
        this.tableRenderer = new TableRenderer(document.getElementById('table-containers'));
        this.initEventListeners();
    }
    
    initEventListeners() {
        document.getElementById('file-input').addEventListener('change', e => this.handleFileSelect(e));
        document.getElementById('back-btn').addEventListener('click', () => this.reset());
    }
    
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file || !file.name.endsWith('.zip')) {
            ProgressIndicator.showError('Please select a valid ZIP file');
            return;
        }
        
        this.debugLogs = [];
        const fileSizeGB = file.size / (1024 * 1024 * 1024);
        this.log(`Starting to process diagnostic file: ${file.name} (${fileSizeGB.toFixed(2)} GB)`);
        
        ProgressIndicator.show('Processing diagnostic file...');
        
        try {
            zip.configure({
                useWebWorkers: false,
                maxWorkers: 1,
                chunkSize: 256 * 1024,
                zip64: true
            });
            
            await this.extractFiles(file);
            await this.parseFiles();
            this.aggregateResults();
            this.displayResults();
            
            document.getElementById('upload-section').style.display = 'none';
            document.getElementById('results-section').style.display = 'block';
            document.getElementById('back-btn-container').style.display = 'block';
            
        } catch (error) {
            this.log(`Error processing ZIP file: ${error.message}`, error);
            
            const fileSizeGB = file.size / (1024 * 1024 * 1024);
            if (fileSizeGB > 1.0 || error.message.includes('memory')) {
                ProgressIndicator.showError(`File too large (${fileSizeGB.toFixed(2)} GB). Browser-based tool limited to ~1.3 GB files.`);
            } else {
                ProgressIndicator.showError('Error processing file: ' + error.message);
            }
        } finally {
            if (this.zipReader) {
                try {
                    await this.zipReader.close();
                } catch (closeError) {
                    this.log(`Error closing ZIP reader: ${closeError.message}`);
                }
            }
            ProgressIndicator.hide();
        }
    }
    
    async extractFiles(file) {
        this.dsshome = null;
        this.log("Extracting files from ZIP archive");
        
        const reader = new zip.BlobReader(file);
        this.zipReader = new zip.ZipReader(reader);
        const entries = await this.zipReader.getEntries();
        
        // Detect diagnostic type
        this.diagType = detectDiagType(entries);
        this.log(`Detected diag type: ${this.diagType}`);
        
        // Handle different diagnostic types
        if (this.diagType === 'instance') {
            await this.extractInstanceDiag(entries);
        } else if (this.diagType === 'job') {
            await this.extractJobDiag(entries);
        } else {
            await this.extractUnknownDiag(entries);
        }
        
        this.log(`Extraction complete. Found ${Object.keys(this.extractedFiles).length} files.`);
    }
    
    async extractInstanceDiag(entries) {
        // Extract diag.txt first to get DSSHOME
        const diagTxtEntry = entries.find(e => e.filename === 'diag.txt' || e.filename.endsWith('/diag.txt'));
        if (diagTxtEntry) {
            const writer = new zip.TextWriter();
            const diagContent = await diagTxtEntry.getData(writer);
            this.extractedFiles[diagTxtEntry.filename] = diagContent;
            
            const diagParser = new DiagParser();
            const diagResult = diagParser.parse(diagContent, 'diag.txt');
            this.dsshome = diagResult.dsshome;
            this.log(`Extracted DSSHOME path: ${this.dsshome}`);
        }
        
        // Extract other files based on DSSHOME
        await this.extractStandardFiles(entries);
    }
    
    async extractJobDiag(entries) {
        this.dsshome = '';
        this.log('Processing Job/Fleet Manager diagnostic');
        
        // Handle localconfig.zip if present
        const localconfigZipEntry = entries.find(e => e.filename === 'localconfig.zip' || e.filename.endsWith('/localconfig.zip'));
        if (localconfigZipEntry) {
            await this.extractLocalconfigZip(localconfigZipEntry);
        }
        
        await this.extractStandardFiles(entries);
    }
    
    async extractUnknownDiag(entries) {
        this.dsshome = 'data/dataiku/dss_data/';
        this.log('Processing unknown diagnostic type with default DSSHOME');
        await this.extractStandardFiles(entries);
    }
    
    async extractLocalconfigZip(localconfigZipEntry) {
        this.log(`Processing localconfig.zip: ${localconfigZipEntry.filename}`);
        try {
            const blob = await localconfigZipEntry.getData(new zip.BlobWriter("application/zip"));
            const innerZipReader = new zip.ZipReader(new zip.BlobReader(blob));
            const innerEntries = await innerZipReader.getEntries();
            
            for (const innerEntry of innerEntries) {
                if (!innerEntry.directory) {
                    const writer = new zip.TextWriter();
                    const content = await innerEntry.getData(writer);
                    this.extractedFiles[innerEntry.filename] = content;
                    this.log(`Extracted ${innerEntry.filename} from localconfig.zip`);
                }
            }
            await innerZipReader.close();
        } catch (error) {
            this.log(`Error processing localconfig.zip: ${error.message}`);
        }
    }
    
    async extractStandardFiles(entries) {
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
            'bin/env-site.sh'
        ];
        
        for (const pathSuffix of filesToExtract) {
            const targetPath = this.dsshome + pathSuffix;
            const targetEntry = this.findTargetEntry(entries, targetPath);
            if (targetEntry) {
                try {
                    const writer = new zip.TextWriter();
                    const content = await targetEntry.getData(writer);
                    this.extractedFiles[targetEntry.filename] = content;
                    this.log(`Extracted: ${targetEntry.filename}`);
                } catch (error) {
                    this.log(`Error extracting ${targetEntry.filename}: ${error.message}`);
                }
            }
        }
        
        // Extract project, plugin, and code env files
        await this.extractProjectFiles(entries);
        await this.extractPluginFiles(entries);
        await this.extractCodeEnvFiles(entries);
        await this.extractLogFiles(entries);
        await this.extractRootFiles(entries);
    }
    
    async extractProjectFiles(entries) {
        const projectParamsPattern = new RegExp(`^${this.dsshome.replace(/\//g, '\\/')}config\/projects\/[^\/]+\/params\.json$`);
        let projectCount = 0;
        
        for (const entry of entries) {
            if (projectParamsPattern.test(entry.filename)) {
                try {
                    const writer = new zip.TextWriter();
                    const content = await entry.getData(writer);
                    this.extractedFiles[entry.filename] = content;
                    projectCount++;
                } catch (error) {
                    this.log(`Error extracting ${entry.filename}: ${error.message}`);
                }
            }
        }
        
        this.log(`Extracted ${projectCount} project params.json files`);
    }
    
    async extractPluginFiles(entries) {
        const pluginSettingsPattern = new RegExp(`^${this.dsshome.replace(/\//g, '\\/')}config\/plugins\/[^\/]+\/settings\.json$`);
        let pluginCount = 0;
        
        for (const entry of entries) {
            if (pluginSettingsPattern.test(entry.filename)) {
                try {
                    const writer = new zip.TextWriter();
                    const content = await entry.getData(writer);
                    this.extractedFiles[entry.filename] = content;
                    pluginCount++;
                } catch (error) {
                    this.log(`Error extracting ${entry.filename}: ${error.message}`);
                }
            }
        }
        
        this.log(`Extracted ${pluginCount} plugin settings files`);
    }
    
    async extractCodeEnvFiles(entries) {
        const codeEnvDescPattern = new RegExp(`^${this.dsshome.replace(/\//g, '\\/')}code-envs\/desc\/[^\/]+\/[^\/]+\/desc\.json$`);
        let codeEnvCount = 0;
        
        for (const entry of entries) {
            if (codeEnvDescPattern.test(entry.filename)) {
                try {
                    const writer = new zip.TextWriter();
                    const content = await entry.getData(writer);
                    this.extractedFiles[entry.filename] = content;
                    codeEnvCount++;
                } catch (error) {
                    this.log(`Error extracting ${entry.filename}: ${error.message}`);
                }
            }
        }
        
        this.log(`Extracted ${codeEnvCount} code environment desc files`);
    }
    
    async extractLogFiles(entries) {
        // Extract output.log/output.log.gz
        const outputLogEntry = entries.find(e => e.filename === 'output.log' || e.filename.endsWith('/output.log'));
        const outputLogGzEntry = entries.find(e => e.filename === 'output.log.gz' || e.filename.endsWith('/output.log.gz'));
        
        if (outputLogGzEntry || outputLogEntry) {
            try {
                const entry = outputLogGzEntry || outputLogEntry;
                const isGzipped = !!outputLogGzEntry;
                let content;
                
                if (isGzipped) {
                    const blob = await entry.getData(new zip.BlobWriter());
                    const gzipData = await new zip.BlobReader(blob).readUint8Array(0, blob.size);
                    content = new TextDecoder().decode(pako.ungzip(gzipData));
                } else {
                    content = await entry.getData(new zip.TextWriter());
                }
                
                this.extractedFiles['output.log'] = content;
                this.log(`Successfully extracted${isGzipped ? ' and decompressed' : ''} ${entry.filename} as output.log`);
            } catch (error) {
                this.log(`Error extracting log file: ${error.message}`);
            }
        }
    }
    
    async extractRootFiles(entries) {
        let rootFileCount = 0;
        for (const entry of entries) {
            if (!entry.filename.includes('/') && !entry.directory && entry.uncompressedSize < 10 * 1024 * 1024) {
                try {
                    const writer = new zip.TextWriter();
                    const content = await entry.getData(writer);
                    this.extractedFiles[entry.filename] = content;
                    rootFileCount++;
                } catch (error) {
                    this.log(`Error extracting root file ${entry.filename}: ${error.message}`);
                }
            }
        }
        this.log(`Extracted ${rootFileCount} files from the root of the zipfile`);
    }
    
    findTargetEntry(entries, targetPath) {
        const targetPathNormalized = targetPath.replace(/\\/g, '/').replace(/^\.\//, '');
        
        // Try exact match first
        let targetEntry = entries.find(entry => entry.filename === targetPathNormalized);
        if (targetEntry) return targetEntry;
        
        // Try ends with filename
        const targetParts = targetPathNormalized.split('/');
        const targetFile = targetParts[targetParts.length - 1];
        const contextPattern = targetParts[targetParts.length - 2] + '/' + targetFile;
        
        targetEntry = entries.find(entry => entry.filename.endsWith(contextPattern));
        if (targetEntry) return targetEntry;
        
        // Try flexible filename match
        targetEntry = entries.find(entry => {
            const entryPath = entry.filename.replace(/\\/g, '/');
            return entryPath.endsWith('/' + targetFile) && 
                   !entry.directory &&
                   !entryPath.includes('/datasets/') &&
                   !entryPath.includes('/projects/');
        });
        
        return targetEntry;
    }
    
    async parseFiles() {
        this.log("Starting to parse extracted files");
        
        for (const [filepath, content] of Object.entries(this.extractedFiles)) {
            try {
                const parser = this.getParserForFile(filepath);
                if (parser) {
                    const result = parser.parse(content, filepath);
                    if (result && Object.keys(result).length > 0) {
                        // Store results with filepath as key for aggregation
                        this.parsedData[filepath] = result;
                        this.log(`Successfully parsed: ${filepath}`);
                    }
                } else {
                    this.log(`No parser found for: ${filepath}`);
                }
            } catch (error) {
                this.log(`Error parsing ${filepath}: ${error.message}`);
            }
        }
        
        this.log(`Finished parsing ${Object.keys(this.parsedData).length} files`);
    }
    
    getParserForFile(filename) {
        const baseName = filename.split('/').pop();
        
        // Direct filename matches
        if (this.parsers[baseName]) {
            return this.parsers[baseName];
        }
        
        // Pattern-based matches
        if (filename.includes('/projects/') && baseName === 'params.json') {
            return this.parsers['params.json'];
        }
        
        if (filename.includes('/plugins/') && baseName === 'settings.json') {
            return this.parsers['settings.json'];
        }
        
        if (filename.includes('/code-envs/desc/') && baseName === 'desc.json') {
            return this.parsers['desc.json'];
        }
        
        if (baseName.endsWith('.log')) {
            return this.parsers['backend.log']; // Use LogParser for all .log files
        }
        
        if (baseName.endsWith('.sh')) {
            return this.parsers['env-default.sh']; // Use EnvScriptParser for all .sh files
        }
        
        return null;
    }
    
    aggregateResults() {
        this.log("Aggregating results from all parsers");
        
        // Initialize aggregated data structure
        const aggregated = {
            company: null,
            dssVersion: null,
            pythonVersion: null,
            lastRestartTime: null,
            dsshome: this.dsshome,
            diagType: this.diagType,
            
            // System info
            cpuCores: null,
            osInfo: null,
            filesystemInfo: [],
            memoryInfo: {},
            systemLimits: {},
            
            // Configuration
            enabledSettings: {},
            sparkSettings: {},
            authSettings: {},
            containerSettings: {},
            integrationSettings: {},
            resourceLimits: {},
            cgroupSettings: {},
            proxySettings: {},
            javaMemorySettings: {},
            
            // Data
            connections: {},
            userStats: {},
            licenseProperties: {},
            
            // Collections
            projects: [],
            plugins: [],
            codeEnvs: [],
            pythonVersionCounts: {},
            
            // Logs
            formattedLogErrors: null,
            rawLogErrors: [],
            logStats: {}
        };
        
        // Aggregate data from all parsed files
        for (const [filepath, result] of Object.entries(this.parsedData)) {
            this.mergeResults(aggregated, result, filepath);
        }
        
        // Post-process aggregated data
        this.postProcessResults(aggregated);
        
        // Replace parsedData with aggregated results
        this.parsedData = aggregated;
        
        this.log("Results aggregation complete");
    }
    
    mergeResults(aggregated, result, filepath) {
        // Merge based on result structure
        for (const [key, value] of Object.entries(result)) {
            switch (key) {
                // Direct assignments
                case 'company':
                case 'dssVersion':
                case 'pythonVersion':
                case 'lastRestartTime':
                case 'cpuCores':
                case 'osInfo':
                case 'dsshome':
                case 'formattedLogErrors':
                    if (value && !aggregated[key]) {
                        aggregated[key] = value;
                    }
                    break;
                    
                // Object merges
                case 'enabledSettings':
                case 'sparkSettings':
                case 'authSettings':
                case 'containerSettings':
                case 'integrationSettings':
                case 'resourceLimits':
                case 'cgroupSettings':
                case 'proxySettings':
                case 'javaMemorySettings':
                case 'memoryInfo':
                case 'systemLimits':
                case 'connections':
                case 'userStats':
                case 'licenseProperties':
                case 'pythonVersionCounts':
                case 'logStats':
                    if (value && typeof value === 'object') {
                        Object.assign(aggregated[key], value);
                    }
                    break;
                    
                // Array assignments
                case 'filesystemInfo':
                case 'rawLogErrors':
                    if (Array.isArray(value) && value.length > 0) {
                        aggregated[key] = value;
                    }
                    break;
                    
                // Special cases for collections
                case 'name': // From project/plugin/codeenv parsing
                    if (filepath.includes('/projects/') && result.key) {
                        aggregated.projects.push(result);
                    } else if (filepath.includes('/plugins/') && result.pluginName) {
                        aggregated.plugins.push(result.pluginName);
                    } else if (filepath.includes('/code-envs/') && result.name) {
                        aggregated.codeEnvs.push(result);
                        // Also update python version counts
                        const version = result.version || 'NA';
                        aggregated.pythonVersionCounts[version] = (aggregated.pythonVersionCounts[version] || 0) + 1;
                    }
                    break;
                    
                default:
                    // Handle any other properties
                    if (value && !aggregated[key]) {
                        aggregated[key] = value;
                    }
                    break;
            }
        }
    }
    
    postProcessResults(aggregated) {
        // Sort projects by version number
        aggregated.projects.sort((a, b) => (b.versionNumber || 0) - (a.versionNumber || 0));
        
        // Sort plugins alphabetically
        aggregated.plugins.sort();
        
        // Sort code envs by name
        aggregated.codeEnvs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        // Use DSSHOME from diag.txt if available
        if (aggregated.dsshome && aggregated.dsshome !== this.dsshome) {
            this.dsshome = aggregated.dsshome;
        }
        
        // Add calculated fields
        aggregated.pluginsCount = aggregated.plugins.length;
    }
    
    displayResults() {
        // Update info panel
        document.getElementById('company-info').textContent = this.parsedData.company || 'Unknown';
        document.getElementById('version-info').textContent = this.parsedData.dssVersion || 'Unknown';
        document.getElementById('python-version-info').textContent = this.parsedData.pythonVersion || 'Unknown';
        document.getElementById('file-info').textContent = document.getElementById('file-input').files[0]?.name || 'Unknown';
        
        // Create download UI
        this.createDownloadUI();
        
        // Setup table containers and filters
        const tableContainersDiv = document.getElementById('table-containers');
        const tableFiltersDiv = document.getElementById('table-filters');
        tableContainersDiv.innerHTML = '';
        
        // Setup masonry grid
        this.setupMasonryGrid(tableContainersDiv);
        
        // Create tables using TableRenderer
        this.createAllTables(tableFiltersDiv);
        
        // Initialize filter functionality
        this.initializeFilters(tableFiltersDiv);
        
        // Update debug logs
        const debugLogsElement = document.getElementById('debug-logs');
        if (debugLogsElement && this.debugLogs.length > 0) {
            debugLogsElement.textContent = this.debugLogs.join('\n');
        }
    }
    
    setupMasonryGrid(container) {
        const grid = document.createElement('div');
        grid.className = 'grid';
        container.appendChild(grid);
        
        const gridSizer = document.createElement('div');
        gridSizer.className = 'grid-sizer';
        grid.appendChild(gridSizer);
        
        const gutterSizer = document.createElement('div');
        gutterSizer.className = 'gutter-sizer';
        grid.appendChild(gutterSizer);
        
        // Initialize Masonry
        setTimeout(() => {
            this.masonryGrid = new Masonry(grid, {
                itemSelector: '.grid-item',
                columnWidth: '.grid-sizer',
                gutter: '.gutter-sizer',
                percentPosition: true,
                transitionDuration: '0.3s',
                initLayout: true,
                resize: true,
                stagger: 30
            });
        }, 100);
        
        return grid;
    }
    
    createAllTables(filtersContainer) {
        const grid = document.querySelector('.grid');
        
        // Create projects table first if we have projects
        if (this.parsedData.projects && this.parsedData.projects.length > 0) {
            const projectsTable = this.tableRenderer.createProjectsTable(this.parsedData.projects, filtersContainer);
            if (projectsTable) {
                grid.appendChild(projectsTable);
            }
        }
        
        // Create special chart components
        if (this.parsedData.filesystemInfo && this.parsedData.filesystemInfo.length > 0) {
            const filesystemChart = this.tableRenderer.createFilesystemChart(this.parsedData.filesystemInfo, filtersContainer);
            grid.appendChild(filesystemChart);
        }
        
        if (this.parsedData.memoryInfo && Object.keys(this.parsedData.memoryInfo).length > 0) {
            const memoryChart = this.tableRenderer.createMemoryChart(this.parsedData.memoryInfo, filtersContainer);
            grid.appendChild(memoryChart);
        }
        
        if (this.parsedData.connections && Object.keys(this.parsedData.connections).length > 0) {
            const connectionsChart = this.tableRenderer.createConnectionsChart(this.parsedData.connections, filtersContainer);
            grid.appendChild(connectionsChart);
        }
        
        // Create regular tables
        const tableConfigs = [
            { id: 'enabledSettings', title: 'Enabled Settings', data: this.parsedData.enabledSettings },
            { id: 'sparkSettings', title: 'Spark Settings', data: this.parsedData.sparkSettings },
            { id: 'authSettings', title: 'Authentication Settings', data: this.parsedData.authSettings },
            { id: 'userStats', title: 'User Statistics', data: this.parsedData.userStats },
            { id: 'licenseProperties', title: 'License Properties', data: this.parsedData.licenseProperties },
            { id: 'resourceLimits', title: 'Resource Limits', data: this.parsedData.resourceLimits },
            { id: 'cgroupSettings', title: 'CGroups Configuration', data: this.parsedData.cgroupSettings },
            { id: 'javaMemorySettings', title: 'Java Memory Settings', data: this.parsedData.javaMemorySettings },
            { id: 'systemLimits', title: 'System Limits', data: this.parsedData.systemLimits }
        ];
        
        for (const config of tableConfigs) {
            if (config.data && Object.keys(config.data).length > 0) {
                const gridItem = document.createElement('div');
                gridItem.className = 'grid-item';
                
                const tableContainer = this.tableRenderer.createTable(
                    config.id, 
                    config.title, 
                    config.data, 
                    filtersContainer
                );
                
                if (tableContainer) {
                    gridItem.appendChild(tableContainer);
                    grid.appendChild(gridItem);
                    this.tableContainers[config.id + '-table'] = tableContainer;
                }
            }
        }
        
        // Create plugins and code environments tables
        this.tableRenderer.createPluginsCodeEnvsTables(grid, filtersContainer, this.parsedData);
        
        // Create log errors section
        this.tableRenderer.createLogErrorsSection(grid, filtersContainer, this.parsedData);
        
        // Force layout after all tables are created
        setTimeout(() => {
            if (this.masonryGrid) {
                this.masonryGrid.layout();
                
                // Force additional layouts for stability
                setTimeout(() => {
                    this.masonryGrid.layout();
                    setTimeout(() => {
                        this.masonryGrid.layout();
                    }, 300);
                }, 200);
            }
        }, 200);
    }
    
    createDownloadUI() {
        const infoPanel = document.querySelector('.info-panel');
        if (!infoPanel) return;
        
        // Find and prepare the info panel
        const existingDownloadSection = infoPanel.querySelector('#download-section');
        if (existingDownloadSection) {
            existingDownloadSection.remove();
        }
        
        // Define the files to add download buttons for
        const filesToDownload = [
            { path: 'diag.txt', label: 'diag.txt' },
            { path: this.dsshome + 'install.ini', label: 'install.ini' },
            { path: this.dsshome + 'config/connections.json', label: 'connections.json' },
            { path: this.dsshome + 'config/general-settings.json', label: 'general-settings.json' },
            { path: this.dsshome + 'config/license.json', label: 'license.json' },
            { path: this.dsshome + 'config/users.json', label: 'users.json' },
            { path: this.dsshome + 'dss-version.json', label: 'dss-version.json' },
            { path: this.dsshome + 'run/backend.log', label: 'backend.log' },
            { path: this.dsshome + 'run/fmmain.log', label: 'fmmain.log' },
            { path: 'output.log', label: 'output.log' },
            { path: this.dsshome + 'run/supervisord.log', label: 'supervisord.log' },
            { path: this.dsshome + 'run/ipython.log', label: 'ipython.log' },
            { path: this.dsshome + 'bin/env-default.sh', label: 'env-default.sh' },
            { path: this.dsshome + 'bin/env-site.sh', label: 'env-site.sh' }
        ];
        
        // Create download buttons container
        const downloadBtnsContainer = document.createElement('div');
        downloadBtnsContainer.className = 'download-btn-container';
        downloadBtnsContainer.id = 'download-buttons-container';
        downloadBtnsContainer.style.display = 'grid';
        downloadBtnsContainer.style.marginBottom = '20px';
        downloadBtnsContainer.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
        downloadBtnsContainer.style.paddingBottom = '15px';
        downloadBtnsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
        downloadBtnsContainer.style.gap = '10px';
        downloadBtnsContainer.style.padding = '15px';
        
        // Track which files we've already created buttons for
        const addedFiles = new Set();
        
        // Sort files alphabetically by label
        const sortedFilesToDownload = [...filesToDownload].sort((a, b) => a.label.localeCompare(b.label));
        
        // Create download buttons for all files
        let buttonCount = 0;
        for (const file of sortedFilesToDownload) {
            const filePath = this.findFileForDownload(file.path);
            if (filePath && this.extractedFiles[filePath]) {
                // Extract just the filename without the path
                const pathParts = filePath.split('/');
                const fileName = pathParts[pathParts.length - 1];
                
                // Skip if we already added this filename
                if (addedFiles.has(fileName)) {
                    continue;
                }
                
                buttonCount++;
                addedFiles.add(fileName);
                
                // Create button container for this file
                const buttonContainer = document.createElement('div');
                buttonContainer.style.display = 'inline-flex';
                buttonContainer.style.margin = '5px';
                buttonContainer.style.borderRadius = '20px';
                buttonContainer.style.overflow = 'hidden';
                buttonContainer.style.border = '1px solid rgba(0,0,0,0.1)';
                
                // View button
                const viewBtn = document.createElement('button');
                viewBtn.className = 'download-btn view-btn';
                viewBtn.style.margin = '0';
                viewBtn.style.borderRadius = '20px 0 0 20px';
                viewBtn.style.borderRight = '1px solid rgba(255,255,255,0.2)';
                viewBtn.style.backgroundColor = 'var(--dataiku-primary)';
                viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>`;
                viewBtn.title = `View ${file.label}`;
                viewBtn.addEventListener('click', () => {
                    const content = this.extractedFiles[filePath];
                    FileViewer.viewFile(file.label, content);
                });
                
                // Download button
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'download-btn';
                downloadBtn.style.margin = '0';
                downloadBtn.style.borderRadius = '0 20px 20px 0';
                downloadBtn.style.backgroundColor = 'var(--dataiku-primary-dark)';
                downloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>`;
                downloadBtn.title = `Download ${file.label}`;
                downloadBtn.addEventListener('click', () => {
                    const content = this.extractedFiles[filePath];
                    FileViewer.downloadFile(file.label, content);
                });
                
                // Append both buttons to container
                buttonContainer.appendChild(viewBtn);
                buttonContainer.appendChild(downloadBtn);
                
                // Add file name label next to the buttons
                const fileLabel = document.createElement('span');
                fileLabel.style.marginLeft = '8px';
                fileLabel.style.fontSize = '14px';
                fileLabel.style.color = '#495057';
                fileLabel.textContent = file.label;
                
                // Wrap everything in a container
                const fileButtonWrapper = document.createElement('div');
                fileButtonWrapper.style.display = 'flex';
                fileButtonWrapper.style.alignItems = 'center';
                fileButtonWrapper.style.margin = '0';
                fileButtonWrapper.style.padding = '8px';
                fileButtonWrapper.style.borderRadius = '8px';
                fileButtonWrapper.style.backgroundColor = 'rgba(0, 181, 170, 0.05)';
                fileButtonWrapper.style.border = '1px solid rgba(0, 181, 170, 0.1)';
                fileButtonWrapper.style.minHeight = '40px';
                
                fileButtonWrapper.appendChild(buttonContainer);
                fileButtonWrapper.appendChild(fileLabel);
                
                downloadBtnsContainer.appendChild(fileButtonWrapper);
            }
        }
        
        // Add buttons for root files if we have any
        const rootFiles = [];
        for (const filename in this.extractedFiles) {
            if (!filename.includes('/') && filename !== 'diag.txt') {
                rootFiles.push(filename);
            }
        }
        
        if (rootFiles.length > 0) {
            // Sort root files alphabetically
            const sortedRootFiles = [...rootFiles].sort();
            
            // Add button for each root file (if not already added)
            for (const filename of sortedRootFiles) {
                // Skip if we already added this filename
                if (addedFiles.has(filename)) {
                    continue;
                }
                
                buttonCount++;
                addedFiles.add(filename);
                
                // Truncate filename if too long
                const displayName = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
                
                // Create button container for this file
                const buttonContainer = document.createElement('div');
                buttonContainer.style.display = 'inline-flex';
                buttonContainer.style.margin = '5px';
                buttonContainer.style.borderRadius = '20px';
                buttonContainer.style.overflow = 'hidden';
                buttonContainer.style.border = '1px solid rgba(0,0,0,0.1)';
                
                // View button
                const viewBtn = document.createElement('button');
                viewBtn.className = 'download-btn view-btn';
                viewBtn.style.margin = '0';
                viewBtn.style.borderRadius = '20px 0 0 20px';
                viewBtn.style.borderRight = '1px solid rgba(255,255,255,0.2)';
                viewBtn.style.backgroundColor = 'var(--dataiku-primary)';
                viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>`;
                viewBtn.title = `View ${filename}`;
                viewBtn.addEventListener('click', () => {
                    const content = this.extractedFiles[filename];
                    FileViewer.viewFile(filename, content);
                });
                
                // Download button
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'download-btn';
                downloadBtn.style.margin = '0';
                downloadBtn.style.borderRadius = '0 20px 20px 0';
                downloadBtn.style.backgroundColor = 'var(--dataiku-primary-dark)';
                downloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>`;
                downloadBtn.title = `Download ${filename}`;
                downloadBtn.addEventListener('click', () => {
                    const content = this.extractedFiles[filename];
                    FileViewer.downloadFile(filename, content);
                });
                
                // Add tooltip for full filename if truncated
                if (displayName !== filename) {
                    buttonContainer.title = filename;
                }
                
                // Append both buttons to container
                buttonContainer.appendChild(viewBtn);
                buttonContainer.appendChild(downloadBtn);
                
                // Add file name label next to the buttons
                const fileLabel = document.createElement('span');
                fileLabel.style.marginLeft = '8px';
                fileLabel.style.fontSize = '14px';
                fileLabel.style.color = '#495057';
                fileLabel.textContent = displayName;
                
                // Wrap everything in a container
                const fileButtonWrapper = document.createElement('div');
                fileButtonWrapper.style.display = 'flex';
                fileButtonWrapper.style.alignItems = 'center';
                fileButtonWrapper.style.margin = '0';
                fileButtonWrapper.style.padding = '8px';
                fileButtonWrapper.style.borderRadius = '8px';
                fileButtonWrapper.style.backgroundColor = 'rgba(0, 181, 170, 0.05)';
                fileButtonWrapper.style.border = '1px solid rgba(0, 181, 170, 0.1)';
                fileButtonWrapper.style.minHeight = '40px';
                
                fileButtonWrapper.appendChild(buttonContainer);
                fileButtonWrapper.appendChild(fileLabel);
                
                downloadBtnsContainer.appendChild(fileButtonWrapper);
            }
        }
        
        // Create the main download section if we have any buttons
        if (buttonCount > 0) {
            const downloadSection = document.createElement('div');
            downloadSection.id = 'download-section';
            
            // Create toggle button
            const downloadToggleBtn = document.createElement('button');
            downloadToggleBtn.className = 'display-log-btn';
            downloadToggleBtn.style.margin = '0 auto 15px';
            downloadToggleBtn.style.display = 'block';
            downloadToggleBtn.style.backgroundColor = 'var(--dataiku-primary)';
            downloadToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-up" viewBox="0 0 16 16" style="margin-right: 5px;"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg> Hide Files';
            
            // Add click handler for toggle
            downloadToggleBtn.addEventListener('click', function() {
                const isVisible = downloadBtnsContainer.style.display !== 'none';
                downloadBtnsContainer.style.display = isVisible ? 'none' : 'grid';
                this.innerHTML = isVisible 
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16" style="margin-right: 5px;"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg> Access Files'
                    : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-up" viewBox="0 0 16 16" style="margin-right: 5px;"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg> Hide Files';
            });
            
            downloadSection.appendChild(downloadToggleBtn);
            downloadSection.appendChild(downloadBtnsContainer);
            
            // Insert at the top of the info panel
            infoPanel.insertBefore(downloadSection, infoPanel.firstChild);
        }
    }
    
    findFileForDownload(targetPath) {
        // Direct match
        if (this.extractedFiles[targetPath]) {
            return targetPath;
        }
        
        // Find by exact filename match
        for (const filePath in this.extractedFiles) {
            if (filePath === targetPath) {
                return filePath;
            }
        }
        
        // Find by ends-with match
        for (const filePath in this.extractedFiles) {
            if (filePath.endsWith(targetPath)) {
                return filePath;
            }
        }
        
        // Find by filename only
        const targetFilename = targetPath.split('/').pop();
        const matches = [];
        for (const filePath in this.extractedFiles) {
            const filename = filePath.split('/').pop();
            if (filename === targetFilename) {
                matches.push(filePath);
            }
        }
        
        // Return the first match if unique, otherwise return null
        return matches.length === 1 ? matches[0] : null;
    }
    
    initializeFilters(filtersContainer) {
        const filterButtons = filtersContainer.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.filterTables(e.target.dataset.filter);
                filterButtons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                
                setTimeout(() => {
                    if (this.masonryGrid) {
                        this.masonryGrid.layout();
                    }
                }, 100);
            });
        });
    }
    
    filterTables(filter) {
        for (const [id, container] of Object.entries(this.tableContainers)) {
            if (filter === 'all' || id === filter) {
                container.style.display = '';
                container.classList.remove('table-container-hidden');
            } else {
                container.style.display = 'none';
                container.classList.add('table-container-hidden');
            }
        }
        
        // Relayout masonry after filtering
        setTimeout(() => {
            if (this.masonryGrid) {
                this.masonryGrid.layout();
            }
        }, 100);
    }
    
    viewFile(filename) {
        const content = this.extractedFiles[filename];
        if (content) {
            FileViewer.viewFile(filename, content);
        } else {
            alert('File not found: ' + filename);
        }
    }
    
    reset() {
        document.getElementById('upload-section').style.display = 'block';
        document.getElementById('results-section').style.display = 'none';
        document.getElementById('back-btn-container').style.display = 'none';
        document.getElementById('file-input').value = '';
        
        this.zipReader = null;
        this.extractedFiles = {};
        this.parsedData = {};
        this.tableContainers = {};
        this.debugLogs = [];
        this.dsshome = 'data/dataiku/dss_data/';
        this.diagType = 'unknown';
        
        // Force page reload to clear DOM
        location.reload();
    }
    
    log(message, data) {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] ${message}`;
        
        if (data !== undefined) {
            try {
                if (typeof data === 'object') {
                    logMessage += `: ${JSON.stringify(data, null, 2)}`;
                } else {
                    logMessage += `: ${data}`;
                }
            } catch (e) {
                logMessage += `: [Unable to stringify data]`;
            }
        }
        
        console.log(logMessage);
        this.debugLogs.push(logMessage);
    }
}

// Utility functions
function formatKey(key) {
    return key.replace(/\./g, ' ')
        .replace(/_/g, ' ')
        .replace(/Settings/g, '')
        .replace(/enabled/g, '')
        .trim();
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function detectDiagType(entries) {
    const diagTxtEntry = entries.find(e => e.filename === 'diag.txt' || e.filename.endsWith('/diag.txt'));
    const localconfigZipEntry = entries.find(e => e.filename === 'localconfig.zip' || e.filename.endsWith('/localconfig.zip'));
    const localconfigFolderEntry = entries.find(e => {
        const parts = e.filename.split('/');
        return parts.includes('localconfig');
    });

    if (diagTxtEntry) {
        return 'instance';
    } else if (localconfigZipEntry || localconfigFolderEntry) {
        return 'job';
    } else {
        return 'unknown';
    }
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', function() {
    window.dssParser = new DSSParser();
    ProgressIndicator.hide();
    
    // Add animations and styling
    const uploadSection = document.getElementById('upload-section');
    setTimeout(() => {
        uploadSection.classList.add('fade-in');
    }, 200);
    
    const fileInputLabel = document.querySelector('.file-input-label');
    if (fileInputLabel) {
        setTimeout(() => {
            fileInputLabel.classList.add('pulse');
        }, 1000);
    }
});