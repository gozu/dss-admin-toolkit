// Diagnostic types
export type DiagType = 'instance' | 'job' | 'fm' | 'unknown';
export type DataSource = 'zip' | 'api';
export type DebugLevel = 'info' | 'warn' | 'error';
export type LayoutMode = 'standard' | 'ultrawide';

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  message: string;
  scope?: string;
  level: DebugLevel;
}

// Extracted files map
export type ExtractedFiles = Record<string, string>;

// Cluster types
export interface NodeGroup {
  name: string;
  instanceType: string;
  desiredCapacity: number;
  minSize: number;
  maxSize: number;
  volumeSize?: number;
  volumeType?: string;
  spot?: boolean;
  labels?: Record<string, string>;
  taints?: Array<{ key: string; value: string; effect: string }>;
}

export interface Cluster {
  name: string;
  region?: string;
  version?: string;
  networkType?: string;
  vpcCidr?: string;
  subnets?: Record<string, Record<string, { id: string }>>;
  subnetIds?: string[];
  securityGroups?: string[];
  vpcId?: string;
  status?: 'ON' | 'OFF' | 'UNKNOWN';
  uptime?: string;
  server?: string;
  nodeGroups: NodeGroup[];
  lastStartTime?: Date;
  lastStopTime?: Date;
  currentContext?: string;
  clusterName?: string;
  authCommand?: string;
  authApiVersion?: string;
}

// Project types
export interface Permission {
  type: 'Group' | 'User';
  name: string;
  permissions: Record<string, boolean>;
}

export interface Project {
  key: string;
  name: string;
  owner: string;
  permissions: Permission[];
  versionNumber: number;
}

export type ProjectFootprintHealth = 'green' | 'yellow' | 'orange' | 'red' | 'angry-red';

export interface ProjectFootprintRow {
  projectKey: string;
  name: string;
  owner: string;
  codeEnvCount: number;
  codeEnvBytes?: number;
  managedDatasetsBytes: number;
  managedFoldersBytes: number;
  bundleBytes: number;
  bundleCount?: number;
  totalBytes: number;
  totalGB: number;
  instanceAvgProjectGB: number;
  projectSizeIndex: number;
  projectSizeHealth: ProjectFootprintHealth;
  codeStudioCount?: number;
  codeEnvHealth: ProjectFootprintHealth;
  codeEnvRisk?: number;
  projectRisk?: number;
  usageBreakdown?: Record<string, number>;
}

export interface ProjectFootprintSummary {
  instanceProjectRiskAvg: number;
  instanceAvgProjectGB: number;
  projectCount: number;
  benchmark?: {
    enabled?: boolean;
    projectLimit?: number;
    projectSelection?: string;
    timeoutMs?: number;
    timedOut?: boolean;
    timeoutAtStep?: string | null;
    totalElapsedMs?: number;
    remainingMs?: number;
    totalProjectCount?: number;
    selectedProjectCount?: number;
    steps?: Array<{
      name: string;
      calls: number;
      elapsedMs: number;
      avgMs: number;
      qps: number;
    }>;
    apiCalls?: Array<{
      operation: string;
      calls: number;
      elapsedMs: number;
      avgMs: number;
      qps: number;
    }>;
    events?: Array<{
      tMs?: number;
      level?: 'info' | 'warn' | 'error';
      step?: string;
      projectKey?: string;
      message?: string;
      elapsedMs?: number;
    }>;
  };
}

