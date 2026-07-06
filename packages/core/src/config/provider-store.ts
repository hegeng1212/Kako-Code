import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  ActiveProviderSelection,
  ProviderProfile,
  ProviderReadiness,
  ProviderRegistry,
  ProviderTestRequest,
  ProviderTestResult,
  ProviderTestStreamEvent,
  ProviderTestConfig,
  LLMStreamChunk,
} from "@kako/shared";
import { DEFAULT_TEST_CONFIG, resolveProviderTestConfig } from "@kako/shared";
import { getConfigDir } from "./paths.js";
import { getPreset, PROVIDER_PRESETS } from "./presets.js";
import { openaiCompatibleStream } from "../llm/openai-compatible.js";

const advancedSchema = z
  .object({
    hideAiSignature: z.boolean().optional(),
    teammatesMode: z.boolean().optional(),
    enableToolSearch: z.boolean().optional(),
    maxThinking: z.boolean().optional(),
    disableAutoUpgrade: z.boolean().optional(),
    writeCommonConfig: z.boolean().optional(),
    env: z.record(z.string()).optional(),
    extraJson: z.string().optional(),
  })
  .optional();

const testConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    testModel: z.string().optional(),
    timeoutSec: z.number().optional(),
    testPrompt: z.string().optional(),
    downgradeThresholdMs: z.number().optional(),
    maxRetries: z.number().optional(),
  })
  .optional();

const billingSchema = z
  .object({
    enabled: z.boolean().optional(),
    costMultiplier: z.number().optional(),
    billingMode: z.enum(["inherit", "request_model", "response_model"]).optional(),
  })
  .optional();

const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("openai-compatible").default("openai-compatible"),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([]),
  defaultModel: z.string().optional(),
  modelAlias: z.string().optional(),
  enabled: z.boolean().default(true),
  preset: z.string().optional(),
  remarks: z.string().optional(),
  website: z.string().optional(),
  fullUrl: z.boolean().optional(),
  advanced: advancedSchema,
  testConfig: testConfigSchema,
  billing: billingSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const registrySchema = z.object({
  version: z.number().default(1),
  active: z.object({
    providerId: z.string(),
    model: z.string(),
  }),
  providers: z.array(profileSchema).default([]),
  routing: z
    .object({
      fallbackChain: z
        .array(z.object({ providerId: z.string(), model: z.string() }))
        .optional(),
      maxRetries: z.number().default(3),
      retryDelayMs: z.number().default(1000),
    })
    .optional(),
  globalTest: testConfigSchema,
});

function registryPath(): string {
  return join(getConfigDir(), "providers.json");
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

function normalizeRegistry(registry: ProviderRegistry): ProviderRegistry {
  return {
    ...registry,
    globalTest: {
      ...DEFAULT_TEST_CONFIG,
      ...registry.globalTest,
    },
  };
}

function defaultRegistry(): ProviderRegistry {
  const doubaoPreset = getPreset("volcengine-doubao")!;
  const doubao: ProviderProfile = {
    id: "volcengine-doubao",
    name: doubaoPreset.name,
    protocol: "openai-compatible",
    baseUrl: doubaoPreset.baseUrl,
    apiKey: process.env.ARK_API_KEY ?? process.env.VOLCENGINE_API_KEY ?? "",
    models: [],
    defaultModel: "",
    enabled: true,
    preset: "volcengine-doubao",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    version: 1,
    active: {
      providerId: doubao.id,
      model: doubao.defaultModel ?? "",
    },
    providers: [doubao],
    routing: { maxRetries: 3, retryDelayMs: 1000 },
    globalTest: { ...DEFAULT_TEST_CONFIG },
  };
}

export async function loadProviderRegistry(): Promise<ProviderRegistry> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(registryPath(), "utf-8");
    const raw = JSON.parse(text) as unknown;
    const parsed = registrySchema.parse(raw);
    return normalizeRegistry({
      ...parsed,
      providers: parsed.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? expandEnv(p.apiKey) : resolveApiKeyFromPreset(p),
      })),
    });
  } catch {
    const registry = defaultRegistry();
    await saveProviderRegistry(registry);
    return registry;
  }
}

export async function saveProviderRegistry(registry: ProviderRegistry): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(
    registryPath(),
    `${JSON.stringify(normalizeRegistry(registry), null, 2)}\n`,
    "utf-8",
  );
}

function resolveApiKeyFromPreset(profile: ProviderProfile): string | undefined {
  const preset = profile.preset ? getPreset(profile.preset) : undefined;
  if (!preset?.apiKeyEnv) return profile.apiKey;
  return process.env[preset.apiKeyEnv];
}

export function getEffectiveApiKey(profile: ProviderProfile): string | undefined {
  const direct = profile.apiKey?.trim();
  if (direct) return direct;
  return resolveApiKeyFromPreset(profile)?.trim() || undefined;
}

