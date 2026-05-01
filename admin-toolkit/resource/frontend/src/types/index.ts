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

export interface ProjectSavedModelRef {
  id: string;
  name: string;
  type: 'PREDICTION' | 'CLUSTERING' | 'UNKNOWN' | string;
  savedModelType?: string;
  backendType?: string;
  predictionType?: string;
  versionsCount?: number;
  activeVersionId?: string;
}

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
  savedModelCount?: number;
  savedModels?: ProjectSavedModelRef[];
  savedModelTypeCounts?: Record<string, number>;
  savedModelSummary?: string;
}

export interface SqlPushdownRecipeFinding {
  recipeName: string;
  recipeType: string;
  connection: string;
  inputs: string[];
  outputs: string[];
}

export interface SqlPushdownProjectFinding {
  projectKey: string;
  projectName: string;
  recipes: SqlPushdownRecipeFinding[];
}

export interface SqlPushdownOwnerGroup {
  ownerLogin: string;
  ownerDisplayName: string;
  ownerEmail: string | null;
  totalRecipes: number;
  projects: SqlPushdownProjectFinding[];
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

// Provisional rows built from streaming usage-check events before full env details land.
export interface ProvisionalCodeEnv {
  name: string;
  usageCount: number;
  statusLabel: string;
  isSkipped?: boolean;
  scanIndex?: number;
  scanTotal?: number;
  updatedAt: string;
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
  configuredMailChannel?: string;
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

// AI Log Analysis types
export interface LlmOption {
  id: string;
  label: string;
  type: string;
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

// Connection health-test result (streamed via SSE)
export interface ConnectionHealthResult {
  name: string;
  type: string;
  status: 'ok' | 'fail' | 'skipped';
  error?: string;
}

export interface SanityCheckMessage {
  severity: 'ERROR' | 'WARNING' | 'INFO' | 'SUCCESS';
  code: string;
  title: string;
  details: string;
  message: string;
  extraInfoSummary?: string | null;
  extraInfoDetails?: string | null;
}

// Connection usage mapping (from /api/connections/usages SSE)
export interface ConnectionDatasetUsage {
  projectKey: string;
  projectName: string;
  datasetName: string;
  datasetType: string;
}

export interface ConnectionLlmUsage {
  projectKey: string;
  projectName: string;
  recipeName: string;
  recipeType: string;
  llmId: string;
}

export interface ConnectionUsageItem {
  name: string;
  type: string;
  projects: ConnectionDatasetUsage[] | ConnectionLlmUsage[];
  projectCount: number;
  datasetCount?: number;
  recipeCount?: number;
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
export interface JekSettings { maxRunningJobs?: number; numberOfReadyJEKs?: number; }

// Instance info from install.ini
export interface InstanceInfo {
  nodeId?: string;
  installId?: string;
  instanceUrl?: string;
  https?: boolean;
  port?: string;
}

// Security & defaults settings rendered as a flat key/value table
export type SecurityDefaultsSettings = Record<string, string | boolean>;

// Per-connection configuration audit result (from /api/connections/audit)
export interface ConnectionAuditResult {
  name: string;
  type: string;
  configIssues: string[];
  severity: 'critical' | 'warning' | 'info';
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
  jekSettings?: JekSettings;
  javaMemorySettings?: JavaMemorySettings;
  javaMemoryLimits?: JavaMemorySettings;
  disabledFeatures?: Record<string, DisabledFeature>;
  securityDefaults?: SecurityDefaultsSettings;
  ldapAuthorizedGroups?: string[];
  connectionAudit?: ConnectionAuditResult[];

  // Data collections
  connections?: ConnectionCounts;
  connectionCounts?: ConnectionCounts;
  connectionDetails?: ConnectionDetail[];
  connectionHealth?: ConnectionHealthResult[];
  connectionHealthTotal?: number | null;
  sanityCheck?: SanityCheckMessage[];
  sanityCheckMaxSeverity?: string | null;
  connectionDatasetUsages?: ConnectionUsageItem[];
  connectionLlmUsages?: ConnectionUsageItem[];
  connectionUsageTotal?: number | null;
  connectionUsageScanned?: number | null;
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
  codeEnvSizes?: Record<string, number>;
  codeEnvsExpectedCount?: number;
  provisionalCodeEnvs?: ProvisionalCodeEnv[];
  codeEnvsLoading?: LoadingProgressState;
  codeEnvsCompare?: CodeEnvCompareResult | null;
  llmAudit?: LlmAuditResponse;
  llmAuditLoading?: LoadingProgressState;
  analysisLoading?: LoadingProgressState;
  pythonVersionCounts?: Record<string, number>;
  rVersionCounts?: Record<string, number>;
  totalEnvCount?: number;
  skippedEnvCount?: number;
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

