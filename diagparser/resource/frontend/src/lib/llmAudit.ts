/**
 * LLM model upgrade audit — TypeScript port of python-lib/llm_audit.py.
 *
 * Classifies every LLM connection as current / ripoff / obsolete / unknown
 * based on the LiteLLM public pricing catalog. Prices are stored as plain
 * numbers (USD per 1 M tokens, derived from the per-token cost * 1e6).
 * No Decimal library is needed — comparisons between floats are fine at this
 * scale and the values are display-only.
 */

const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// Reseller litellm_provider values fold into their canonical upstream family.
const PROVIDERS: Record<
  string,
  { display: string; litellm_providers: Set<string>; strip_prefixes: string[] }
> = {
  openai: {
    display: 'OpenAI',
    litellm_providers: new Set(['openai', 'text-completion-openai', 'azure', 'azure_ai']),
    strip_prefixes: ['azure/', 'azure_ai/'],
  },
  anthropic: {
    display: 'Anthropic',
    litellm_providers: new Set(['anthropic', 'bedrock', 'bedrock_converse']),
    strip_prefixes: ['bedrock/'],
  },
  gemini: {
    display: 'Google Gemini',
    litellm_providers: new Set(['gemini', 'vertex_ai-language-models']),
    strip_prefixes: ['gemini/', 'vertex_ai/'],
  },
};

const ALLOWED_MODES = new Set(['chat', 'completion', 'responses']);

const NON_LLM_NAME_TERMS = new Set([
  'audio', 'computer-use', 'dall-e', 'embedding', 'image', 'imagen',
  'learnlm', 'live-preview', 'lyria', 'moderation', 'native-audio',
  'realtime', 'robotics', 'sora', 'speech', 'tts', 'transcribe', 'veo',
  'whisper',
]);

const SPECIALIZED_NAME_TERMS = new Set([
  'codex', 'deep-research', 'experimental', 'gemini-exp', 'gemma',
  'search-api', 'search-preview',
]);

const BEDROCK_REGION_PREFIXES = ['global.', 'us.', 'eu.', 'apac.', 'au.', 'ap.'];
const BEDROCK_PROVIDER_PREFIXES = [
  'anthropic.', 'meta.', 'mistral.', 'amazon.', 'cohere.', 'ai21.', 'deepseek.',
];
const BEDROCK_VERSION_SUFFIX_RE = /-v\d+(?::\d+)?$/;
const BEDROCK_REGION_PATH_RE = /^[a-z]{2,5}(?:-[a-z0-9]+){1,3}\//;

const AZURE_FUZZY_PATTERNS: Array<[RegExp, string]> = [
  [/gpt[\W_]?5[\W_]?2/i, 'gpt-5.2'],
  [/gpt[\W_]?5[\W_]?1/i, 'gpt-5.1'],
  [/gpt[\W_]?5/i, 'gpt-5'],
  [/gpt[\W_]?4[\W_]?1/i, 'gpt-4.1'],
  [/gpt[\W_]?4[\W_]?o/i, 'gpt-4o'],
  [/gpt[\W_]?4[\W_]?turbo/i, 'gpt-4-turbo'],
  [/gpt[\W_]?4/i, 'gpt-4'],
  [/gpt[\W_]?3[\W_]?5/i, 'gpt-3.5-turbo'],
  [/o4[\W_]?mini/i, 'o4-mini'],
  [/o3[\W_]?mini/i, 'o3-mini'],
  [/o3/i, 'o3'],
  [/o1/i, 'o1'],
];

// DSS LLM types that are meta-wrappers with no upstream model.
export const NOT_APPLICABLE_TYPES = new Set(['SAVED_MODEL_AGENT', 'RETRIEVAL_AUGMENTED']);

const PROVIDER_KEY_BY_DSS_TYPE: Record<string, string | null> = {
  OPENAI: 'openai',
  AZURE_OPENAI_DEPLOYMENT: 'openai',
  ANTHROPIC: 'anthropic',
  BEDROCK: null,
  VERTEX: 'gemini',
  SNOWFLAKE_CORTEX: null,
  HUGGINGFACE_TRANSFORMER_LOCAL: null,
  CUSTOM: null,
  SAVED_MODEL_AGENT: null,
  RETRIEVAL_AUGMENTED: null,
};