export function getActiveModelSelection(
  registry: ProviderRegistry,
  profile: ProviderProfile,
): string {
  return (
    registry.active.model ||
    profile.defaultModel ||
    profile.models[0] ||
    ""
  ).trim();
}

/** Models the user has enabled on a provider (Web UI / providers.json `models` list). */
export function getProviderEnabledModels(profile: ProviderProfile): string[] {
  const enabled = profile.models.map((m) => m.trim()).filter(Boolean);
  if (enabled.length > 0) return enabled;
  const fallback = profile.defaultModel?.trim();
  return fallback ? [fallback] : [];
}

export function isModelEnabledOnProvider(model: string, profile: ProviderProfile): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  return getProviderEnabledModels(profile).includes(trimmed);
}

/**
 * Pick a model that is enabled on the provider.
 * Falls back to defaultModel, then the first enabled model, when the hint is missing or invalid.
 */
export function resolveEnabledModel(
  profile: ProviderProfile,
  preferred?: string,
): string {
  const enabled = getProviderEnabledModels(profile);
  if (enabled.length === 0) {
    throw new Error(
      `No enabled models for provider ${profile.name}. Add models in Web UI or providers.json.`,
    );
  }

  const hint = preferred?.trim();
  if (hint && enabled.includes(hint)) return hint;

  const defaultModel = profile.defaultModel?.trim();
  if (defaultModel && enabled.includes(defaultModel)) return defaultModel;

  return enabled[0]!;
}

export function checkProviderReadiness(registry: ProviderRegistry): ProviderReadiness {
  const issues: string[] = [];

  if (registry.providers.length === 0) {
    return { ready: false, issues: ["尚未配置模型供应商"] };
  }

  const profile = registry.providers.find((p) => p.id === registry.active.providerId);
  if (!profile) {
    issues.push("未选择当前使用的模型供应商");
    return { ready: false, issues };
  }

  if (!profile.enabled) {
    issues.push(`当前供应商「${profile.name}」已停用`);
  }
  if (!getEffectiveApiKey(profile)) {
    issues.push(`请为「${profile.name}」配置 API Key`);
  }
  if (!getActiveModelSelection(registry, profile)) {
    issues.push(`请为「${profile.name}」选择或填写模型 ID`);
  } else {
    const activeModel = getActiveModelSelection(registry, profile);
    const enabled = getProviderEnabledModels(profile);
    if (enabled.length > 0 && !enabled.includes(activeModel)) {
      issues.push(`当前模型「${activeModel}」未在「${profile.name}」启用的模型列表中`);
    }
  }

  return { ready: issues.length === 0, issues };
}

export function getActiveProvider(
  registry: ProviderRegistry,
): { profile: ProviderProfile; model: string } {
  const profile = registry.providers.find((p) => p.id === registry.active.providerId);
  if (!profile) {
    throw new Error(`Active provider not found: ${registry.active.providerId}`);
  }
  if (!profile.enabled) {
    throw new Error(`Provider "${profile.name}" is disabled`);
  }
  const model = resolveEnabledModel(profile, registry.active.model);
  return { profile, model };
}

export async function addProviderFromPreset(
  presetId: string,
  overrides?: Partial<Pick<ProviderProfile, "apiKey" | "models" | "defaultModel">>,
): Promise<ProviderRegistry> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);

  const registry = await loadProviderRegistry();
  const id = presetId === "custom" ? `custom-${Date.now()}` : presetId;

  if (registry.providers.some((p) => p.id === id) && presetId !== "custom") {
    throw new Error(`Provider already exists: ${id}`);
  }

  const profile: ProviderProfile = {
    id,
    name: preset.name,
    protocol: "openai-compatible",
    baseUrl: preset.baseUrl,
    apiKey: overrides?.apiKey ?? (preset.apiKeyEnv ? process.env[preset.apiKeyEnv] : ""),
    models: overrides?.models ?? preset.exampleModels ?? [],
    defaultModel: overrides?.defaultModel ?? preset.exampleModels?.[0] ?? "",
    enabled: true,
    preset: presetId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  registry.providers.push(profile);
  await saveProviderRegistry(registry);
  return registry;
}

export async function upsertProvider(
  profile: ProviderProfile,
): Promise<ProviderRegistry> {
  const registry = await loadProviderRegistry();
  const index = registry.providers.findIndex((p) => p.id === profile.id);
  const now = new Date().toISOString();
  const next = { ...profile, updatedAt: now };
  if (index >= 0) {
    registry.providers[index] = { ...registry.providers[index], ...next };
  } else {
    registry.providers.push({ ...next, createdAt: now });
  }
  await saveProviderRegistry(registry);
  return registry;
}

