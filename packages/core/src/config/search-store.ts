import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SearchProviderId, SearchProviderProfile, SearchRegistry } from "@kako/shared";
import { getConfigDir } from "./paths.js";
import { SEARCH_PROVIDER_PRESETS } from "./search-presets.js";

const providerSchema = z.object({
  id: z.enum(["doubao", "brave", "serpapi", "bing", "duckduckgo"]),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  count: z.number().optional(),
  searchType: z.enum(["web", "image"]).optional(),
  timeRange: z.string().optional(),
  authLevel: z.union([z.literal(0), z.literal(1)]).optional(),
});

const registrySchema = z.object({
  version: z.number().default(1),
  providers: z.array(providerSchema),
});

function searchConfigPath(): string {
  return join(getConfigDir(), "search.json");
}

/** Providers that work without an API key regardless of preset metadata. */
const SEARCH_NO_KEY_PROVIDERS = new Set<SearchProviderId>(["bing", "duckduckgo"]);

function defaultProvider(id: SearchProviderId): SearchProviderProfile {
  const needsKey = id === "doubao" || id === "brave" || id === "serpapi";
  return {
    id,
    enabled: !needsKey,
    ...(id === "doubao"
      ? { baseUrl: "https://open.feedcoopapi.com", count: 10, searchType: "web" as const, authLevel: 0 as const }
      : {}),
  };
}

function mergeEnvKeys(profile: SearchProviderProfile): SearchProviderProfile {
  if (profile.apiKey?.trim()) return profile;
  const envKey =
    profile.id === "doubao"
      ? process.env.DOUBAO_API_KEY ?? process.env.DOUBAO_SEARCH_API_KEY
      : profile.id === "brave"
        ? process.env.BRAVE_SEARCH_API_KEY
        : profile.id === "serpapi"
          ? process.env.SERPAPI_KEY
          : undefined;
  if (!envKey?.trim()) return profile;
  return { ...profile, apiKey: envKey.trim() };
}

export function normalizeSearchRegistry(raw: SearchRegistry): SearchRegistry {
  const byId = new Map(raw.providers.map((p) => [p.id, p]));
  const ordered: SearchProviderProfile[] = [];

  for (const preset of SEARCH_PROVIDER_PRESETS) {
    const existing = byId.get(preset.id);
    ordered.push(mergeEnvKeys(existing ?? defaultProvider(preset.id)));
    byId.delete(preset.id);
  }

  for (const extra of byId.values()) {
    ordered.push(mergeEnvKeys(extra));
  }

  return { version: raw.version ?? 1, providers: ordered };
}

export async function loadSearchRegistry(): Promise<SearchRegistry> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(searchConfigPath(), "utf-8");
    return normalizeSearchRegistry(registrySchema.parse(JSON.parse(text)));
  } catch {
    const defaults = normalizeSearchRegistry({
      version: 1,
      providers: SEARCH_PROVIDER_PRESETS.map((p) => defaultProvider(p.id)),
    });
    await saveSearchRegistry(defaults);
    return defaults;
  }
}

export async function saveSearchRegistry(registry: SearchRegistry): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  const normalized = normalizeSearchRegistry(registry);
  await writeFile(searchConfigPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export async function updateSearchRegistry(
  providers: SearchProviderProfile[],
): Promise<SearchRegistry> {
  const registry: SearchRegistry = { version: 1, providers };
  await saveSearchRegistry(registry);
  return loadSearchRegistry();
}

export function isSearchProviderReady(profile: SearchProviderProfile): boolean {
  if (!profile.enabled) return false;
  if (SEARCH_NO_KEY_PROVIDERS.has(profile.id)) return true;
  const preset = SEARCH_PROVIDER_PRESETS.find((p) => p.id === profile.id);
  if (preset?.requiresApiKey && !profile.apiKey?.trim()) return false;
  return true;
}

export function searchProviderReadyError(profile: SearchProviderProfile): string | null {
  if (!profile.enabled) return "搜索后端未启用";
  if (SEARCH_NO_KEY_PROVIDERS.has(profile.id)) return null;
  const preset = SEARCH_PROVIDER_PRESETS.find((p) => p.id === profile.id);
  if (preset?.requiresApiKey && !profile.apiKey?.trim()) {
    return `${preset.name} 需要配置 API Key`;
  }
  return null;
}