export interface LoadingProgressState {
  active: boolean;
  progressPct: number;
  phase?: string;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface CodeEnvUsageRef {
  projectKey: string;
  projectName?: string;
  usageType: string;
  objectType?: string;
  objectId?: string;
  objectName?: string;
  codeEnvKey?: string;
  codeEnvName?: string;
  codeEnvLanguage?: string;
  codeEnvOwner?: string;
}

// Code Environment types
export interface CodeEnv {
  name: string;
  version: string;
  language: 'python' | 'r';
  owner?: string;
  sizeBytes?: number;
  usageCount?: number;
  usageSummary?: Record<string, number>;
  projectCount?: number;
  projectKeys?: string[];
  usageDetails?: CodeEnvUsageRef[];
}

export interface MailChannel {
  id: string;
  label: string;
}

export type CampaignId =
  | 'project'
  | 'code_env'
  | 'code_studio'
  | 'auto_scenario'
  | 'disabled_user'
  | 'deprecated_code_env'
  | 'default_code_env'
  | 'overshared_project'
  | 'scenario_frequency'
  | 'empty_project'
  | 'large_flow'
  | 'orphan_notebooks'
  | 'scenario_failing'
  | 'inactive_project'
  | 'unused_code_env';

export interface OutreachRecipient {
  recipientKey: string;
  owner: string;
  email: string;
  projectKeys: string[];
  codeEnvNames: string[];
  usageDetails: CodeEnvUsageRef[];
  projectKeyForSend?: string | null;
  projects?: Array<{
    projectKey: string;
    name?: string;
    codeEnvCount?: number;
    codeEnvNames?: string[];
    codeStudioCount?: number;
    autoScenarioCount?: number;
    autoScenarios?: Array<{
      id: string;
      name: string;
      type: string;
      triggerCount: number;
    }>;
    totalGB?: number;
    permissionCount?: number;
    pythonVersion?: string;
    minTriggerMinutes?: number;
    totalObjects?: number;
    notebookCount?: number;
    recipeCount?: number;
    daysInactive?: number;
  }>;
  codeEnvs?: Array<{
    key?: string;
    name?: string;
    language?: string;
    sizeBytes?: number;
    impactedProjects?: string[];
    pythonVersion?: string;
  }>;
  details?: Record<string, unknown>;
}

export interface OutreachData {
  summary: {
    projectCount: number;
    unhealthyProjectCount: number;
    unhealthyCodeEnvCount: number;
    unhealthyCodeStudioProjectCount?: number;
    autoScenarioCount?: number;
    projectRecipientCount: number;
    codeEnvRecipientCount: number;
    codeStudioRecipientCount?: number;
    autoScenarioRecipientCount?: number;
    disabledUserProjectCount?: number;
    deprecatedCodeEnvCount?: number;
    defaultCodeEnvMissingCount?: number;
    oversharedProjectCount?: number;
    scenarioFrequencyCount?: number;
    emptyProjectCount?: number;
    largeFlowProjectCount?: number;
    orphanNotebookProjectCount?: number;
    scenarioFailingCount?: number;
    inactiveProjectCount?: number;
    unusedCodeEnvCount?: number;
  };
  mailChannels: MailChannel[];
  templates: Record<CampaignId, { subject: string; body: string }>;
  unhealthyProjects: ProjectFootprintRow[];
  unhealthyCodeEnvs: CodeEnv[];
  unhealthyCodeStudioProjects?: ProjectFootprintRow[];
  projectRecipients: OutreachRecipient[];
  codeEnvRecipients: OutreachRecipient[];
  codeStudioRecipients?: OutreachRecipient[];
  autoScenarioRecipients?: OutreachRecipient[];
  disabledUserRecipients?: OutreachRecipient[];
  deprecatedCodeEnvRecipients?: OutreachRecipient[];
  defaultCodeEnvRecipients?: OutreachRecipient[];
  oversharedProjectRecipients?: OutreachRecipient[];
  scenarioFrequencyRecipients?: OutreachRecipient[];
  emptyProjectRecipients?: OutreachRecipient[];
  largeFlowRecipients?: OutreachRecipient[];
  orphanNotebookRecipients?: OutreachRecipient[];
  scenarioFailingRecipients?: OutreachRecipient[];
  inactiveProjectRecipients?: OutreachRecipient[];
  unusedCodeEnvRecipients?: OutreachRecipient[];
}

export interface CampaignExemption {
  exemption_id: number;
  campaign_id: CampaignId;
  entity_type: string;
  entity_key: string;
  reason: string | null;
  created_at: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailPreviewItem {
  recipientKey: string;
  owner: string;
  to: string;
  projectKeys: string[];
  codeEnvNames: string[];
  projectKeyForSend?: string | null;
  objectCount: number;
  subject: string;
  body: string;
  usageDetails?: CodeEnvUsageRef[];
}

export interface EmailPreviewResponse {
  campaign: CampaignId;
  template: EmailTemplate;
  previews: EmailPreviewItem[];
  count: number;
}

export interface EmailSendResultItem {
  recipientKey: string;
  to: string;
  projectKeyForSend: string;
  status: 'sent' | 'error';
  error?: string;
}

export interface EmailSendResponse {
  campaign: CampaignId;
  channelId: string;
  requestedCount: number;
  sentCount: number;
  results: EmailSendResultItem[];
}

// User types
export interface User {
  login: string;
  email?: string;
  enabled?: boolean;
  userProfile?: string;
}

// Filesystem info
export interface FilesystemInfo {
  Filesystem: string;
  Size: string;
  Used: string;
  Available: string;
  'Use%': string;
  'Mounted on': string;
}

// Disabled feature info
export interface DisabledFeature {
  status: string;
  description: string;
  url: string;
}

// Log error types
export interface LogError {
  timestamp: string;
  data: string[];
}

export interface LogStats {
  'Total Lines': number;
  'Unique Errors': number;
  'Displayed Errors': number;
}

// Memory info
export type MemoryInfo = Record<string, string>;

// System limits
export type SystemLimits = Record<string, string>;

// Connection counts
export type ConnectionCounts = Record<string, number>;

// Connection detail with optional driver info
export interface ConnectionDetail {
  name: string;
  type: string;
  driverClassName?: string;
}

// User stats
export type UserStats = Record<string, string | number>;

// License properties
export type LicenseProperties = Record<
  string,
  string | { value: string; truncate: boolean; maxLength: number }
>;

// Settings types
export type EnabledSettings = Record<string, boolean>;
export type SparkSettings = Record<string, string | number | boolean>;
export type AuthSettings = Record<
  string,
  string | { value: string; truncate: boolean; maxLength: number }
>;
export type ContainerSettings = Record<string, string | number>;
export type IntegrationSettings = Record<string, string>;
export type ResourceLimits = Record<string, string | number>;
export type CgroupSettings = Record<string, string | number>;
export type ProxySettings = Record<string, string | number | boolean | string[]>;
export type MaxRunningActivities = Record<string, number | string>;
export type JavaMemorySettings = Record<string, string>;

// Instance info from install.ini
export interface InstanceInfo {
  nodeId?: string;
  installId?: string;
  instanceUrl?: string;
}

export interface PluginInfo {
  id: string;
  label?: string;
  installedVersion?: string;
  isDev?: boolean;
}

// Full parsed data structure
export interface ParsedData {
  // Basic info
  company?: string;
  dssVersion?: string;
  pythonVersion?: string;
  diagType?: DiagType;
  lastRestartTime?: string;
  instanceInfo?: InstanceInfo;

