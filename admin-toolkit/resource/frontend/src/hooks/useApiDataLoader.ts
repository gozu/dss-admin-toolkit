import { useEffect, useRef } from 'react';
import { useDiag, DEFAULT_DSSHOME } from '../context/DiagContext';
import { GeneralSettingsParser } from '../parsers/GeneralSettingsParser';
import { JavaMemoryParser } from '../parsers/JavaMemoryParser';
import type {
  ParsedData,
  ConnectionCounts,
  ConnectionDetail,
  User,
  Project,
  MailChannel,
  CodeEnv,
  ProvisionalCodeEnv,
  ProjectFootprintRow,
  PluginInfo,
  OutreachData,
  ConnectionHealthResult,
  LlmAuditResponse,
  ConnectionAuditResult,
} from '../types';
import { fetchJson, fetchText, getBackendUrl } from '../utils/api';
import { prefetchInactiveProjects } from '../components/InactiveProjectCleaner';
import { calculateHealthScore } from './useHealthScore';
import { useProgressInterpolation } from './useProgressInterpolation';

interface OverviewResponse extends Partial<ParsedData> {
  sparkVersion?: string;
}

interface ConnectionsResponse {
  connections?: ConnectionCounts;
  connectionDetails?: ConnectionDetail[];
}

interface UsersResponse {
  userStats?: Record<string, string | number>;
  users?: User[];
}

interface ProjectsResponse {
  projects?: Project[];
}

interface ProjectFootprintResponse {
  projects?: ParsedData['projectFootprint'];
  summary?: ParsedData['projectFootprintSummary'];
}

interface CodeEnvsResponse {
  codeEnvs?: ParsedData['codeEnvs'];
  pythonVersionCounts?: Record<string, number>;
  rVersionCounts?: Record<string, number>;
  totalEnvCount?: number;
  skippedEnvCount?: number;
  summary?: {
    benchmark?: {
      enabled?: boolean;
      projectLimit?: number;
      projectSelection?: string;
      timeoutMs?: number;
      timedOut?: boolean;
      timeoutAtStep?: string | null;
      totalElapsedMs?: number;
      remainingMs?: number;
      selectedProjectCount?: number;
      selectedEnvKeyCount?: number;
      steps?: Array<{ name?: string; elapsedMs?: number; qps?: number; calls?: number }>;
      apiCalls?: Array<{ operation?: string; elapsedMs?: number; qps?: number; calls?: number }>;
      events?: Array<{
        tMs?: number;
        level?: 'info' | 'warn' | 'error';
        step?: string;
        projectKey?: string;
        message?: string;
        elapsedMs?: number;
      }>;
    };
  };
}

interface CodeEnvsProgressResponse {
  runId?: string;
  status?: string;
  error?: string | null;
  droppedUntil?: number;
  next?: number;
  summary?: {
    progressPct?: number;
    phase?: string;
    selectedProjects?: number;
    projectUsageDone?: number;
    envDetailsTotal?: number;
    envDetailsDone?: number;
    timedOut?: boolean;
    timeoutAtStep?: string | null;
    totalElapsedMs?: number;
    remainingMs?: number;
  };
  events?: Array<{
    tMs?: number;
    level?: 'info' | 'warn' | 'error';
    step?: string;
    projectKey?: string;
    message?: string;
    elapsedMs?: number;
  }>;
  partialRows?: Array<Record<string, unknown>>;
  partialRowsNext?: number;
}

interface ProjectFootprintProgressResponse {
  runId?: string;
  status?: string;
  error?: string | null;
  droppedUntil?: number;
  next?: number;
  summary?: {
    progressPct?: number;
    phase?: string;
    selectedProjects?: number;
    projectFootprintDone?: number;
    projectUsageDone?: number;
    projectAggregateDone?: number;
    timedOut?: boolean;
    timeoutAtStep?: string | null;
    totalElapsedMs?: number;
    remainingMs?: number;
  };
  events?: Array<{
    tMs?: number;
    level?: 'info' | 'warn' | 'error';
    step?: string;
    projectKey?: string;
    message?: string;
    elapsedMs?: number;
  }>;
  partialRows?: Array<Record<string, unknown>>;
  partialRowsNext?: number;
}

interface PluginsResponse {
  plugins?: string[];
  pluginDetails?: PluginInfo[];
  pluginsCount?: number;
}

interface MailChannelsResponse {
  channels?: MailChannel[];
}

interface LogErrorsResponse {
  formattedLogErrors?: string;
  rawLogErrors?: ParsedData['rawLogErrors'];
  logStats?: ParsedData['logStats'];
}

