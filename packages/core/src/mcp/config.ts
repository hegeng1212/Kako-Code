import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpRegistry, McpServerConfig } from "@kako/shared";
import { getConfigDir } from "../config/paths.js";

const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  transport: z.enum(["stdio", "sse", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  preset: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const registrySchema = z.object({
  version: z.number().default(1),
  servers: z.array(serverSchema).default([]),
});

function mcpConfigPath(): string {
  return join(getConfigDir(), "mcp.json");
}

export async function loadMcpRegistry(): Promise<McpRegistry> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(mcpConfigPath(), "utf-8");
    return registrySchema.parse(JSON.parse(text));
  } catch {
    const empty: McpRegistry = { version: 1, servers: [] };
    await saveMcpRegistry(empty);
    return empty;
  }
}

export async function saveMcpRegistry(registry: McpRegistry): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(mcpConfigPath(), `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
}

export async function upsertMcpServer(server: McpServerConfig): Promise<McpRegistry> {
  const registry = await loadMcpRegistry();
  const index = registry.servers.findIndex((s) => s.id === server.id);
  const now = new Date().toISOString();
  const next = { ...server, updatedAt: now };
  if (index >= 0) {
    registry.servers[index] = { ...registry.servers[index], ...next };
  } else {
    registry.servers.push({ ...next, createdAt: now });
  }
  await saveMcpRegistry(registry);
  return registry;
}

export async function removeMcpServer(serverId: string): Promise<McpRegistry> {
  const registry = await loadMcpRegistry();
  registry.servers = registry.servers.filter((s) => s.id !== serverId);
  await saveMcpRegistry(registry);
  return registry;
}