  // System info
  cpuCores?: string;
  osInfo?: string;
  memoryInfo?: MemoryInfo;
  systemLimits?: SystemLimits;
  filesystemInfo?: FilesystemInfo[];

  // Settings
  enabledSettings?: EnabledSettings;
  sparkSettings?: SparkSettings;
  authSettings?: AuthSettings;
  containerSettings?: ContainerSettings;
  integrationSettings?: IntegrationSettings;
  resourceLimits?: ResourceLimits;
  cgroupSettings?: CgroupSettings;
  proxySettings?: ProxySettings;
  maxRunningActivities?: MaxRunningActivities;
  javaMemorySettings?: JavaMemorySettings;
  javaMemoryLimits?: JavaMemorySettings;
  disabledFeatures?: Record<string, DisabledFeature>;

  // Data collections
  connections?: ConnectionCounts;
  connectionCounts?: ConnectionCounts;
  connectionDetails?: ConnectionDetail[];
  userStats?: UserStats;
  usersByProjects?: Record<string, string>;
  users?: User[];
  projects?: Project[];
  projectFootprint?: ProjectFootprintRow[];
  projectFootprintSummary?: ProjectFootprintSummary;
  projectFootprintLoading?: LoadingProgressState;
  plugins?: string[];
  pluginDetails?: PluginInfo[];
  pluginsCount?: number;
  codeEnvs?: CodeEnv[];
  codeEnvsLoading?: LoadingProgressState;
  analysisLoading?: LoadingProgressState;
  pythonVersionCounts?: Record<string, number>;
  rVersionCounts?: Record<string, number>;
  clusters?: Cluster[];
  mailChannels?: MailChannel[];

  // License
  license?: Record<string, unknown>;
  licenseInfo?: Record<string, unknown>;
  licenseProperties?: LicenseProperties;
  hasLicenseUsage?: boolean;

  // Logs
  formattedLogErrors?: string;
  rawLogErrors?: LogError[];
  logStats?: LogStats;

