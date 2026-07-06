import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerToolsCache, McpToolsCacheFile, McpToolInfo } from "@kako/shared";
import { getIndexDir } from "../config/paths.js";

const CACHE_VERSION = 1;

function cachePath(): string {
  return join(getIndexDir(), "mcp-tools.json");
}

function emptyCache(): McpToolsCacheFile {
  return { version: CACHE_VERSION, servers: {} };
}

export async function loadMcpToolsCache(): Promise<McpToolsCacheFile> {
  await mkdir(getIndexDir(), { recursive: true });
  try {
    const text = await readFile(cachePath(), "utf-8");
    const parsed = JSON.parse(text) as McpToolsCacheFile;
    if (!parsed.servers || typeof parsed.servers !== "object") return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

export async function saveMcpToolsCache(cache: McpToolsCacheFile): Promise<void> {
  await mkdir(getIndexDir(), { recursive: true });
  await writeFile(cachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
}

export async function getCachedToolsForServer(
  serverId: string,
): Promise<McpServerToolsCache | null> {
  const cache = await loadMcpToolsCache();
  return cache.servers[serverId] ?? null;
}

export async function setCachedToolsForServer(entry: McpServerToolsCache): Promise<void> {
  const cache = await loadMcpToolsCache();
  cache.servers[entry.serverId] = entry;
  await saveMcpToolsCache(cache);
}

export async function removeCachedToolsForServer(serverId: string): Promise<void> {
  const cache = await loadMcpToolsCache();
  delete cache.servers[serverId];
  await saveMcpToolsCache(cache);
}

export async function listAllCachedTools(): Promise<McpToolInfo[]> {
  const cache = await loadMcpToolsCache();
  const tools: McpToolInfo[] = [];
  for (const entry of Object.values(cache.servers)) {
    tools.push(...entry.tools);
  }
  return tools;
}