export async function removeProvider(providerId: string): Promise<ProviderRegistry> {
  const registry = await loadProviderRegistry();
  registry.providers = registry.providers.filter((p) => p.id !== providerId);
  if (registry.active.providerId === providerId) {
    const first = registry.providers[0];
    registry.active = {
      providerId: first?.id ?? "",
      model: first?.defaultModel ?? first?.models[0] ?? "",
    };
  }
  await saveProviderRegistry(registry);
  return registry;
}

export async function setActiveProvider(
  selection: ActiveProviderSelection,
): Promise<ProviderRegistry> {
  const registry = await loadProviderRegistry();
  const profile = registry.providers.find((p) => p.id === selection.providerId);
  if (!profile) throw new Error(`Provider not found: ${selection.providerId}`);
  registry.active = selection;
  await saveProviderRegistry(registry);
  return registry;
}

export async function setGlobalTestConfig(
  config: ProviderTestConfig,
): Promise<ProviderRegistry> {
  const registry = await loadProviderRegistry();
  registry.globalTest = { ...DEFAULT_TEST_CONFIG, ...config, enabled: undefined };
  await saveProviderRegistry(registry);
  return registry;
}

function resolveTestConfig(
  profile: ProviderProfile,
  registry: ProviderRegistry,
): ProviderTestConfig {
  return resolveProviderTestConfig(profile, registry);
}

function isTestSuccessChunk(
  chunk: LLMStreamChunk,
): chunk is LLMStreamChunk & {
  type: "text_delta" | "reasoning_delta" | "tool_call_delta" | "stream_start";
} {
  if (chunk.type === "error" || chunk.type === "done") return false;
  if (chunk.type === "stream_start" || chunk.type === "tool_call_delta") return true;
  if (chunk.type === "text_delta" || chunk.type === "reasoning_delta") {
    return Boolean(chunk.text);
  }
  return false;
}

export async function* testProviderStream(
  request: ProviderTestRequest,
): AsyncIterable<ProviderTestStreamEvent> {
  const registry = await loadProviderRegistry();
  const profile = registry.providers.find((p) => p.id === request.providerId);
  if (!profile) {
    yield { type: "error", latencyMs: 0, error: "Provider not found" };
    return;
  }

  const testCfg = resolveTestConfig(profile, registry);
  let model: string;
  try {
    model = resolveEnabledModel(
      profile,
      request.model || testCfg.testModel || profile.defaultModel,
    );
  } catch {
    yield { type: "error", latencyMs: 0, error: "No enabled model specified" };
    return;
  }
  if (!profile.apiKey) {
    yield { type: "error", latencyMs: 0, error: "API key not configured" };
    return;
  }

  const prompt = request.prompt ?? testCfg.testPrompt ?? "hi";
  const timeoutMs = (testCfg.timeoutSec ?? 45) * 1000;
  const maxRetries = 0;

  let lastError: string | undefined;
  const start = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let gotSuccess = false;

    try {
      for await (const chunk of openaiCompatibleStream(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 1,
          signal: controller.signal,
        },
        profile,
      )) {
        if (chunk.type === "error") {
          throw new Error(chunk.error ?? "LLM stream error");
        }
        if (!isTestSuccessChunk(chunk)) continue;

        gotSuccess = true;
        clearTimeout(timer);
        controller.abort();
        break;
      }

      clearTimeout(timer);
      if (gotSuccess) {
        yield { type: "success", latencyMs: Date.now() - start };
        return;
      }

      yield { type: "success", latencyMs: Date.now() - start };
      return;
    } catch (error) {
      clearTimeout(timer);
      if (gotSuccess) {
        yield { type: "success", latencyMs: Date.now() - start };
        return;
      }
      if (error instanceof Error && error.name === "AbortError") {
        yield { type: "success", latencyMs: Date.now() - start };
        return;
      }
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
    }
  }

  yield {
    type: "error",
    latencyMs: Date.now() - start,
    error: lastError ?? "Test failed",
  };
}

export async function testProvider(
  request: ProviderTestRequest,
): Promise<ProviderTestResult> {
  for await (const event of testProviderStream(request)) {
    if (event.type === "success") {
      return {
        success: true,
        latencyMs: event.latencyMs,
        response: event.response,
      };
    }
    return {
      success: false,
      latencyMs: event.latencyMs,
      error: event.error,
    };
  }
  return { success: false, latencyMs: 0, error: "Test failed" };
}

export function listPresets() {
  return PROVIDER_PRESETS;
}

/** Bridge legacy KakoConfig loader to provider registry. */
export async function loadConfigFromRegistry() {
  const registry = await loadProviderRegistry();
  const { profile, model } = getActiveProvider(registry);
  return { registry, profile, model };
}