  // Loading state
  dataReady?: boolean;
  outreachApiLoaded?: boolean;
  outreachData?: OutreachData;

  // Directory listing
  dirTree?: DirTreeData;
}

// Context state
export type FootprintScope = 'dss' | 'project';

export interface ApiDirTreeState {
  isLoading: boolean;
  isExpanding: boolean;
  error: string | null;
  tree: DirTreeData | null;
  expandedNodes: Map<string, DirEntry>;
  scope: FootprintScope;
  projectKey: string;
}

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
  apiDirTree: ApiDirTreeState;
  focusedConnection: string | null;
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
  | { type: 'UPSERT_PROVISIONAL_CODE_ENVS'; payload: ProvisionalCodeEnv[] }
  | { type: 'CLEAR_PROVISIONAL_CODE_ENVS' }
  | { type: 'APPEND_PARTIAL_CODE_ENVS'; payload: CodeEnv[] }
  | { type: 'APPEND_PARTIAL_PROJECT_FOOTPRINT'; payload: ProjectFootprintRow[] }
  | { type: 'SET_API_DIR_TREE'; payload: Partial<ApiDirTreeState> }
  | { type: 'SET_API_DIR_TREE_EXPANDED_NODE'; payload: { path: string; node: DirEntry } }
  | { type: 'SET_FOCUSED_CONNECTION'; payload: string | null }
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
  | 'security'
  | 'connections';

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

// Code Environment Comparison types
export interface CodeEnvCompareGreen {
  envNames: string[];
  packageCount: number;
  pythonVersion: string;
}

export interface CodeEnvComparePurple {
  envNames: string[];
  packageCount: number;
  pythonVersions: Record<string, string>;
}

export interface CodeEnvCompareBlue {
  envNames: string[];
  packageCount: number;
  diffCount: number;
  diffs: Record<string, Record<string, string>>;
}

export interface CodeEnvCompareYellow {
  envA: string;
  envB: string;
  onlyInA: string[];
  onlyInB: string[];
  versionDiffs: Array<{ package: string; versionA: string; versionB: string }>;
}

export interface CodeEnvCompareResult {
  green: CodeEnvCompareGreen[];
  purple: CodeEnvComparePurple[];
  blue: CodeEnvCompareBlue[];
  yellow: CodeEnvCompareYellow[];
  analyzedCount: number;
}

export type ToolsTab = 'outreach' | 'project-cleaner' | 'plugins';

export type LlmAuditStatus = 'current' | 'obsolete' | 'ripoff' | 'unknown' | 'not_applicable';

export interface LlmAuditUsageAsset {
  assetType: 'recipe' | 'notebook' | 'knowledge_bank' | 'agent';
  assetName: string;
  recipeType?: string | null;
}

export interface LlmAuditRow {
  projectKey: string;
  projectName?: string;
  llmId: string;
  friendlyName?: string;
  friendlyNameShort?: string;
  type?: string;
  connection?: string | null;
  rawModel?: string | null;
  effectiveModel?: string | null;
  matchedKey?: string | null;
  status: LlmAuditStatus;
  provider?: string | null;
  family?: string | null;
  currentModel?: string | null;
  modelInputPrice?: number | null;
  modelOutputPrice?: number | null;
  currentInputPrice?: number | null;
  currentOutputPrice?: number | null;
  projectsUsing?: number;
  referencingProjects?: string[];
  usageAssets?: LlmAuditUsageAsset[];
}

export interface LlmAuditSummary {
  llmsTotal: number;
  projectsScanned: number;
  countsByStatus: Record<LlmAuditStatus, number>;
  distinctModelsByStatus: { obsolete: number; ripoff: number };
  pricingFetchedAt?: string | null;
  totalElapsedMs?: number;
}

export interface LlmAuditResponse {
  rows: LlmAuditRow[];
  summary: LlmAuditSummary;
  pricingFetchedAt?: string | null;
  events?: Array<{ tMs: number; level: string; step: string; message: string; projectKey?: string }>;
}

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
  | 'code-envs-comparison'
  | 'connections'
  | 'runtime-config'
  | 'logs'
  | 'sanity-check'
  | 'outreach'
  | 'code-env-cleaner'
  | 'project-cleaner'
  | 'project-compute'
  | 'plugins'
  | 'tracking'
  | 'report'
  | 'db-health'
  | 'trends'
  | 'image-cleaner'
  | 'llm-audit'
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

// =============================================================================
// EXHAUSTIVE TRENDS COMPARISON TYPES
// =============================================================================

export type DatasetSupport = 'full' | 'lifecycle' | 'current_only';
export type DatasetKind = 'scalar' | 'json' | 'text' | 'keyed_table' | 'interval_events' | 'metadata';
export type DatasetCategory = 'run_summary' | 'health_metrics' | 'snapshot_entities' | 'lifecycle' | 'metadata';
export type CompareRowStatus = 'added' | 'removed' | 'changed' | 'unchanged';
export type LifecycleStatus =
  | 'opened_between_runs'
  | 'resolved_between_runs'
  | 'regressed_between_runs'
  | 'existed_in_both'
  | 'visible_only_in_run1'
  | 'visible_only_in_run2'
  | 'event_between_runs'
  | 'before_run2'
  | 'after_run1'
  | 'created_between_runs'
  | 'visible_at_run1'
  | 'visible_at_run2';

export interface CompareDatasetSummary {
  datasetId: string;
  label: string;
  category: DatasetCategory;
  kind: DatasetKind;
  support: DatasetSupport;
  availableInRun1: boolean;
  availableInRun2: boolean;
  run1Count: number;
  run2Count: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  notes: string | null;
}

export interface CompareSummaryDelta {
  run1: number | null;
  run2: number | null;
  delta: number | null;
  pctDelta: number | null;
}

export interface CompareSummaryStats {
  healthScore: CompareSummaryDelta;
  userCount: CompareSummaryDelta;
  enabledUserCount: CompareSummaryDelta;
  projectCount: CompareSummaryDelta;
  pluginCount: CompareSummaryDelta;
  connectionCount: CompareSummaryDelta;
  codeEnvCount: CompareSummaryDelta;
  clusterCount: CompareSummaryDelta;
  coverageStatus: { run1: string | null; run2: string | null };
}

export interface CompareCoverageWarning {
  run: string;
  runId: number;
  type: string;
  section?: string;
  message: string;
}

export interface CompareRunHeader {
  run_id: number;
  run_at: string;
  instance_id: string;
  dss_version: string | null;
  python_version: string | null;
  health_score: number | null;
  health_status: string | null;
  user_count: number | null;
  enabled_user_count: number | null;
  project_count: number | null;
  code_env_count: number | null;
  plugin_count: number | null;
  connection_count: number | null;
  cluster_count: number | null;
  coverage_status: string;
  notes: string | null;
}

export interface CompareManifest {
  run1: CompareRunHeader;
  run2: CompareRunHeader;
  swapped?: boolean;
  summary: CompareSummaryStats;
  datasets: CompareDatasetSummary[];
  coverageWarnings: CompareCoverageWarning[];
}

export interface CompareScalarField {
  field: string;
  kind: 'numeric' | 'string' | 'json' | 'text';
  run1Value: unknown;
  run2Value: unknown;
  status: 'same' | 'changed';
  delta?: number;
  pctDelta?: number;
}

export interface CompareRowDiff {
  status: CompareRowStatus;
  key: Record<string, string>;
  run1: Record<string, unknown> | null;
  run2: Record<string, unknown> | null;
  changes: string[];
  _lifecycle?: LifecycleStatus;
}

export interface CompareDatasetDetail {
  datasetId: string;
  columns: string[];
  keyFields: string[];
  support: DatasetSupport;
  kind: DatasetKind;
  notes: string | null;
  // Scalar datasets
  fields?: CompareScalarField[];
  changed?: number;
  unchanged?: number;
  // Keyed / lifecycle / metadata datasets
  rows?: CompareRowDiff[];
  page?: number;
  pageSize?: number;
  totalRows?: number;
  changeType?: string;
}