export function useApiDataLoader(enabled: boolean, reloadKey = 0) {
  const { dispatch } = useDiag();
  const LIVE_PROGRESS_TIMEOUT_MS = 120000;
  const codeEnvsInterpolationEnabledRef = useRef(false);
  const projectFootprintInterpolationEnabledRef = useRef(false);
  const codeEnvsProgressSetterRef = useRef<((displayValue: number) => void) | null>(null);
  const projectFootprintProgressSetterRef = useRef<((displayValue: number) => void) | null>(null);
  const codeEnvsLastProgressRef = useRef<number | null>(null);
  const projectFootprintLastProgressRef = useRef<number | null>(null);

  const codeEnvsInterpolator = useProgressInterpolation((displayValue) => {
    if (!codeEnvsInterpolationEnabledRef.current) return;
    const setter = codeEnvsProgressSetterRef.current;
    if (!setter) return;
    setter(displayValue);
  });

  const projectFootprintInterpolator = useProgressInterpolation((displayValue) => {
    if (!projectFootprintInterpolationEnabledRef.current) return;
    const setter = projectFootprintProgressSetterRef.current;
    if (!setter) return;
    setter(displayValue);
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const log = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
      dispatch({ type: 'ADD_DEBUG_LOG', payload: { message, scope: 'api-loader', level } });
    };
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const fmtMs = (start: number) => `${Math.round(nowMs() - start)}ms`;
    const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
    const isAbortError = (err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return true;
      if (err instanceof Error && err.name === 'AbortError') return true;
      const message = getErrorMessage(err);
      return /aborted|aborterror/i.test(message);
    };
    const abortPendingRequest = (controller: unknown) => {
      if (
        controller &&
        typeof controller === 'object' &&
        'abort' in controller &&
        typeof controller.abort === 'function'
      ) {
        controller.abort();
      }
    };
    type BenchEventLike = {
      tMs?: number;
      level?: 'info' | 'warn' | 'error';
      step?: string;
      projectKey?: string;
      message?: string;
      elapsedMs?: number;
    };
    const cleanToken = (value: unknown): string => {
      const raw = value == null ? '' : String(value);
      const compact = raw.replace(/\s+/g, ' ').trim();
      if (!compact) return '-';
      return compact.replace(/;/g, ',');
    };
    const benchMs = (value: unknown): string => {
      if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(2)}ms`;
      return '-';
    };
    const benchEventLine = (code: 'ce' | 'pjft', event: BenchEventLike): string => {
      const t = benchMs(event.tMs);
      const key = cleanToken(event.projectKey);
      const step = cleanToken(event.step);
      const message = cleanToken(event.message);
      const elapsed = benchMs(event.elapsedMs);
      if (elapsed !== '-' && message !== '-' && message !== step) {
        return `bench;${code};${t};${key};${step};${elapsed};${message}`;
      }
      if (elapsed !== '-') {
        return `bench;${code};${t};${key};${step};${elapsed}`;
      }
      if (message !== '-' && message !== step) {
        return `bench;${code};${t};${key};${step};${message}`;
      }
      return `bench;${code};${t};${key};${step}`;
    };
    const benchSummaryLine = (code: 'ce' | 'pjft', parts: string[]): string =>
      `bench;${code};summary;${parts.join(';')}`;
    const benchStepLine = (
      code: 'ce' | 'pjft',
      kind: 'step' | 'api',
      name: string,
      calls: number,
      elapsedMs: number,
      qps: number,
    ): string =>
      `bench;${code};${kind};${cleanToken(name)};calls=${calls};elapsed=${benchMs(elapsedMs)};qps=${Number(qps || 0).toFixed(2)}`;
    const shouldLogProgressEvent = (event: {
      level?: 'info' | 'warn' | 'error';
      step?: string;
      projectKey?: string;
    }): boolean => {
      // Always show warnings and errors (including per-project ones)
      const level = event.level === 'warn' || event.level === 'error' ? event.level : 'info';
      if (level !== 'info') return true;
      // Suppress all per-project/per-env info-level events
      if (event.projectKey) return false;
      // Suppress per-env usage check lines (too spammy: 238 lines)
      const step = (event.step || '').replace(/[-\s]/g, '_').toLowerCase();
      if (step === 'code_env_usage_check') return false;
      return true;
    };
    const basicProjectsEnabled = (() => {
      if (typeof window === 'undefined') return false;
      try {
        const query = new URLSearchParams(window.location.search);
        return query.get('basicProjects') === '1';
      } catch {
        return false;
      }
    })();
    const withTimeout = <T>(promise: Promise<T>, label: string, ms: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });

    const endpointTimings: Array<{ label: string; durationMs: number; status: 'ok' | 'fail' | 'skip' }> = [];
    const recordTiming = (label: string, durationMs: number, status: 'ok' | 'fail' | 'skip' = 'ok') => {
      endpointTimings.push({ label, durationMs: Math.round(durationMs), status });
    };

    const run = async () => {
      log(`Diag Parser version v${__APP_VERSION__}`);
      log('Starting live data load');
      log(
        basicProjectsEnabled
          ? 'Basic /api/projects endpoint enabled (query: basicProjects=1)'
          : 'Basic /api/projects endpoint disabled by default (add query basicProjects=1 to re-enable)',
      );
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });
      dispatch({ type: 'SET_DIAG_TYPE', payload: 'instance' });
      dispatch({ type: 'SET_DSSHOME', payload: DEFAULT_DSSHOME });

      try {
        const overviewStart = nowMs();
        const overviewStartTs = new Date().toISOString().slice(11, 19);
        log('GET /api/overview');
        const overview = await fetchJson<OverviewResponse>('/api/overview');
        log(`GET /api/overview OK (${fmtMs(overviewStart)}) [${overviewStartTs}→${new Date().toISOString().slice(11, 19)}]`);
        recordTiming('/api/overview', nowMs() - overviewStart);
        let rawSettings: Record<string, unknown> = {};
        try {
          const settingsStart = nowMs();
          const settingsStartTs = new Date().toISOString().slice(11, 19);
          log('GET /api/settings/raw');
          rawSettings = await fetchJson<Record<string, unknown>>('/api/settings/raw');
          log(`GET /api/settings/raw OK (${fmtMs(settingsStart)}) [${settingsStartTs}→${new Date().toISOString().slice(11, 19)}]`);
          recordTiming('/api/settings/raw', nowMs() - settingsStart);
        } catch {
          log('GET /api/settings/raw failed, continuing with defaults', 'warn');
          rawSettings = {};
        }

        if (cancelled) return;

        let currentParsedData: ParsedData = {
          ...overview,
        };

        if (overview.sparkVersion) {
          currentParsedData.sparkSettings = {
            ...(currentParsedData.sparkSettings || {}),
            'Spark Version': overview.sparkVersion,
          };
        }

        dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
        const setCodeEnvsLoading = (patch: Partial<NonNullable<ParsedData['codeEnvsLoading']>>) => {
          currentParsedData = {
            ...currentParsedData,
            codeEnvsLoading: {
              active: false,
              progressPct: 0,
              ...(currentParsedData.codeEnvsLoading || {}),
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          updateAnalysisLoading();
        };
        codeEnvsProgressSetterRef.current = (displayValue: number) => {
          setCodeEnvsLoading({
            progressPct: Math.max(0, Math.min(100, displayValue)),
          });
        };
        const setProjectFootprintLoading = (
          patch: Partial<NonNullable<ParsedData['projectFootprintLoading']>>,
        ) => {
          currentParsedData = {
            ...currentParsedData,
            projectFootprintLoading: {
              active: false,
              progressPct: 0,
              ...(currentParsedData.projectFootprintLoading || {}),
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          updateAnalysisLoading();
        };
        projectFootprintProgressSetterRef.current = (displayValue: number) => {
          setProjectFootprintLoading({
            progressPct: Math.max(0, Math.min(100, displayValue)),
          });
        };
        const setLlmAuditLoading = (
          patch: Partial<NonNullable<ParsedData['llmAuditLoading']>>,
        ) => {
          currentParsedData = {
            ...currentParsedData,
            llmAuditLoading: {
              active: false,
              progressPct: 0,
              ...(currentParsedData.llmAuditLoading || {}),
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
        };
        const updateAnalysisLoading = () => {
          const ce = currentParsedData.codeEnvsLoading;
          const pjft = currentParsedData.projectFootprintLoading;
          const current = ce?.active ? ce : pjft?.active ? pjft : null;
          currentParsedData = {
            ...currentParsedData,
            analysisLoading: current
              ? { ...current }
              : {
                  active: false,
                  progressPct: 100,
                  phase: 'done',
                  message: 'Analysis complete',
                  updatedAt: new Date().toISOString(),
                },
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
        };
        log('Phase 1 complete (overview + settings)');

        // Phase 2: load secondary data in parallel
        log('Phase 2 starting');
        const timedFetch = <T>(label: string, promise: Promise<T>): Promise<T> => {
          const s = nowMs();
          return promise.then(
            (v) => { recordTiming(label, nowMs() - s); return v; },
            (e) => { recordTiming(label, nowMs() - s, 'fail'); throw e; },
          );
        };
        const phase2 = await Promise.allSettled([
          timedFetch('/api/connections', fetchJson<ConnectionsResponse>('/api/connections')),
          timedFetch('/api/users', fetchJson<UsersResponse>('/api/users')),
          timedFetch('/api/plugins', fetchJson<PluginsResponse>('/api/plugins')),
          timedFetch('/api/java-memory', fetchText('/api/java-memory')),
          timedFetch('/api/mail-channels', fetchJson<MailChannelsResponse>('/api/mail-channels')),
          timedFetch(
            '/api/connections/audit',
            fetchJson<{ connections: ConnectionAuditResult[]; summary: Record<string, number> }>(
              '/api/connections/audit',
            ),
          ),
        ]);

        if (cancelled) return;

        const [connectionsRes, usersRes, pluginsRes, javaMemoryRes, mailChannelsRes, connectionAuditRes] = phase2;

        if (connectionsRes.status === 'fulfilled') {
          currentParsedData = {
            ...currentParsedData,
            connections: connectionsRes.value.connections || {},
            connectionCounts: connectionsRes.value.connections || {},
            connectionDetails: connectionsRes.value.connectionDetails || [],
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log(
            `Loaded connections (${Object.keys(currentParsedData.connections || {}).length} types)`,
          );
        } else {
          log(`Failed /api/connections: ${getErrorMessage(connectionsRes.reason)}`, 'warn');
        }

        if (usersRes.status === 'fulfilled') {
          currentParsedData = {
            ...currentParsedData,
            userStats: usersRes.value.userStats || {},
            users: usersRes.value.users || [],
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log(`Loaded users (${currentParsedData.users?.length || 0})`);
        } else {
          log(`Failed /api/users: ${getErrorMessage(usersRes.reason)}`, 'warn');
        }

        if (pluginsRes.status === 'fulfilled') {
          currentParsedData = {
            ...currentParsedData,
            plugins: pluginsRes.value.plugins || [],
            pluginDetails: pluginsRes.value.pluginDetails || [],
            pluginsCount: pluginsRes.value.pluginsCount || 0,
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log(`Loaded plugins (${currentParsedData.pluginsCount || 0})`);
        } else {
          log(`Failed /api/plugins: ${getErrorMessage(pluginsRes.reason)}`, 'warn');
        }

        if (javaMemoryRes.status === 'fulfilled') {
          const parser = new JavaMemoryParser();
          const result = parser.parse(javaMemoryRes.value, 'env-default.sh');
          currentParsedData = {
            ...currentParsedData,
            javaMemorySettings: result.javaMemorySettings || {},
            javaMemoryLimits: result.javaMemorySettings || {},
            dssVersion: result.dssVersion || overview.dssVersion,
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log('Loaded Java memory settings');
        } else {
          log(`Failed /api/java-memory: ${getErrorMessage(javaMemoryRes.reason)}`, 'warn');
        }

        if (mailChannelsRes.status === 'fulfilled') {
          currentParsedData = {
            ...currentParsedData,
            mailChannels: mailChannelsRes.value.channels || [],
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log(`Loaded mail channels (${currentParsedData.mailChannels?.length || 0})`);
        } else {
          log(`Failed /api/mail-channels: ${getErrorMessage(mailChannelsRes.reason)}`, 'warn');
        }

        if (connectionAuditRes.status === 'fulfilled') {
          const auditFindings = connectionAuditRes.value.connections || [];
          currentParsedData = {
            ...currentParsedData,
            connectionAudit: auditFindings,
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          log(`Loaded connection audit (${auditFindings.length} findings)`);
        } else {
          log(`Failed /api/connections/audit: ${getErrorMessage(connectionAuditRes.reason)}`, 'warn');
        }

        // Apply general settings parser after we have memory and java data
        const settingsParser = new GeneralSettingsParser();
        settingsParser.setExternalData({
          sparkSettings: currentParsedData.sparkSettings,
          memoryInfo: currentParsedData.memoryInfo,
          javaMemorySettings: currentParsedData.javaMemorySettings,
          resourceLimits: currentParsedData.resourceLimits,
        });
        const settingsResult = settingsParser.parse(
          JSON.stringify(rawSettings),
          'general-settings.json',
        );

        currentParsedData = {
          ...currentParsedData,
          generalSettings: settingsResult.generalSettings || {},
          enabledSettings: settingsResult.enabledSettings || {},
          sparkSettings: {
            ...(currentParsedData.sparkSettings || {}),
            ...(settingsResult.sparkSettings || {}),
          },
          maxRunningActivities: settingsResult.maxRunningActivities || {},
          authSettings: settingsResult.authSettings || {},
          containerSettings: settingsResult.containerSettings || {},
          integrationSettings: settingsResult.integrationSettings || {},
          resourceLimits: settingsResult.resourceLimits || {},
          cgroupSettings: settingsResult.cgroupSettings || {},
          proxySettings: settingsResult.proxySettings || {},
          disabledFeatures: settingsResult.disabledFeatures || {},
          securityDefaults: settingsResult.securityDefaults || {},
          ldapAuthorizedGroups: settingsResult.ldapAuthorizedGroups || [],
        };
        dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
        log('Applied GeneralSettings parser');

        // Allow UI to render after core data is available
        dispatch({ type: 'SET_LOADING', payload: false });
        log('Core data ready, released loading state');

        // Fetch backend settings for configurable timeouts
        let beSettings: Record<string, number> = {};
        try {
          beSettings = await fetchJson<{ current: Record<string, number>; defaults: Record<string, number> }>('/api/settings').then((d) => d.current);
          log('Backend settings loaded');
        } catch { log('Backend settings fetch failed, using defaults', 'warn'); }

        // Phase 3: heavier endpoints
        log('Phase 3 starting');
        const timed = <T>(path: string, timeoutMs: number): Promise<T> => {
          const started = nowMs();
          const startTs = new Date().toISOString().slice(11, 19);
          log(`GET ${path}`);
          return withTimeout(fetchJson<T>(path), path, timeoutMs).then(
            (value) => {
              log(`GET ${path} OK (${fmtMs(started)}) [${startTs}→${new Date().toISOString().slice(11, 19)}]`);
              recordTiming(path, nowMs() - started);
              return value;
            },
            (err) => {
              log(`GET ${path} FAIL (${fmtMs(started)}) [${startTs}→${new Date().toISOString().slice(11, 19)}]`);
              recordTiming(path, nowMs() - started, 'fail');
              throw err;
            },
          );
        };
        const settle = async <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> => {
          try {
            const value = await promise;
            return { status: 'fulfilled', value };
          } catch (reason) {
            return { status: 'rejected', reason };
          }
        };
        const settledError = (result: PromiseSettledResult<unknown>) =>
          result.status === 'rejected' ? getErrorMessage(result.reason) : 'no payload';

        let codeEnvsDone = false;
        let projectFootprintDone = false;
        let projectFootprintStarted = false;
        const slowHeavyTimer = setTimeout(() => {
          const waiting: string[] = [];
          if (!codeEnvsDone) waiting.push('/api/code-envs');
          if (projectFootprintStarted && !projectFootprintDone)
            waiting.push('/api/project-footprint');
          if (waiting.length > 0) {
            log(`Heavy endpoints still loading after 8000ms: ${waiting.join(', ')}`, 'warn');
          }
        }, 8000);

        const deferredTails: Promise<unknown>[] = [];

        const runCodeEnvs = async () => {
          codeEnvsInterpolationEnabledRef.current = true;
          codeEnvsLastProgressRef.current = null;
          codeEnvsInterpolator.reset(0);
          dispatch({ type: 'CLEAR_PROVISIONAL_CODE_ENVS' });
          currentParsedData = {
            ...currentParsedData,
            codeEnvsExpectedCount: undefined,
          };
          dispatch({ type: 'SET_PARSED_DATA', payload: { codeEnvsExpectedCount: undefined } });
          let codeEnvsProgressActive = true;
          // Use a sentinel so the first poll returns only the current run id (status=replaced),
          // avoiding replay of stale events from previous runs.
          let codeEnvsProgressRunId: string | undefined = '__pending__';
          let codeEnvsProgressCursor = 0;
          let codeEnvsProgressEventsSeen = 0;
          let codeEnvsProgressWarned = false;
          let codeEnvsProgressAbortController: AbortController | null = null;
          let codeEnvsUsageScanTotal: number | null = null;
          const codeEnvsProgressPath = '/api/code-envs/progress';
          let codeEnvsProgressPathLogged = false;
          setCodeEnvsLoading({
            active: true,
            progressPct: 0,
            phase: 'starting',
            message: 'Starting code env analysis',
            startedAt: new Date().toISOString(),
          });
          const seenCodeEnvEventKeys = new Set<string>();
          const progressEventKey = (event: {
            tMs?: number;
            step?: string;
            projectKey?: string;
            message?: string;
            elapsedMs?: number;
          }) =>
            `${event.tMs ?? ''}|${event.step ?? ''}|${event.projectKey ?? ''}|${event.message ?? ''}|${event.elapsedMs ?? ''}`;
          const setExpectedCodeEnvCount = (nextCount: number | null | undefined) => {
            const normalized =
              typeof nextCount === 'number' && Number.isFinite(nextCount) && nextCount >= 0
                ? Math.floor(nextCount)
                : undefined;
            if (currentParsedData.codeEnvsExpectedCount === normalized) return;
            currentParsedData = {
              ...currentParsedData,
              codeEnvsExpectedCount: normalized,
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: { codeEnvsExpectedCount: normalized } });
          };
          const parseUsageCheckMessage = (message: string) => {
            const match = message.match(/^\[(\d+)\/(\d+)\]\s+(.+?)\s+[\u2014\u2013-]\s+(.+)$/u);
            if (!match) return null;
            const scanIndex = Number.parseInt(match[1], 10);
            const scanTotal = Number.parseInt(match[2], 10);
            const name = match[3].trim();
            const status = match[4].trim();
            const isSkipped = /skipped/i.test(status);
            const usageMatch = status.match(/(\d+)\s+usage\(s\)/i);
            const usageCount = /unused/i.test(status)
              ? 0
              : usageMatch
                ? Number.parseInt(usageMatch[1], 10)
                : NaN;
            return {
              scanIndex: Number.isFinite(scanIndex) ? scanIndex : undefined,
              scanTotal: Number.isFinite(scanTotal) ? scanTotal : undefined,
              name,
              status,
              isSkipped,
              usageCount: Number.isFinite(usageCount) ? Math.max(0, usageCount) : null,
            };
          };
          const toProvisionalRow = (parsed: {
            scanIndex?: number;
            scanTotal?: number;
            name: string;
            status: string;
            isSkipped: boolean;
            usageCount: number | null;
          }): ProvisionalCodeEnv | null => {
            if (!parsed.name) return null;
            if (parsed.isSkipped) {
              return {
                name: parsed.name,
                usageCount: -1,
                statusLabel: parsed.status,
                isSkipped: true,
                scanIndex: parsed.scanIndex,
                scanTotal: parsed.scanTotal,
                updatedAt: new Date().toISOString(),
              };
            }
            if (parsed.usageCount == null) return null;
            return {
              name: parsed.name,
              usageCount: parsed.usageCount,
              statusLabel: parsed.status,
              scanIndex: parsed.scanIndex,
              scanTotal: parsed.scanTotal,
              updatedAt: new Date().toISOString(),
            };
          };
          const replayCodeEnvProgressEvents = (events: Array<BenchEventLike>) => {
            const provisionalRows: ProvisionalCodeEnv[] = [];
            events.forEach((event) => {
              const key = progressEventKey(event);
              if (seenCodeEnvEventKeys.has(key)) return;
              seenCodeEnvEventKeys.add(key);
              const normalizedStep = String(event.step || '')
                .trim()
                .toLowerCase();
              if (normalizedStep === 'code_env_usage_scan_start') {
                const startMatch = String(event.message || '').match(/checking\s+(\d+)\s+code envs/i);
                const scannedTotal = startMatch ? Number.parseInt(startMatch[1], 10) : NaN;
                if (Number.isFinite(scannedTotal) && scannedTotal > 0) {
                  codeEnvsUsageScanTotal = scannedTotal;
                }
              }
              if (normalizedStep === 'code_env_usage_check') {
                const parsed = parseUsageCheckMessage(String(event.message || '').trim());
                if (parsed) {
                  if (typeof parsed.scanTotal === 'number' && parsed.scanTotal > 0) {
                    codeEnvsUsageScanTotal = parsed.scanTotal;
                  }
                  const provisional = toProvisionalRow(parsed);
                  if (provisional) provisionalRows.push(provisional);
                }
              }
              if (shouldLogProgressEvent(event)) {
                codeEnvsProgressEventsSeen += 1;
                const eventLevel =
                  event.level === 'warn' || event.level === 'error' ? event.level : 'info';
                log(benchEventLine('ce', event), eventLevel);
              }
            });
            if (codeEnvsUsageScanTotal != null) {
              const expectedFromScan = Math.max(0, codeEnvsUsageScanTotal);
              setExpectedCodeEnvCount(expectedFromScan);
            }
            if (provisionalRows.length > 0) {
              dispatch({ type: 'UPSERT_PROVISIONAL_CODE_ENVS', payload: provisionalRows });
            }
          };

          let codeEnvsRowsSince = 0;
          const codeEnvsPartialBuffer: CodeEnv[] = [];
          const pollCodeEnvProgress = async () => {
            while (!cancelled && codeEnvsProgressActive) {
              try {
                const query = new URLSearchParams();
                query.set('since', String(codeEnvsProgressCursor));
                query.set('rowsSince', String(codeEnvsRowsSince));
                if (codeEnvsProgressRunId) {
                  query.set('runId', codeEnvsProgressRunId);
                }
                codeEnvsProgressAbortController = new AbortController();
                if (!codeEnvsProgressPathLogged) {
                  log(`bench;ce;progress;path=${codeEnvsProgressPath}`);
                  codeEnvsProgressPathLogged = true;
                }
                const payload = await withTimeout(
                  fetchJson<CodeEnvsProgressResponse>(
                    `${codeEnvsProgressPath}?${query.toString()}`,
                    { signal: codeEnvsProgressAbortController.signal },
                  ),
                  codeEnvsProgressPath,
                  LIVE_PROGRESS_TIMEOUT_MS,
                );
                const progressSummary = payload.summary || {};
                const progressPct = Math.max(
                  0,
                  Math.min(
                    100,
                    Number.isFinite(progressSummary.progressPct as number)
                      ? Number(progressSummary.progressPct)
                      : 0,
                  ),
                );
                const phase = (progressSummary.phase || 'running').toString();
                const envDetailsTotal = Number(progressSummary.envDetailsTotal || 0);
                const envDetailsDone = Number(progressSummary.envDetailsDone || 0);
                if (envDetailsTotal > 0) {
                  setExpectedCodeEnvCount(envDetailsTotal);
                }
                const phaseText = phase.replace(/_/g, ' ');
                const doneEnvs =
                  envDetailsTotal > 0 ? Math.min(envDetailsTotal, Math.max(0, envDetailsDone)) : 0;
                const detail =
                  envDetailsTotal > 0
                    ? `${doneEnvs}/${envDetailsTotal} envs`
                    : '';
                setCodeEnvsLoading({
                  active: true,
                  phase,
                  message: detail
                    ? `Code env analysis: ${phaseText} (${detail})`
                    : `Code env analysis: ${phaseText}`,
                });
                if (codeEnvsLastProgressRef.current !== progressPct) {
                  codeEnvsLastProgressRef.current = progressPct;
                  codeEnvsInterpolator.setBackendProgress(progressPct);
                }
                if (payload.runId && payload.runId !== codeEnvsProgressRunId) {
                  codeEnvsProgressRunId = payload.runId;
                  codeEnvsProgressCursor = 0;
                  codeEnvsRowsSince = 0;
                  codeEnvsPartialBuffer.length = 0;
                  codeEnvsUsageScanTotal = null;
                  seenCodeEnvEventKeys.clear();
                  codeEnvsProgressEventsSeen = 0;
                  setExpectedCodeEnvCount(undefined);
                  dispatch({ type: 'CLEAR_PROVISIONAL_CODE_ENVS' });
                  continue;
                }
                const nextCursor =
                  typeof payload.next === 'number' ? payload.next : codeEnvsProgressCursor;
                if (Array.isArray(payload.events) && payload.events.length > 0) {
                  replayCodeEnvProgressEvents(payload.events);
                }
                codeEnvsProgressCursor = nextCursor;
                if (Array.isArray(payload.partialRows) && payload.partialRows.length > 0) {
                  const rows = payload.partialRows as unknown as CodeEnv[];
                  codeEnvsPartialBuffer.push(...rows);
                  dispatch({ type: 'APPEND_PARTIAL_CODE_ENVS', payload: rows });
                }
                if (typeof payload.partialRowsNext === 'number') {
                  codeEnvsRowsSince = payload.partialRowsNext;
                }
                if (payload.status === 'error' && payload.error) {
                  log(`bench;ce;progress-error;${cleanToken(payload.error)}`, 'error');
                }
              } catch (err) {
                if ((!codeEnvsProgressActive || cancelled) && isAbortError(err)) {
                  break;
                }
                if (!codeEnvsProgressWarned) {
                  codeEnvsProgressWarned = true;
                  log(
                    `Code env live progress polling unavailable: ${getErrorMessage(err)}`,
                    'warn',
                  );
                }
              } finally {
                codeEnvsProgressAbortController = null;
              }
              if (!codeEnvsProgressActive) break;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          };

          const codeEnvsProgressPromise = pollCodeEnvProgress();
          const codeEnvsRes = await settle(timed<CodeEnvsResponse>('/api/code-envs', beSettings.fe_timeout_code_envs ?? 620000));
          codeEnvsProgressActive = false;
          abortPendingRequest(codeEnvsProgressAbortController);
          await codeEnvsProgressPromise;
          codeEnvsDone = true;
          if (cancelled) return;
          if (codeEnvsRes.status === 'fulfilled' && codeEnvsRes.value) {
            currentParsedData = {
              ...currentParsedData,
              codeEnvs: codeEnvsRes.value.codeEnvs || [],
              codeEnvsExpectedCount: (codeEnvsRes.value.codeEnvs || []).length,
              pythonVersionCounts: codeEnvsRes.value.pythonVersionCounts || {},
              rVersionCounts: codeEnvsRes.value.rVersionCounts || {},
              totalEnvCount: codeEnvsRes.value.totalEnvCount,
              skippedEnvCount: codeEnvsRes.value.skippedEnvCount,
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            dispatch({ type: 'CLEAR_PROVISIONAL_CODE_ENVS' });
            setCodeEnvsLoading({
              active: false,
              progressPct: 100,
              phase: 'done',
              message: 'Code env analysis completed',
            });
            deferredTails.push(
              fetchJson<{ sizes: Record<string, number> }>('/api/code-envs/sizes')
                .then((r) => {
                  if (r?.sizes && typeof r.sizes === 'object') {
                    dispatch({ type: 'SET_PARSED_DATA', payload: { codeEnvSizes: r.sizes } });
                  }
                  log('Pre-warming /api/dir-tree after global footprint');
                  fetchJson('/api/dir-tree?maxDepth=3&scope=dss').catch(() => { /* pre-warm optional */ });
                })
                .catch(() => { /* sizes optional */ }),
            );
            codeEnvsInterpolator.setBackendProgress(100);
            codeEnvsLastProgressRef.current = 100;
            codeEnvsInterpolationEnabledRef.current = false;
            log(`Loaded code envs (${currentParsedData.codeEnvs?.length || 0})`);
            const benchmark = codeEnvsRes.value.summary?.benchmark;
            if (benchmark?.enabled) {
              log(
                benchSummaryLine('ce', [
                  `limit=${benchmark.projectLimit ?? '?'}`,
                  `selection=${cleanToken(benchmark.projectSelection ?? 'n/a')}`,
                  `elapsed=${benchMs(benchmark.totalElapsedMs)}`,
                  `timeout=${benchmark.timeoutMs ?? 0}ms`,
                  `timedOut=${Boolean(benchmark.timedOut)}`,
                  `selectedProjects=${benchmark.selectedProjectCount ?? '?'}`,
                  `selectedEnvKeys=${benchmark.selectedEnvKeyCount ?? '?'}`,
                ]),
              );
              const slowSteps = (benchmark.steps || [])
                .filter((step) => typeof step.elapsedMs === 'number')
                .sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))
                .slice(0, 8);
              slowSteps.forEach((step) => {
                log(
                  benchStepLine(
                    'ce',
                    'step',
                    step.name || 'unknown',
                    step.calls ?? 0,
                    step.elapsedMs ?? 0,
                    step.qps ?? 0,
                  ),
                );
              });
              const slowOps = (benchmark.apiCalls || [])
                .filter((op) => typeof op.elapsedMs === 'number')
                .sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))
                .slice(0, 8);
              slowOps.forEach((op) => {
                log(
                  benchStepLine(
                    'ce',
                    'api',
                    op.operation || 'unknown',
                    op.calls ?? 0,
                    op.elapsedMs ?? 0,
                    op.qps ?? 0,
                  ),
                );
              });
              if (codeEnvsProgressEventsSeen > 0) {
                log(`bench;ce;progress-events;count=${codeEnvsProgressEventsSeen}`);
              } else {
                replayCodeEnvProgressEvents(benchmark.events || []);
              }
            }
          } else {
            codeEnvsInterpolationEnabledRef.current = false;
            if (codeEnvsPartialBuffer.length > 0) {
              currentParsedData = {
                ...currentParsedData,
                codeEnvs: codeEnvsPartialBuffer,
                codeEnvsExpectedCount: codeEnvsPartialBuffer.length,
              };
              dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
              dispatch({ type: 'CLEAR_PROVISIONAL_CODE_ENVS' });
              setCodeEnvsLoading({
                active: false,
                progressPct: 100,
                phase: 'done',
                message: `Code env analysis completed (${codeEnvsPartialBuffer.length} envs from progress)`,
              });
              deferredTails.push(
                fetchJson<{ sizes: Record<string, number> }>('/api/code-envs/sizes')
                  .then((r) => {
                    if (r?.sizes && typeof r.sizes === 'object') {
                      dispatch({ type: 'SET_PARSED_DATA', payload: { codeEnvSizes: r.sizes } });
                    }
                    log('Pre-warming /api/dir-tree after global footprint');
                    fetchJson('/api/dir-tree?maxDepth=3&scope=dss').catch(() => { /* pre-warm optional */ });
                  })
                  .catch(() => { /* sizes optional */ }),
              );
              log(`Failed /api/code-envs but recovered ${codeEnvsPartialBuffer.length} envs from progress`, 'warn');
            } else {
              dispatch({ type: 'CLEAR_PROVISIONAL_CODE_ENVS' });
              setCodeEnvsLoading({
                active: false,
                progressPct: 0,
                phase: 'error',
                message: 'Code env analysis failed',
              });
            }
            log(`Failed /api/code-envs: ${settledError(codeEnvsRes)}`, 'warn');
          }
        };

        const runProjectFootprint = async () => {
          projectFootprintInterpolationEnabledRef.current = true;
          projectFootprintLastProgressRef.current = null;
          projectFootprintInterpolator.reset(0);
          let projectFootprintProgressActive = true;
          let projectFootprintProgressAbortController: AbortController | null = null;
          // Use a sentinel so the first poll only syncs run id (status=replaced) instead of replaying stale events.
          let projectFootprintProgressRunId: string | undefined = '__pending__';
          let projectFootprintProgressCursor = 0;
          let projectFootprintProgressWarned = false;
          const projectFootprintProgressPath = '/api/project-footprint/progress';
          const seenProjectProgressEventKeys = new Set<string>();
          let projectUsageScanTotal: number | null = null;
          setProjectFootprintLoading({
            active: true,
            progressPct: 0,
            phase: 'starting',
            message: 'Starting project analysis',
            startedAt: new Date().toISOString(),
          });
          const projectProgressEventKey = (event: {
            tMs?: number;
            step?: string;
            projectKey?: string;
            message?: string;
            elapsedMs?: number;
          }) =>
            `${event.tMs ?? ''}|${event.step ?? ''}|${event.projectKey ?? ''}|${event.message ?? ''}|${event.elapsedMs ?? ''}`;
          const setExpectedCodeEnvCountFromProject = (nextCount: number | null | undefined) => {
            const normalized =
              typeof nextCount === 'number' && Number.isFinite(nextCount) && nextCount >= 0
                ? Math.floor(nextCount)
                : undefined;
            if (currentParsedData.codeEnvsExpectedCount === normalized) return;
            currentParsedData = {
              ...currentParsedData,
              codeEnvsExpectedCount: normalized,
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: { codeEnvsExpectedCount: normalized } });
          };
          const parseProjectUsageCheckMessage = (message: string) => {
            const match = message.match(/^\[(\d+)\/(\d+)\]\s+(.+?)\s+[\u2014\u2013-]\s+(.+)$/u);
            if (!match) return null;
            const scanIndex = Number.parseInt(match[1], 10);
            const scanTotal = Number.parseInt(match[2], 10);
            const name = match[3].trim();
            const status = match[4].trim();
            const isSkipped = /skipped/i.test(status);
            const usageMatch = status.match(/(\d+)\s+usage\(s\)/i);
            const usageCount = /unused/i.test(status)
              ? 0
              : usageMatch
                ? Number.parseInt(usageMatch[1], 10)
                : NaN;
            return {
              scanIndex: Number.isFinite(scanIndex) ? scanIndex : undefined,
              scanTotal: Number.isFinite(scanTotal) ? scanTotal : undefined,
              name,
              status,
              isSkipped,
              usageCount: Number.isFinite(usageCount) ? Math.max(0, usageCount) : null,
            };
          };
          const toProjectProvisionalRow = (parsed: {
            scanIndex?: number;
            scanTotal?: number;
            name: string;
            status: string;
            isSkipped: boolean;
            usageCount: number | null;
          }): ProvisionalCodeEnv | null => {
            if (!parsed.name) return null;
            if (parsed.isSkipped) {
              return {
                name: parsed.name,
                usageCount: -1,
                statusLabel: parsed.status,
                isSkipped: true,
                scanIndex: parsed.scanIndex,
                scanTotal: parsed.scanTotal,
                updatedAt: new Date().toISOString(),
              };
            }
            if (parsed.usageCount == null) return null;
            return {
              name: parsed.name,
              usageCount: parsed.usageCount,
              statusLabel: parsed.status,
              scanIndex: parsed.scanIndex,
              scanTotal: parsed.scanTotal,
              updatedAt: new Date().toISOString(),
            };
          };
          const replayProjectProgressEvents = (events: Array<BenchEventLike>) => {
            const provisionalRows: ProvisionalCodeEnv[] = [];
            events.forEach((event) => {
              const key = projectProgressEventKey(event);
              if (seenProjectProgressEventKeys.has(key)) return;
              seenProjectProgressEventKeys.add(key);
              const normalizedStep = String(event.step || '')
                .trim()
                .toLowerCase();
              if (normalizedStep === 'code_env_usage_scan_start') {
                const startMatch = String(event.message || '').match(/checking\s+(\d+)\s+code envs/i);
                const scannedTotal = startMatch ? Number.parseInt(startMatch[1], 10) : NaN;
                if (Number.isFinite(scannedTotal) && scannedTotal > 0) {
                  projectUsageScanTotal = scannedTotal;
                }
              }
              if (normalizedStep === 'code_env_usage_check') {
                const parsed = parseProjectUsageCheckMessage(String(event.message || '').trim());
                if (parsed) {
                  if (typeof parsed.scanTotal === 'number' && parsed.scanTotal > 0) {
                    projectUsageScanTotal = parsed.scanTotal;
                  }
                  const provisional = toProjectProvisionalRow(parsed);
                  if (provisional) provisionalRows.push(provisional);
                }
              }
              if (shouldLogProgressEvent(event)) {
                const eventLevel =
                  event.level === 'warn' || event.level === 'error' ? event.level : 'info';
                log(benchEventLine('pjft', event), eventLevel);
              }
            });
            if (projectUsageScanTotal != null) {
              const expectedFromScan = Math.max(0, projectUsageScanTotal);
              setExpectedCodeEnvCountFromProject(expectedFromScan);
            }
            if (provisionalRows.length > 0) {
              dispatch({ type: 'UPSERT_PROVISIONAL_CODE_ENVS', payload: provisionalRows });
            }
          };

          let projectFootprintRowsSince = 0;
          const pollProjectFootprintProgress = async () => {
            while (!cancelled && projectFootprintProgressActive) {
              try {
                const query = new URLSearchParams();
                query.set('since', String(projectFootprintProgressCursor));
                query.set('rowsSince', String(projectFootprintRowsSince));
                if (projectFootprintProgressRunId) {
                  query.set('runId', projectFootprintProgressRunId);
                }
                projectFootprintProgressAbortController = new AbortController();
                const payload = await withTimeout(
                  fetchJson<ProjectFootprintProgressResponse>(
                    `${projectFootprintProgressPath}?${query.toString()}`,
                    { signal: projectFootprintProgressAbortController.signal },
                  ),
                  projectFootprintProgressPath,
                  LIVE_PROGRESS_TIMEOUT_MS,
                );
                if (payload.runId && payload.runId !== projectFootprintProgressRunId) {
                  projectFootprintProgressRunId = payload.runId;
                  projectFootprintProgressCursor = 0;
                  projectFootprintRowsSince = 0;
                  seenProjectProgressEventKeys.clear();
                  projectUsageScanTotal = null;
                  continue;
                }
                const nextCursor =
                  typeof payload.next === 'number' ? payload.next : projectFootprintProgressCursor;
                projectFootprintProgressCursor = nextCursor;
                const progressSummary = payload.summary || {};
                const progressPct = Math.max(
                  0,
                  Math.min(
                    100,
                    Number.isFinite(progressSummary.progressPct as number)
                      ? Number(progressSummary.progressPct)
                      : 0,
                  ),
                );
                const phase = (progressSummary.phase || 'running').toString();
                const selectedProjects = Number(progressSummary.selectedProjects || 0);
                const footprintDone = Number(progressSummary.projectFootprintDone || 0);
                const usageDone = Number(progressSummary.projectUsageDone || 0);
                const aggregateDone = Number(progressSummary.projectAggregateDone || 0);
                const doneProjects =
                  selectedProjects > 0
                    ? Math.min(selectedProjects, Math.max(footprintDone, usageDone, aggregateDone))
                    : 0;
                const phaseText = phase.replace(/_/g, ' ');
                const detail =
                  selectedProjects > 0 ? `${doneProjects}/${selectedProjects} projects` : '';
                setProjectFootprintLoading({
                  active: true,
                  phase,
                  message: detail
                    ? `Project analysis: ${phaseText} (${detail})`
                    : `Project analysis: ${phaseText}`,
                });
                if (projectFootprintLastProgressRef.current !== progressPct) {
                  projectFootprintLastProgressRef.current = progressPct;
                  projectFootprintInterpolator.setBackendProgress(progressPct);
                }
                if (Array.isArray(payload.events) && payload.events.length > 0) {
                  replayProjectProgressEvents(payload.events);
                }
                if (Array.isArray(payload.partialRows) && payload.partialRows.length > 0) {
                  const rows = payload.partialRows as unknown as ProjectFootprintRow[];
                  dispatch({ type: 'APPEND_PARTIAL_PROJECT_FOOTPRINT', payload: rows });
                }
                if (typeof payload.partialRowsNext === 'number') {
                  projectFootprintRowsSince = payload.partialRowsNext;
                }
              } catch (err) {
                if ((!projectFootprintProgressActive || cancelled) && isAbortError(err)) {
                  break;
                }
                if (!projectFootprintProgressWarned) {
                  projectFootprintProgressWarned = true;
                  log(
                    `Project footprint live progress polling unavailable: ${getErrorMessage(err)}`,
                    'warn',
                  );
                }
              } finally {
                projectFootprintProgressAbortController = null;
              }
              if (!projectFootprintProgressActive) break;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          };

          const projectFootprintProgressPromise = pollProjectFootprintProgress();
          const projectFootprintRes = await settle(
            timed<ProjectFootprintResponse>('/api/project-footprint', beSettings.fe_timeout_project_footprint ?? 620000),
          );
          projectFootprintProgressActive = false;
          abortPendingRequest(projectFootprintProgressAbortController);
          await projectFootprintProgressPromise;
          projectFootprintDone = true;
          if (cancelled) return;
          if (projectFootprintRes.status === 'fulfilled' && projectFootprintRes.value) {
            currentParsedData = {
              ...currentParsedData,
              projectFootprint: projectFootprintRes.value.projects || [],
              projectFootprintSummary: projectFootprintRes.value.summary,
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            setProjectFootprintLoading({
              active: false,
              progressPct: 100,
              phase: 'done',
              message: 'Project analysis completed',
            });
            projectFootprintInterpolator.setBackendProgress(100);
            projectFootprintLastProgressRef.current = 100;
            projectFootprintInterpolationEnabledRef.current = false;
            log(
              `Loaded project footprint (${currentParsedData.projectFootprint?.length || 0} projects)`,
            );
            const benchmark = (
              projectFootprintRes.value.summary as Record<string, unknown> | undefined
            )?.benchmark as
              | {
                  enabled?: boolean;
                  projectLimit?: number;
                  projectSelection?: string;
                  timeoutMs?: number;
                  timedOut?: boolean;
                  totalElapsedMs?: number;
                  steps?: Array<{
                    name?: string;
                    elapsedMs?: number;
                    qps?: number;
                    calls?: number;
                  }>;
                  apiCalls?: Array<{
                    operation?: string;
                    elapsedMs?: number;
                    qps?: number;
                    calls?: number;
                  }>;
                  events?: Array<{
                    tMs?: number;
                    level?: 'info' | 'warn' | 'error';
                    step?: string;
                    projectKey?: string;
                    message?: string;
                    elapsedMs?: number;
                  }>;
                }
              | undefined;
            if (benchmark?.enabled) {
              log(
                benchSummaryLine('pjft', [
                  `limit=${benchmark.projectLimit ?? '?'}`,
                  `selection=${cleanToken(benchmark.projectSelection ?? 'n/a')}`,
                  `elapsed=${benchMs(benchmark.totalElapsedMs)}`,
                  `timeout=${benchmark.timeoutMs ?? 0}ms`,
                  `timedOut=${Boolean(benchmark.timedOut)}`,
                  `rows=${currentParsedData.projectFootprint?.length || 0}`,
                ]),
              );
              const slowStep = (benchmark.steps || [])
                .filter((step) => typeof step.elapsedMs === 'number')
                .sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))
                .slice(0, 3);
              slowStep.forEach((step) => {
                log(
                  benchStepLine(
                    'pjft',
                    'step',
                    step.name || 'unknown',
                    step.calls ?? 0,
                    step.elapsedMs ?? 0,
                    step.qps ?? 0,
                  ),
                );
              });
              const slowOps = (benchmark.apiCalls || [])
                .filter((op) => typeof op.elapsedMs === 'number')
                .sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))
                .slice(0, 5);
              slowOps.forEach((op) => {
                log(
                  benchStepLine(
                    'pjft',
                    'api',
                    op.operation || 'unknown',
                    op.calls ?? 0,
                    op.elapsedMs ?? 0,
                    op.qps ?? 0,
                  ),
                );
              });
              replayProjectProgressEvents(benchmark.events || []);
            }
          } else {
            projectFootprintInterpolationEnabledRef.current = false;
            setProjectFootprintLoading({
              active: false,
              progressPct: 0,
              phase: 'error',
              message: 'Project analysis failed',
            });
            log(`Failed /api/project-footprint: ${settledError(projectFootprintRes)}`, 'warn');
          }
        };

        const runLlmAudit = async () => {
          let llmAuditProgressActive = true;
          let llmAuditProgressRunId: string | undefined = '__pending__';
          let llmAuditProgressCursor = 0;
          let llmAuditProgressAbortController: AbortController | null = null;
          let llmAuditProgressWarned = false;
          const llmAuditProgressPath = '/api/llm-audit/progress';
          setLlmAuditLoading({
            active: true,
            progressPct: 0,
            phase: 'starting',
            message: 'Starting LLM model audit',
            startedAt: new Date().toISOString(),
          });

          const pollLlmAuditProgress = async () => {
            while (!cancelled && llmAuditProgressActive) {
              try {
                const query = new URLSearchParams();
                query.set('since', String(llmAuditProgressCursor));
                if (llmAuditProgressRunId) query.set('runId', llmAuditProgressRunId);
                llmAuditProgressAbortController = new AbortController();
                const payload = await withTimeout(
                  fetchJson<{
                    runId?: string;
                    status?: string;
                    next?: number;
                    summary?: Record<string, unknown> | null;
                  }>(`${llmAuditProgressPath}?${query.toString()}`, {
                    signal: llmAuditProgressAbortController.signal,
                  }),
                  llmAuditProgressPath,
                  LIVE_PROGRESS_TIMEOUT_MS,
                );
                if (payload.runId && payload.runId !== llmAuditProgressRunId) {
                  llmAuditProgressRunId = payload.runId;
                  llmAuditProgressCursor = 0;
                  continue;
                }
                if (typeof payload.next === 'number') llmAuditProgressCursor = payload.next;
                const summary = (payload.summary || {}) as Record<string, unknown>;
                const progressPct = Math.max(
                  0,
                  Math.min(
                    100,
                    Number.isFinite(summary.progressPct as number)
                      ? Number(summary.progressPct)
                      : 0,
                  ),
                );
                const phase = String(summary.phase || 'running');
                const projectsTotal = Number(summary.projectsTotal || 0);
                const projectsDone = Number(summary.projectsDone || 0);
                const detail =
                  projectsTotal > 0 ? `${projectsDone}/${projectsTotal} projects` : '';
                setLlmAuditLoading({
                  active: true,
                  progressPct,
                  phase,
                  message: detail
                    ? `LLM audit: ${phase.replace(/_/g, ' ')} (${detail})`
                    : `LLM audit: ${phase.replace(/_/g, ' ')}`,
                });
              } catch (err) {
                if ((!llmAuditProgressActive || cancelled) && isAbortError(err)) break;
                if (!llmAuditProgressWarned) {
                  llmAuditProgressWarned = true;
                  log(`LLM audit live progress polling unavailable: ${getErrorMessage(err)}`, 'warn');
                }
              } finally {
                llmAuditProgressAbortController = null;
              }
              if (!llmAuditProgressActive) break;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          };

          const llmAuditProgressPromise = pollLlmAuditProgress();
          const llmAuditRes = await settle(
            timed<LlmAuditResponse>('/api/llm-audit', beSettings.fe_timeout_llm_audit ?? 620000),
          );
          llmAuditProgressActive = false;
          abortPendingRequest(llmAuditProgressAbortController);
          await llmAuditProgressPromise;
          if (cancelled) return;
          if (llmAuditRes.status === 'fulfilled' && llmAuditRes.value) {
            currentParsedData = { ...currentParsedData, llmAudit: llmAuditRes.value };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            setLlmAuditLoading({
              active: false,
              progressPct: 100,
              phase: 'done',
              message: `LLM audit complete (${llmAuditRes.value.rows?.length || 0} profiles)`,
            });
            const summary = llmAuditRes.value.summary || {
              countsByStatus: {},
              distinctModelsByStatus: { obsolete: 0, ripoff: 0 },
              llmsTotal: 0,
              projectsScanned: 0,
            };
            const c = (summary as { countsByStatus?: Record<string, number> }).countsByStatus || {};
            log(
              `Loaded LLM audit: ${llmAuditRes.value.rows?.length || 0} profile(s) — ` +
                `${c.ripoff || 0} overpriced, ${c.obsolete || 0} obsolete, ${c.unknown || 0} unknown`,
            );
          } else {
            setLlmAuditLoading({
              active: false,
              progressPct: 0,
              phase: 'error',
              message: 'LLM audit failed',
            });
            log(`Failed /api/llm-audit: ${settledError(llmAuditRes)}`, 'warn');
          }
        };

        const runProjects = async () => {
          const projectsRes: PromiseSettledResult<ProjectsResponse | null> = basicProjectsEnabled
            ? await settle(timed<ProjectsResponse>('/api/projects', beSettings.fe_timeout_projects ?? 45000))
            : { status: 'fulfilled', value: null };
          if (cancelled) return;
          if (!basicProjectsEnabled) {
            recordTiming('/api/projects', 0, 'skip');
            log('Skipped /api/projects in lean live mode');
            currentParsedData = {
              ...currentParsedData,
              projects: [],
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          } else if (projectsRes.status === 'fulfilled' && projectsRes.value) {
            currentParsedData = {
              ...currentParsedData,
              projects: projectsRes.value.projects || [],
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            log(`Loaded projects (${currentParsedData.projects?.length || 0})`);
          } else {
            log(`Failed /api/projects: ${settledError(projectsRes)}`, 'warn');
          }
        };

        const runLogs = async () => {
          const logsRes = await settle(timed<LogErrorsResponse>('/api/logs/errors', beSettings.fe_timeout_logs ?? 30000));
          if (cancelled) return;
          if (logsRes.status === 'fulfilled' && logsRes.value) {
            const displayedErrors = logsRes.value.logStats?.['Displayed Errors'] || 0;
            currentParsedData = {
              ...currentParsedData,
              formattedLogErrors: logsRes.value.formattedLogErrors || 'No log errors found',
              rawLogErrors: logsRes.value.rawLogErrors || [],
              logStats: logsRes.value.logStats || {
                'Total Lines': 0,
                'Unique Errors': 0,
                'Displayed Errors': 0,
              },
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            if (displayedErrors === 0) {
              log('Loaded /api/logs/errors but no recent errors were extracted', 'warn');
            } else {
              log(`Loaded log errors (${displayedErrors} displayed)`);
            }
          } else {
            log(`Failed /api/logs/errors: ${settledError(logsRes)}`, 'warn');
            currentParsedData = {
              ...currentParsedData,
              formattedLogErrors: 'Failed to load log errors (endpoint timed out or unavailable)',
              rawLogErrors: [],
              logStats: { 'Total Lines': 0, 'Unique Errors': 0, 'Displayed Errors': 0 },
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
          }
        };

        // Connection health scan — runs in Phase 3 alongside heavy endpoints
        const runConnectionHealth = async () => {
          try {
            const url = getBackendUrl('/api/connections/health');
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok || !response.body) return;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const collected: ConnectionHealthResult[] = [];

            while (true) {
              if (cancelled) { reader.cancel(); return; }
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split('\n\n');
              buffer = parts.pop() || '';

              for (const part of parts) {
                const eventMatch = part.match(/^event:\s*(\S+)/m);
                const dataMatch = part.match(/^data:\s*(.*)/m);
                if (!eventMatch || !dataMatch) continue;

                const eventType = eventMatch[1];
                let payload: Record<string, unknown>;
                try { payload = JSON.parse(dataMatch[1]) as Record<string, unknown>; } catch { continue; }

                if (eventType === 'init') {
                  dispatch({ type: 'SET_PARSED_DATA', payload: { connectionHealthTotal: Number(payload.total) } });
                } else if (eventType === 'conn') {
                  collected.push(payload as unknown as ConnectionHealthResult);
                  dispatch({ type: 'SET_PARSED_DATA', payload: { connectionHealth: [...collected] } });
                }
              }
            }
            log(`Connection health scan done (${collected.length} connections)`);
          } catch (err) {
            log(`Connection health scan failed: ${getErrorMessage(err)}`, 'warn');
          }
        };

        log(
          'Phase 3 strategy: launch code-envs + project-footprint + connection-health in parallel; defer dir-tree until Directory page is opened',
        );
        const phase3Start = nowMs();
        const heavyStart = nowMs();
        const lowStart = nowMs();
        projectFootprintStarted = true;
        const heavyGate = Promise.allSettled([runCodeEnvs(), runProjectFootprint(), runLlmAudit()]);
        const connectionHealthGate = runConnectionHealth();
        log('Deferred /api/dir-tree until Directory page is opened');
        prefetchInactiveProjects(); // warm cache for Project Cleaner
        const lowGate = Promise.allSettled([runProjects(), runLogs()]);

        await heavyGate;
        clearTimeout(slowHeavyTimer);
        if (cancelled) return;
        log(`Phase 3 heavy endpoints done (${fmtMs(heavyStart)})`);

        await lowGate;
        if (cancelled) return;
        log(`Phase 3 low-priority endpoints done (${fmtMs(lowStart)})`);
        log(`Phase 3 all endpoints done (${fmtMs(phase3Start)})`);

        // Compute users by project count
        if (currentParsedData.projects?.length && currentParsedData.users?.length) {
          const userEmailMap: Record<string, string> = {};
          currentParsedData.users.forEach((u) => {
            userEmailMap[u.login] = u.email || u.login;
          });

          const projectCounts: Record<string, number> = {};
          currentParsedData.projects.forEach((p) => {
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
            currentParsedData = {
              ...currentParsedData,
              usersByProjects,
            };
            dispatch({ type: 'SET_PARSED_DATA', payload: currentParsedData });
            log(`Computed users-by-projects (${Object.keys(usersByProjects).length} users)`);
          }
        }
        // Emit timing summary table
        if (endpointTimings.length > 0) {
          const rows = endpointTimings.map((t) => {
            const dur = t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`;
            const flag = t.status === 'fail' ? ' FAIL' : t.status === 'skip' ? ' SKIP' : '';
            return `${t.label}|${dur}${flag}`;
          });
          log(`TIMING_TABLE:${rows.join(';;')}`);
        }
        log('Live data load completed');
        deferredTails.push(connectionHealthGate);
        deferredTails.push(
          fetchJson<OutreachData>('/api/tools/outreach-data')
            .then((res) => {
              if (!cancelled) {
                dispatch({ type: 'SET_PARSED_DATA', payload: { outreachData: res, outreachApiLoaded: true } });
              }
            })
            .catch(() => { /* non-critical, ToolsView Effect 2 is fallback */ }),
        );
        if (deferredTails.length > 0) {
          log(`Awaiting ${deferredTails.length} deferred tail requests`);
          await Promise.allSettled(deferredTails);
          log('Deferred tails resolved');
        }
        dispatch({ type: 'SET_PARSED_DATA', payload: { dataReady: true } });

        // Write parsed data to SQL tracking tables for trends comparison
        try {
          log('Ingesting parsed data to tracking SQL...');
          const healthScore = calculateHealthScore(currentParsedData);
          const ingestPayload = {
            ...currentParsedData,
            _healthScore: healthScore.overall,
            _healthStatus: healthScore.status,
            _categoryScores: Object.fromEntries(
              healthScore.categories.map(c => [c.category, c.score])
            ),
          };
          await fetchJson('/api/tracking/ingest-parsed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ingestPayload),
          });
          log(`Tracking ingest complete (health_score=${healthScore.overall})`);
        } catch (ingestErr) {
          log(`Tracking ingest failed (non-critical): ${ingestErr instanceof Error ? ingestErr.message : ingestErr}`, 'warn');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log(`Live data load failed: ${message}`, 'error');
        dispatch({ type: 'SET_ERROR', payload: `Failed to load live diagnostics: ${message}` });
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_LOADING', payload: false });
          log('Loader finalized');
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      codeEnvsInterpolationEnabledRef.current = false;
      projectFootprintInterpolationEnabledRef.current = false;
      codeEnvsProgressSetterRef.current = null;
      projectFootprintProgressSetterRef.current = null;
    };
  }, [dispatch, enabled, reloadKey]);
}
