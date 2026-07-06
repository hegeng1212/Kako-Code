import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { LLMProviderConfig, LLMRoutingConfig } from "@kako/shared";
import { getConfigDir } from "./paths.js";

const providerSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().default(true),
});

const providersFileSchema = z.object({
  providers: z.record(providerSchema).default({}),
  routing: z
    .object({
      defaultModel: z.string().default("anthropic/claude-sonnet-4-20250514"),
      fallbackChain: z.array(z.string()).optional(),
      maxRetries: z.number().default(3),
      retryDelayMs: z.number().default(1000),
    })
    .default({}),
});

export interface KakoConfig {
  providers: Record<string, LLMProviderConfig>;
  routing: LLMRoutingConfig;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    return process.env[name] ?? "";
  });
}

function expandEnvDeep<T>(input: T): T {
  if (typeof input === "string") {
    return expandEnv(input) as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => expandEnvDeep(item)) as T;
  }
  if (input && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = expandEnvDeep(value);
    }
    return result as T;
  }
  return input;
}

export async function loadConfig(): Promise<KakoConfig> {
  const configPath = join(getConfigDir(), "providers.yaml");
  let raw: unknown;

  try {
    const text = await readFile(configPath, "utf-8");
    raw = parseYaml(text);
  } catch {
    raw = {};
  }

  const parsed = providersFileSchema.parse(expandEnvDeep(raw ?? {}));
  const providers: Record<string, LLMProviderConfig> = {};

  for (const [id, cfg] of Object.entries(parsed.providers)) {
    providers[id] = {
      id: id as LLMProviderConfig["id"],
      apiKey: cfg.apiKey || getEnvApiKey(id),
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel,
      enabled: cfg.enabled,
    };
  }

  ensureDefaultProviders(providers);

  return {
    providers,
    routing: {
      defaultModel: parsed.routing.defaultModel,
      fallbackChain: parsed.routing.fallbackChain,
      maxRetries: parsed.routing.maxRetries,
      retryDelayMs: parsed.routing.retryDelayMs,
    },
  };
}

function getEnvApiKey(providerId: string): string | undefined {
  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  };
  const envVar = envMap[providerId];
  return envVar ? process.env[envVar] : undefined;
}

function ensureDefaultProviders(
  providers: Record<string, LLMProviderConfig>,
): void {
  if (!providers.anthropic) {
    providers.anthropic = {
      id: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      enabled: true,
      defaultModel: "claude-sonnet-4-20250514",
    };
  }
  if (!providers.openai) {
    providers.openai = {
      id: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      enabled: true,
      defaultModel: "gpt-4o",
    };
  }
}