// -------- String helpers --------

function stripProviderPathPrefixes(model: string, providerKey: string): string {
  for (const prefix of PROVIDERS[providerKey].strip_prefixes) {
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }
  return model;
}

function stripBedrockDecorations(model: string): string {
  for (const prefix of ['bedrock/', 'bedrock_converse/']) {
    if (model.startsWith(prefix)) { model = model.slice(prefix.length); break; }
  }
  model = model.replace(BEDROCK_REGION_PATH_RE, '');
  if (model.startsWith('invoke/')) model = model.slice('invoke/'.length);
  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (model.startsWith(prefix)) { model = model.slice(prefix.length); break; }
  }
  for (const prefix of BEDROCK_PROVIDER_PREFIXES) {
    if (model.startsWith(prefix)) { model = model.slice(prefix.length); break; }
  }
  model = model.replace(BEDROCK_VERSION_SUFFIX_RE, '');
  return model;
}

function stripDateSuffix(model: string): string {
  model = model.replace(/@\d{4}-\d{2}-\d{2}$/, '');
  model = model.replace(/@\d{8}$/, '');
  model = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  model = model.replace(/-\d{8}$/, '');
  model = model.replace(/-(?:preview-)?\d{2}-\d{4}$/, '-preview');
  model = model.replace(/-(?:preview-)?\d{4}$/, '-preview');
  model = model.replace(/-(\d{4})(?=-preview$)/, '');
  model = model.replace(/-001$/, '');
  return model;
}

export function canonicalModel(providerKey: string, model: string): string {
  model = stripProviderPathPrefixes(model.toLowerCase(), providerKey);
  model = stripBedrockDecorations(model);
  if (model.startsWith('openai-')) model = model.slice('openai-'.length);
  model = stripDateSuffix(model);

  if (providerKey === 'openai') {
    model = model.replace(/^gpt-35-turbo\b/, 'gpt-3.5-turbo');
    model = model.replace(/^gpt-(5(?:\.\d+)?)-chat(?:-latest)?$/, 'gpt-$1');
    model = model.replace(/^gpt-(3\.5-turbo)-instruct(?:-preview)?$/, 'gpt-$1-instruct');
    model = model.replace(/^gpt-(3\.5-turbo)(?:-preview)?$/, 'gpt-$1');
  }
  if (providerKey === 'anthropic') {
    model = model.replace(/^claude-4-(opus|sonnet|haiku)$/, 'claude-$1-4');
    model = model.replace(/^claude-(opus|sonnet|haiku)-4$/, 'claude-$1-4');
    model = model.replace(/^claude-3-5-haiku$/, 'claude-haiku-3-5');
  }
  if (providerKey === 'gemini') {
    model = model.replace(/-customtools$/, '');
  }
  return model;
}

function azureFuzzyInfer(raw: string): string | null {
  if (!raw) return null;
  for (const [pat, canon] of AZURE_FUZZY_PATTERNS) {
    if (pat.test(raw)) return canon;
  }
  return null;
}

// -------- Version extraction helpers --------

