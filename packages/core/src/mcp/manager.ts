import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpConnectResult,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  McpToolsSyncResult,
} from "@kako/shared";
import { mcpToolName } from "@kako/shared";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { mcpSecurityMetadata } from "../security/tool-metadata.js";
import { kakoFetch, runWithFetchSecurityScope } from "../net/isolated-fetch.js";
import { loadNetworkPolicy } from "../config/network-store.js";
import { loadMcpRegistry } from "./config.js";
import { resolveMcpExceptionHosts } from "./network-access.js";
import {
  getCachedToolsForServer,
  listAllCachedTools,
  removeCachedToolsForServer,
  setCachedToolsForServer,
} from "./tool-cache.js";

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
}

interface ConnectionState {
  failures: number;
  retrying: boolean;
  giveUp: boolean;
  lastError?: string;
}

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CONNECT_ATTEMPTS = 5;
/** Stepped retry delays (ms) between attempts. */
const CONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private connectionStates = new Map<string, ConnectionState>();
  private connectJobs = new Map<string, Promise<void>>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  startPeriodicToolsSync(intervalMs = DEFAULT_SYNC_INTERVAL_MS): void {
    this.stopPeriodicToolsSync();
    this.syncTimer = setInterval(() => {
      void this.syncToolsForEnabled().catch((error) => {
        console.error(
          "MCP periodic tools sync failed:",
          error instanceof Error ? error.message : error,
        );
      });
    }, intervalMs);
    if (typeof this.syncTimer.unref === "function") {
      this.syncTimer.unref();
    }
  }

  stopPeriodicToolsSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async connectAll(): Promise<void> {
    const registry = await loadMcpRegistry();
    for (const server of registry.servers) {
      if (!server.enabled) continue;
      this.startConnectJob(server, { syncTools: true });
    }
  }

  /** Connect newly enabled servers and disconnect disabled ones without resetting all. */
  async syncConnections(): Promise<void> {
    const registry = await loadMcpRegistry();
    const byId = new Map(registry.servers.map((s) => [s.id, s]));

    for (const id of [...this.servers.keys()]) {
      const config = byId.get(id);
      if (!config || !config.enabled) {
        await this.disconnect(id);
        this.clearConnectionState(id);
      }
    }

    for (const server of registry.servers) {
      if (!server.enabled || this.servers.has(server.id)) continue;
      const state = this.connectionStates.get(server.id);
      if (state?.giveUp) continue;
      this.startConnectJob(server, { syncTools: true });
    }
  }

  startConnectJob(
    config: McpServerConfig,
    options?: { syncTools?: boolean; manual?: boolean },
  ): void {
    if (!config.enabled) return;

    if (options?.manual) {
      this.clearConnectionState(config.id);
    }

    if (this.servers.has(config.id)) return;

    const state = this.connectionStates.get(config.id);
    if (state?.retrying && !options?.manual) return;
    if (state?.giveUp && !options?.manual) return;

    const job = this.runConnectJob(config, options?.syncTools ?? false);
    this.connectJobs.set(config.id, job);
    void job.finally(() => {
      if (this.connectJobs.get(config.id) === job) {
        this.connectJobs.delete(config.id);
      }
    });
  }

  async connectServer(serverId: string): Promise<McpConnectResult> {
    const registry = await loadMcpRegistry();
    const config = registry.servers.find((s) => s.id === serverId);
    if (!config) {
      return { serverId, connected: false, error: "Server not found" };
    }
    if (!config.enabled) {
      return { serverId, connected: false, error: "Server is disabled" };
    }

    this.clearConnectionState(serverId);
    await this.runConnectJob(config, true);

    if (this.isConnected(serverId)) {
      return { serverId, connected: true };
    }

    const state = this.connectionStates.get(serverId);
    return {
      serverId,
      connected: false,
      error: state?.lastError ?? "Failed to connect",
    };
  }

  getConnectionStatus(
    serverId: string,
    enabled: boolean,
  ): Pick<McpServerStatus, "connected" | "connecting" | "connectFailed" | "connectError"> {
    if (!enabled) {
      return { connected: false, connecting: false, connectFailed: false };
    }

    const connected = this.isConnected(serverId);
    if (connected) {
      return { connected: true, connecting: false, connectFailed: false };
    }

    const state = this.connectionStates.get(serverId);
    return {
      connected: false,
      connecting: state?.retrying ?? false,
      connectFailed: state?.giveUp ?? false,
      connectError: state?.lastError,
    };
  }

  private async runConnectJob(config: McpServerConfig, syncTools: boolean): Promise<void> {
    const state = this.getOrCreateState(config.id);
    state.retrying = true;
    state.giveUp = false;

    for (let attempt = 0; attempt < MAX_CONNECT_ATTEMPTS; attempt++) {
      if (this.servers.has(config.id)) {
        state.failures = 0;
        state.retrying = false;
        state.giveUp = false;
        state.lastError = undefined;
        return;
      }

      try {
        await this.connect(config);
        state.failures = 0;
        state.retrying = false;
        state.giveUp = false;
        state.lastError = undefined;
        if (syncTools) {
          await this.syncToolsForServer(config.id);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = attempt + 1;
        state.lastError = message;
        console.error(
          `MCP server ${config.name} connect attempt ${attempt + 1}/${MAX_CONNECT_ATTEMPTS} failed:`,
          message,
        );

        if (attempt < MAX_CONNECT_ATTEMPTS - 1) {
          await sleep(CONNECT_RETRY_DELAYS_MS[attempt] ?? 30_000);
        }
      }
    }

    state.giveUp = true;
    state.retrying = false;
  }

  private getOrCreateState(serverId: string): ConnectionState {
    let state = this.connectionStates.get(serverId);
    if (!state) {
      state = { failures: 0, retrying: false, giveUp: false };
      this.connectionStates.set(serverId, state);
    }
    return state;
  }

  private clearConnectionState(serverId: string): void {
    this.connectionStates.delete(serverId);
    this.connectJobs.delete(serverId);
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client({ name: "kako", version: "0.1.0" });
    const remoteInit = {
      requestInit: {
        headers: config.headers,
      },
      fetch: kakoFetch,
    };
    const transport =
      config.transport === "http"
        ? new StreamableHTTPClientTransport(new URL(config.url!), {
            ...remoteInit,
            reconnectionOptions: {
              initialReconnectionDelay: 2_000,
              maxReconnectionDelay: 30_000,
              reconnectionDelayGrowFactor: 1.5,
              maxRetries: 3,
            },
          })
        : config.transport === "sse"
          ? new SSEClientTransport(new URL(config.url!), remoteInit)
          : new StdioClientTransport({
              command: config.command!,
              args: config.args ?? [],
              env: { ...process.env, ...config.env } as Record<string, string>,
            });

    const networkPolicy = await loadNetworkPolicy();
    const mcpRegistry = await loadMcpRegistry();
    const networkDisabled = !networkPolicy.enabled;
    const mcpExceptionHosts = networkDisabled
      ? resolveMcpExceptionHosts(mcpRegistry.servers, networkPolicy)
      : undefined;

    await runWithFetchSecurityScope(
      {
        enforceNetworkPolicy: true,
        networkPolicy,
        sessionAllowedHosts: new Set(),
        mcpContext: networkDisabled,
        mcpExceptionHosts,
      },
      async () => {
        await client.connect(transport);
      },
    );
    this.servers.set(config.id, { config, client });
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (entry) {
      await entry.client.close();
      this.servers.delete(serverId);
    }
  }

  resetConnectionState(serverId: string): void {
    this.clearConnectionState(serverId);
  }

  async disconnectAll(): Promise<void> {
    for (const id of [...this.servers.keys()]) {
      await this.disconnect(id);
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    return listAllCachedTools();
  }

  async listToolsForServerId(serverId: string): Promise<McpToolInfo[]> {
    const cached = await getCachedToolsForServer(serverId);
    return cached?.tools ?? [];
  }

  async getToolsSyncedAt(serverId: string): Promise<string | undefined> {
    const cached = await getCachedToolsForServer(serverId);
    return cached?.syncedAt;
  }

  isConnected(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  async syncToolsForServer(serverId: string): Promise<McpToolsSyncResult> {
    const registry = await loadMcpRegistry();
    const config = registry.servers.find((s) => s.id === serverId);
    if (!config) {
      return { serverId, connected: false, toolCount: 0, error: "Server not found" };
    }
    if (!config.enabled) {
      return { serverId, connected: false, toolCount: 0, error: "Server is disabled" };
    }

    try {
      if (!this.servers.has(serverId)) {
        await this.connect(config);
        const state = this.getOrCreateState(serverId);
        state.failures = 0;
        state.retrying = false;
        state.giveUp = false;
        state.lastError = undefined;
      }
      const entry = this.servers.get(serverId);
      if (!entry) {
        return { serverId, connected: false, toolCount: 0, error: "Failed to connect" };
      }

      const tools = await this.fetchToolsLive(entry.config, entry.client);
      const syncedAt = new Date().toISOString();
      await setCachedToolsForServer({
        serverId: config.id,
        serverName: config.name,
        syncedAt,
        tools,
      });
      return {
        serverId,
        connected: true,
        toolCount: tools.length,
        syncedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.disconnect(serverId).catch(() => {});
      const cached = await getCachedToolsForServer(serverId);
      return {
        serverId,
        connected: false,
        toolCount: cached?.tools.length ?? 0,
        syncedAt: cached?.syncedAt,
        error: message,
      };
    }
  }

  async syncToolsForEnabled(): Promise<McpToolsSyncResult[]> {
    const registry = await loadMcpRegistry();
    const results: McpToolsSyncResult[] = [];
    for (const server of registry.servers) {
      if (!server.enabled) continue;
      if (!this.servers.has(server.id)) continue;
      results.push(await this.syncToolsForServer(server.id));
    }
    return results;
  }

  private async fetchToolsLive(
    config: McpServerConfig,
    client: Client,
  ): Promise<McpToolInfo[]> {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      serverId: config.id,
      serverName: config.name,
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));
  }

  getToolDefinitions(): ToolDefinition[] {
    return [];
  }

  async getToolDefinitionsAsync(): Promise<ToolDefinition[]> {
    const infos: McpToolInfo[] = [];
    for (const { config, client } of this.servers.values()) {
      infos.push(...(await this.fetchToolsLive(config, client)));
    }
    return infos.map((info) => ({
      name: mcpToolName(info.serverId, info.name),
      description: `[MCP:${info.serverName}] ${info.description}`,
      inputSchema: info.inputSchema,
    }));
  }

  createHandler(serverId: string, toolName: string): ToolHandler {
    return async (input) => {
      const entry = this.servers.get(serverId);
      if (!entry) {
        throw new Error(`MCP server not connected: ${serverId}`);
      }
      const result = await entry.client.callTool({ name: toolName, arguments: input });
      const content = result.content as Array<{ type: string; text?: string }>;
      if (result.isError) {
        const text = content
          .map((c) => ("text" in c && c.text ? c.text : JSON.stringify(c)))
          .join("\n");
        throw new Error(text || "MCP tool error");
      }
      return content
        .map((c) => ("text" in c && c.text ? c.text : JSON.stringify(c)))
        .join("\n");
    };
  }

  async registerTo(
    register: (definition: ToolDefinition, handler: ToolHandler) => void,
  ): Promise<void> {
    for (const { config, client } of this.servers.values()) {
      const tools = await this.fetchToolsLive(config, client);
      for (const info of tools) {
        const transport = config.transport ?? "stdio";
        const security = mcpSecurityMetadata(transport);
        const definition: ToolDefinition = {
          name: mcpToolName(info.serverId, info.name),
          description: `[MCP:${info.serverName}] ${info.description}`,
          inputSchema: info.inputSchema,
          security,
          requiresConfirmation: security.sideEffect || security.requiresNetwork,
        };
        register(definition, this.createHandler(info.serverId, info.name));
      }
    }
  }

  async onServerRemoved(serverId: string): Promise<void> {
    this.clearConnectionState(serverId);
    await this.disconnect(serverId).catch(() => {});
    await removeCachedToolsForServer(serverId);
  }
}

export const mcpManager = new McpManager();