  // General settings raw
  generalSettings?: Record<string, unknown>;

  // Directory listing
  dirTree?: DirTreeData;
}

// Context state
export interface DiagState {
  extractedFiles: ExtractedFiles;
  parsedData: ParsedData;
  activeFilter: string;
  layoutMode: LayoutMode;
  isLoading: boolean;
  error: string | null;
  diagType: DiagType;
  rootFiles: string[];
  projectFiles: string[];
  dsshome: string;
  originalFile: File | null; // Original zip file for deferred extraction
  dataSource: DataSource;
  debugLogs: DebugLogEntry[];
}

// Context actions
export type DiagAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_EXTRACTED_FILES'; payload: ExtractedFiles }
  | { type: 'SET_PARSED_DATA'; payload: Partial<ParsedData> }
  | { type: 'SET_ACTIVE_FILTER'; payload: string }
  | { type: 'SET_LAYOUT_MODE'; payload: LayoutMode }
  | { type: 'SET_DIAG_TYPE'; payload: DiagType }
  | { type: 'SET_ROOT_FILES'; payload: string[] }
  | { type: 'SET_PROJECT_FILES'; payload: string[] }
  | { type: 'SET_DSSHOME'; payload: string }
  | { type: 'SET_ORIGINAL_FILE'; payload: File | null }
  | { type: 'SET_DATA_SOURCE'; payload: DataSource }
  | {
      type: 'ADD_DEBUG_LOG';
      payload: Omit<DebugLogEntry, 'id' | 'timestamp'> & { timestamp?: string };
    }
  | { type: 'CLEAR_DEBUG_LOGS' }
  | { type: 'APPEND_PARTIAL_CODE_ENVS'; payload: CodeEnv[] }
  | { type: 'APPEND_PARTIAL_PROJECT_FOOTPRINT'; payload: ProjectFootprintRow[] }
  | { type: 'RESET' };

// Health Score types
export type HealthSeverity = 'critical' | 'warning' | 'info' | 'good';

export type HealthCategory =
  | 'code_envs'
  | 'project_footprint'
  | 'system_capacity'
  | 'security_isolation'
  | 'version_currency'
  | 'runtime_config'
  | 'version'
  | 'license'
  | 'system'
  | 'errors'
  | 'config'
  | 'security';

export interface HealthIssue {
  id: string;
  category: HealthCategory;
  severity: HealthSeverity;
  title: string;
  description: string;
  recommendation?: string;
  docUrl?: string;
  value?: string | number;
  threshold?: string | number;
}

export interface HealthCategoryScore {
  category: HealthCategory;
  label: string;
  score: number;
  weight: number;
  issues: HealthIssue[];
}

export interface HealthScore {
  overall: number;
  status: 'healthy' | 'warning' | 'critical';
  categories: HealthCategoryScore[];
  issues: HealthIssue[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

// Directory tree types for datadir_listing.txt visualization
export interface DirEntry {
  name: string;
  path: string;
  size: number; // Size in bytes (cumulative for dirs - includes hidden children)
  ownSize: number; // Directory's own size (usually 4096) or file size
  isDirectory: boolean;
  children: DirEntry[];
  fileCount: number; // Number of files (recursive for dirs - includes hidden)
  depth: number;
  hasHiddenChildren: boolean; // True if children were aggregated due to depth limit
}

export interface DirTreeData {
  root: DirEntry | null;
  totalSize: number;
  totalFiles: number;
  rootPath: string;
  scope?: 'all' | 'global' | 'unknown' | 'project';
  projectKey?: string | null;
}

// Byte-offset index for fast drill-down into large directory listings
export interface DirIndex {
  path: string;
  startByte: number; // Where this dir's entries begin in the file
  endByte: number; // Where they end (exclusive)
  totalSize: number; // Pre-computed cumulative size
  fileCount: number; // Pre-computed file count
  depth: number; // Depth at which this was indexed
}

// State for the async directory tree loader
export interface DirTreeLoaderState {
  isLoading: boolean;
  progress: number; // 0-100 percentage
  progressText: string; // Human-readable progress
  error: string | null;
  tree: DirTreeData | null;
  index: Map<string, DirIndex>;
}

// =============================================================================
// COMPARISON TYPES
// =============================================================================

export type ToolsTab = 'outreach' | 'code-env-cleaner' | 'project-cleaner' | 'plugins';

export interface PluginCompareRow {
  id: string;
  label: string;
  localVersion: string | null;
  remoteVersion: string | null;
  isDev: boolean;
}

export type PageId =
  | 'summary'
  | 'issues'
  | 'filesystem'
  | 'memory'
  | 'directory'
  | 'projects'
  | 'code-envs'
  | 'connections'
  | 'runtime-config'
  | 'security-config'
  | 'platform-config'
  | 'logs'
  | 'outreach'
  | 'code-env-cleaner'
  | 'project-cleaner'
  | 'plugins'
  | 'tracking'
  | 'settings';

export type AppMode = 'landing' | 'single' | 'comparison' | 'tools' | 'settings';
export type ComparisonViewMode = 'delta' | 'side-by-side' | 'tabbed';
export type DeltaDirection = 'improvement' | 'regression' | 'neutral';
export type DeltaSeverity = 'critical' | 'warning' | 'info';
export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

// A single diagnostic file with all its parsed data
export interface DiagFile {
  id: string;
  filename: string;
  uploadedAt: Date;
  fileSize: number;
  parsedData: ParsedData;
  extractedFiles: ExtractedFiles;
  diagType: DiagType;
  dsshome: string;
  originalFile: File | null;
  healthScore: HealthScore | null;
}

// Delta for a single field comparison
export interface FieldDelta {
  field: string;
  label: string;
  category: string;
  before: unknown;
  after: unknown;
  changeType: ChangeType;
  direction: DeltaDirection;
  severity: DeltaSeverity;
  numericDelta?: number;
  percentChange?: number;
}

// Delta for a collection (arrays of objects)
export interface CollectionDelta<T> {
  added: T[];
  removed: T[];
  modified: Array<{
    before: T;
    after: T;
    changes: string[];
  }>;
  unchanged: number;
}

// Health score delta
export interface HealthDelta {
  before: number;
  after: number;
  change: number;
  direction: DeltaDirection;
}

// A section of deltas grouped by category
export interface DeltaSection {
  id: string;
  label: string;
  icon: string;
  deltas: FieldDelta[];
  changeCount: number;
}

// Full comparison result
export interface ComparisonResult {
  computedAt: Date;
  summary: {
    totalChanges: number;
    improvements: number;
    regressions: number;
    neutral: number;
    critical: number;
    improvementDeltas: FieldDelta[];
    regressionDeltas: FieldDelta[];
  };
  health: HealthDelta;
  sections: {
    critical: DeltaSection;
    system: DeltaSection;
    versions: DeltaSection;
    config: DeltaSection;
    scale: DeltaSection;
    infrastructure: DeltaSection;
  };
  collections: {
    users: CollectionDelta<User>;
    projects: CollectionDelta<Project>;
    clusters: CollectionDelta<Cluster>;
    codeEnvs: CollectionDelta<CodeEnv>;
    plugins: CollectionDelta<string>;
  };
}

// Comparison state
export interface ComparisonState {
  before: DiagFile | null;
  after: DiagFile | null;
  result: ComparisonResult | null;
  viewMode: ComparisonViewMode;
  isProcessingBefore: boolean;
  isProcessingAfter: boolean;
}

// Extended DiagState with comparison support
export interface DiagStateWithComparison extends DiagState {
  mode: AppMode;
  activePage: PageId;
  comparison: ComparisonState;
}

// New actions for comparison
export type ComparisonAction =
  | { type: 'SET_MODE'; payload: AppMode }
  | { type: 'SET_ACTIVE_PAGE'; payload: PageId }
  | { type: 'SET_COMPARISON_FILE'; payload: { slot: 'before' | 'after'; file: DiagFile } }
  | { type: 'CLEAR_COMPARISON_FILE'; payload: 'before' | 'after' }
  | { type: 'SET_COMPARISON_RESULT'; payload: ComparisonResult }
  | { type: 'SET_COMPARISON_VIEW_MODE'; payload: ComparisonViewMode }
  | {
      type: 'SET_COMPARISON_PROCESSING';
      payload: { slot: 'before' | 'after'; isProcessing: boolean };
    }
  | { type: 'RESET_COMPARISON' };

// Combined action type
export type DiagActionWithComparison = DiagAction | ComparisonAction;
