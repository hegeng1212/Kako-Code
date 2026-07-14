/** OpenAI-compatible provider profile (cc-switch style registry). */
export interface ProviderAdvancedConfig {
  hideAiSignature?: boolean;
  teammatesMode?: boolean;
  enableToolSearch?: boolean;
  maxThinking?: boolean;
  disableAutoUpgrade?: boolean;
  writeCommonConfig?: boolean;
  /** Extra env vars merged into requests */
  env?: Record<string, string>;
  /** Raw JSON extension for forward compatibility */
  extraJson?: string;
}

export interface ProviderTestConfig {
  /** Use per-provider test settings instead of global defaults */
  enabled?: boolean;
  testModel?: string;
  timeoutSec?: number;
  testPrompt?: string;
  downgradeThresholdMs?: number;
  maxRetries?: number;
}

export type BillingMode = "inherit" | "request_model" | "response_model";

export interface ProviderBillingConfig {
  enabled?: boolean;
  costMultiplier?: number;
  billingMode?: BillingMode;
}

export interface ProviderProfile {
  id: string;
  name: string;
  /** Always openai-compatible in Kako unified protocol. */
  protocol: "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  /** Available model IDs or endpoint IDs. */
  models: string[];
  /** Actual model / endpoint ID sent to the API. */
  defaultModel?: string;
  /** Display-only alias shown in the UI; falls back to defaultModel when empty. */
  modelAlias?: string;
  /** Default context window tokens for models on this provider when not overridden. */
  contextWindow?: number;
  /** Per-model context window overrides (model id → tokens). */
  modelContextWindows?: Record<string, number>;
  enabled: boolean;
  /** Built-in preset key, if created from a template. */
  preset?: string;
  /** User notes, e.g. company account */
  remarks?: string;
  /** Official website */
  website?: string;
  /** If true, baseUrl is the full chat/completions URL */
  fullUrl?: boolean;
  advanced?: ProviderAdvancedConfig;
  testConfig?: ProviderTestConfig;
  billing?: ProviderBillingConfig;
  createdAt?: string;
  updatedAt?: string;
}

/** Currently active provider + model selection. */
export interface ActiveProviderSelection {
  providerId: string;
  model: string;
}

export interface ProviderRegistry {
  version: number;
  active: ActiveProviderSelection;
  providers: ProviderProfile[];
  routing?: {
    fallbackChain?: Array<{ providerId: string; model: string }>;
    maxRetries?: number;
    retryDelayMs?: number;
  };
  /** Global default test settings */
  globalTest?: ProviderTestConfig;
}

/** Result of checking whether LLM provider is ready for chat. */
export interface ProviderReadiness {
  ready: boolean;
  issues: string[];
}

/** Built-in provider preset template. */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  protocol: "openai-compatible";
  description?: string;
  /** Env var hint for API key. */
  apiKeyEnv?: string;
  /** Example model IDs. */
  exampleModels?: string[];
  /** Show star badge in UI */
  featured?: boolean;
  website?: string;
}

export interface ProviderTestRequest {
  providerId: string;
  model?: string;
  prompt?: string;
}

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  response?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export type ProviderTestStreamEvent =
  | { type: "success"; latencyMs: number; response?: string }
  | { type: "error"; latencyMs: number; error: string };

export const DEFAULT_TEST_CONFIG: ProviderTestConfig = {
  timeoutSec: 45,
  testPrompt: "Who are you?",
  downgradeThresholdMs: 6000,
  maxRetries: 2,
};

export const DEFAULT_ADVANCED_CONFIG: ProviderAdvancedConfig = {
  env: { API_TIMEOUT_MS: "300000" },
};

/** Merge partial test config onto base defaults. */
export function normalizeTestConfig(
  config?: ProviderTestConfig,
  base: ProviderTestConfig = DEFAULT_TEST_CONFIG,
): ProviderTestConfig {
  return {
    enabled: config?.enabled,
    testModel: config?.testModel,
    timeoutSec: config?.timeoutSec ?? base.timeoutSec ?? DEFAULT_TEST_CONFIG.timeoutSec,
    testPrompt: config?.testPrompt ?? base.testPrompt ?? DEFAULT_TEST_CONFIG.testPrompt,
    downgradeThresholdMs:
      config?.downgradeThresholdMs ??
      base.downgradeThresholdMs ??
      DEFAULT_TEST_CONFIG.downgradeThresholdMs,
    maxRetries: config?.maxRetries ?? base.maxRetries ?? DEFAULT_TEST_CONFIG.maxRetries,
  };
}

/** Effective test settings for a provider (per-provider values merged with global defaults). */
export function resolveProviderTestConfig(
  profile: ProviderProfile,
  registry?: Pick<ProviderRegistry, "globalTest">,
): ProviderTestConfig {
  const base = normalizeTestConfig(registry?.globalTest);
  return normalizeTestConfig(profile.testConfig, base);
}

/** Endpoint ID used for API calls. */
export function getProviderEndpointId(profile: ProviderProfile): string {
  return profile.defaultModel ?? profile.models[0] ?? "";
}

/**
 * Display label for the active model in CLI/Web UI.
 * Priority: model alias → active endpoint ID → profile default model.
 * Never includes the provider (vendor) name.
 */
export function getProviderModelLabel(
  profile: ProviderProfile,
  activeEndpointId?: string,
): string {
  const alias = profile.modelAlias?.trim();
  if (alias) return alias;

  const endpoint =
    activeEndpointId?.trim() ||
    getProviderEndpointId(profile).trim();
  return endpoint || "(未设置模型)";
}