function extractNumbers(value: string): number[] {
  return (value.match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

function extractAnthropicVersion(model: string): number[] {
  if (/^claude-(opus|sonnet|haiku)-/.test(model)) {
    return extractNumbers(model.split('-').slice(2).join('-'));
  }
  return extractNumbers(model);
}

function extractGeminiVersion(model: string): number[] {
  const m = model.match(/^gemini-(\d+(?:\.\d+)?)(?:-|$)/);
  if (!m) return [-1];
  return m[1].split('.').map(Number);
}

function extractOpenAiGptVersion(model: string): number[] {
  if (model.startsWith('chatgpt-4o')) return [4, 0];
  const m = model.match(/^gpt-(\d+(?:\.\d+)?)/);
  if (!m) return [-1];
  return m[1].split('.').map(Number);
}

function extractOpenAiOVersion(model: string): number[] {
  const m = model.match(/^o(\d+)/);
  if (!m) return [-1];
  return [Number(m[1])];
}

type FamilyResult = [string, number[]] | null;

export function familyFor(providerKey: string, model: string): FamilyResult {
  if (providerKey === 'anthropic') {
    if (model.includes('opus')) return ['Opus', extractAnthropicVersion(model)];
    if (model.includes('sonnet')) return ['Sonnet', extractAnthropicVersion(model)];
    if (model.includes('haiku')) return ['Haiku', extractAnthropicVersion(model)];
    return null;
  }
  if (providerKey === 'gemini') {
    if (model.includes('flash-lite')) return ['Flash-Lite', extractGeminiVersion(model)];
    if (model.includes('flash')) return ['Flash', extractGeminiVersion(model)];
    if (model.includes('pro')) return ['Pro', extractGeminiVersion(model)];
    return null;
  }
  if (providerKey === 'openai') {
    if (/^gpt-\d+(?:\.\d+)?-pro\b/.test(model)) return ['GPT pro', extractOpenAiGptVersion(model)];
    if (model.includes('-nano') && model.startsWith('gpt-')) return ['GPT nano', extractOpenAiGptVersion(model)];
    if (model.includes('-mini') && model.startsWith('gpt-')) return ['GPT mini', extractOpenAiGptVersion(model)];
    if (/^o\d+-pro\b/.test(model)) return ['Reasoning pro', extractOpenAiOVersion(model)];
    if (/^o\d+-mini\b/.test(model)) return ['Reasoning mini', extractOpenAiOVersion(model)];
    if (/^o\d+\b/.test(model)) return ['Reasoning', extractOpenAiOVersion(model)];
    if (model.startsWith('gpt-') || model.startsWith('chatgpt-') || model.startsWith('davinci-') || model.startsWith('babbage-')) {
      return ['GPT flagship', extractOpenAiGptVersion(model)];
    }
    return null;
  }
  return null;
}

// -------- Catalog grouping --------

interface ModelGroup {
  provider: string;
  family: string;
  canonicalModel: string;
  inputPrice: number;  // USD per 1M tokens
  outputPrice: number;
  version: number[];
  aliases: Set<string>;
}

function providerKeyFor(info: Record<string, unknown>): string | null {
  const litellmProvider = info['litellm_provider'];
  for (const [key, rule] of Object.entries(PROVIDERS)) {
    if (rule.litellm_providers.has(litellmProvider as string)) return key;
  }
  return null;
}

function modelNameHasTerm(model: string, terms: Set<string>): boolean {
  const normalized = model.toLowerCase().replace(/_/g, '-');
  for (const term of terms) {
    if (normalized.includes(term)) return true;
  }
  return false;
}

function perMillion(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!isFinite(n)) return null;
  return n * 1_000_000;
}

function acceptsTextInput(info: Record<string, unknown>): boolean {
  const modalities = info['supported_modalities'];
  if (modalities == null) return true;
  return Array.isArray(modalities) && modalities.includes('text');
}

function hasTextOutput(info: Record<string, unknown>): boolean {
  const modalities = info['supported_output_modalities'];
  if (modalities == null) return true;
  return Array.isArray(modalities) && modalities.includes('text');
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function collectGroups(raw: Record<string, unknown>): Map<string, Map<string, ModelGroup>> {
  // Key: "provider|family", Value: map of canonicalModel -> ModelGroup
  const grouped = new Map<string, Map<string, ModelGroup>>();

  for (const [rawModel, info] of Object.entries(raw)) {
    if (!info || typeof info !== 'object') continue;
    const infoObj = info as Record<string, unknown>;

    const providerKey = providerKeyFor(infoObj);
    if (!providerKey) continue;
    if (!ALLOWED_MODES.has(infoObj['mode'] as string)) continue;
    if (!acceptsTextInput(infoObj) || !hasTextOutput(infoObj)) continue;

    const canonical = canonicalModel(providerKey, rawModel);
    if (rawModel.startsWith('ft:')) continue;
    if (modelNameHasTerm(canonical, NON_LLM_NAME_TERMS)) continue;
    if (modelNameHasTerm(canonical, SPECIALIZED_NAME_TERMS)) continue;

    const familyInfo = familyFor(providerKey, canonical);
    if (!familyInfo) continue;
    const [family, version] = familyInfo;

    const inputPrice = perMillion(infoObj['input_cost_per_token']);
    const outputPrice = perMillion(infoObj['output_cost_per_token']);
    if (inputPrice == null || outputPrice == null) continue;

    const provider = PROVIDERS[providerKey].display;
    const familyKey = `${provider}|${family}`;
    if (!grouped.has(familyKey)) grouped.set(familyKey, new Map());
    const byModel = grouped.get(familyKey)!;

    const existing = byModel.get(canonical);
    if (!existing) {
      byModel.set(canonical, {
        provider,
        family,
        canonicalModel: canonical,
        inputPrice,
        outputPrice,
        version,
        aliases: new Set([rawModel]),
      });
    } else {
      existing.aliases.add(rawModel);
      if (inputPrice < existing.inputPrice) {
        existing.inputPrice = inputPrice;
        existing.outputPrice = outputPrice;
      }
    }
  }

  return grouped;
}

interface AuditFamily {
  provider: string;
  family: string;
  current: ModelGroup;
  ripoff: ModelGroup[];
  obsolete: ModelGroup[];
}

function buildAudit(grouped: Map<string, Map<string, ModelGroup>>): AuditFamily[] {
  const audit: AuditFamily[] = [];
  for (const byModel of grouped.values()) {
    const candidates = Array.from(byModel.values()).filter(
      (g) => g.version.length > 0 && g.version[0] >= 0,
    );
    if (!candidates.length) continue;

    // Sort descending by version, then ascending by price to pick current
    const current = candidates.reduce((best, g) => {
      const cmp = compareVersions(g.version, best.version);
      if (cmp > 0) return g;
      if (cmp === 0 && g.inputPrice < best.inputPrice) return g;
      return best;
    });

    const ripoff: ModelGroup[] = [];
    const obsolete: ModelGroup[] = [];
    for (const g of byModel.values()) {
      if (g.canonicalModel === current.canonicalModel) continue;
      if (g.inputPrice > current.inputPrice || g.outputPrice > current.outputPrice) {
        ripoff.push(g);
      } else {
        obsolete.push(g);
      }
    }
    audit.push({ provider: current.provider, family: current.family, current, ripoff, obsolete });
  }
  audit.sort((a, b) => {
    const p = a.provider.localeCompare(b.provider);
    return p !== 0 ? p : a.family.localeCompare(b.family);
  });
  return audit;
}

interface LookupPayload {
  status: 'current' | 'ripoff' | 'obsolete';
  provider: string;
  family: string;
  canonical_model: string;
  current_model: string;
  current_price: { input_usd_per_1m_tokens: number; output_usd_per_1m_tokens: number };
  model_price: { input_usd_per_1m_tokens: number; output_usd_per_1m_tokens: number };
}

export type AuditLookup = Record<string, LookupPayload>;

function buildLookupFromAudit(audit: AuditFamily[]): AuditLookup {
  const lookup: AuditLookup = {};
  for (const item of audit) {
    for (const [status, groups] of [
      ['current', [item.current]],
      ['ripoff', item.ripoff],
      ['obsolete', item.obsolete],
    ] as Array<['current' | 'ripoff' | 'obsolete', ModelGroup[]]>) {
      for (const group of groups) {
        const payload: LookupPayload = {
          status,
          provider: item.provider,
          family: item.family,
          canonical_model: group.canonicalModel,
          current_model: item.current.canonicalModel,
          current_price: {
            input_usd_per_1m_tokens: item.current.inputPrice,
            output_usd_per_1m_tokens: item.current.outputPrice,
          },
          model_price: {
            input_usd_per_1m_tokens: group.inputPrice,
            output_usd_per_1m_tokens: group.outputPrice,
          },
        };
        lookup[group.canonicalModel] = payload;
        for (const alias of group.aliases) {
          lookup[alias] = payload;
        }
      }
    }
  }
  return lookup;
}

/** Fetch the LiteLLM catalog and produce the flat classification lookup. */
export async function buildLookup(signal?: AbortSignal): Promise<AuditLookup> {
  const resp = await fetch(LITELLM_PRICING_URL, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching LiteLLM catalog`);
  const raw: Record<string, unknown> = await resp.json();
  return buildLookupFromAudit(buildAudit(collectGroups(raw)));
}

// -------- Webapp adapter --------

function candidateProviderKeys(dssType: string, rawModel: string): string[] {
  const forced = PROVIDER_KEY_BY_DSS_TYPE[dssType];
  if (forced !== undefined && forced !== null) return [forced];
  const rm = (rawModel || '').toLowerCase();
  if (rm.includes('anthropic.') || rm.includes('claude')) return ['anthropic'];
  if (rm.includes('gemini')) return ['gemini'];
  return ['openai', 'anthropic', 'gemini'];
}

export function normalizeForAudit(
  dssType: string,
  model: string | null | undefined,
  deployment: string | null | undefined,
): string[] {
  const raw = (model || deployment || '').trim();
  if (!raw) return [];

  const candidates: string[] = [raw];

  if (dssType === 'AZURE_OPENAI_DEPLOYMENT') candidates.push(`azure/${raw}`);
  if (dssType === 'VERTEX') { candidates.push(`gemini/${raw}`); candidates.push(`vertex_ai/${raw}`); }
  if (dssType === 'BEDROCK') candidates.push(`bedrock/${raw}`);
  if (dssType === 'SNOWFLAKE_CORTEX') candidates.push(`snowflake/${raw}`);

  for (const pk of candidateProviderKeys(dssType, raw)) {
    const canon = canonicalModel(pk, raw);
    if (canon && !candidates.includes(canon)) candidates.push(canon);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

export interface ClassifyResult {
  status: 'current' | 'ripoff' | 'obsolete' | 'unknown' | 'not_applicable';
  effectiveModel: string | null;
  provider: string | null;
  family: string | null;
  currentModel: string | null;
  modelInputPrice: number | null;
  modelOutputPrice: number | null;
  currentInputPrice: number | null;
  currentOutputPrice: number | null;
}

/**
 * Classify a single LLM-Mesh connection against the prebuilt AuditLookup.
 * dssType: the `params.llm.type` from connections.json
 * model: params.llm.model
 * deployment: params.llm.deployment (Azure only)
 */
export function classifyRow(
  dssType: string,
  model: string | null | undefined,
  deployment: string | null | undefined,
  lookup: AuditLookup,
): ClassifyResult {
  if (NOT_APPLICABLE_TYPES.has(dssType)) {
    return {
      status: 'not_applicable',
      effectiveModel: null,
      provider: null,
      family: null,
      currentModel: null,
      modelInputPrice: null,
      modelOutputPrice: null,
      currentInputPrice: null,
      currentOutputPrice: null,
    };
  }

  let effective = model || deployment || null;

  const candidates = normalizeForAudit(
    dssType,
    effective,
    dssType === 'AZURE_OPENAI_DEPLOYMENT' ? deployment : null,
  );

  let hit: LookupPayload | null = null;
  for (const c of candidates) {
    if (lookup[c]) { hit = lookup[c]; effective = c; break; }
  }

  // Azure fuzzy fallback
  if (!hit && dssType === 'AZURE_OPENAI_DEPLOYMENT') {
    const inferred = azureFuzzyInfer(effective || deployment || '');
    if (inferred && lookup[inferred]) {
      hit = lookup[inferred];
      effective = `${inferred} (inferred from name)`;
    }
  }

  if (!hit) {
    return {
      status: 'unknown',
      effectiveModel: effective,
      provider: null,
      family: null,
      currentModel: null,
      modelInputPrice: null,
      modelOutputPrice: null,
      currentInputPrice: null,
      currentOutputPrice: null,
    };
  }

  return {
    status: hit.status,
    effectiveModel: effective,
    provider: hit.provider,
    family: hit.family,
    currentModel: hit.current_model,
    modelInputPrice: hit.model_price.input_usd_per_1m_tokens,
    modelOutputPrice: hit.model_price.output_usd_per_1m_tokens,
    currentInputPrice: hit.current_price.input_usd_per_1m_tokens,
    currentOutputPrice: hit.current_price.output_usd_per_1m_tokens,
  };
}
