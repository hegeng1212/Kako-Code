import {
  getActiveProvider,
  loadProviderRegistry,
  loadMcpRegistry,
  listPresets,
  addProviderFromPreset,
  upsertProvider,
  removeProvider,
  setActiveProvider,
  testProvider,
  testProviderStream,
  setGlobalTestConfig,
  upsertMcpServer,
  removeMcpServer,
  MCP_PRESETS,
  mcpManager,
  getMcpObservabilitySummary,
  queryMcpCallLogs,
  getObservabilityStats,
  initializeKakoHome,
  KAKO_CORE_VERSION,
  KAKO_LICENSE,
  KAKO_LICENSE_URL,
  listInstalledSkills,
  installSkillFromHub,
  installSkillsFromGithub,
  installSkillsFromArchive,
  installSkillFromContent,
  continueSkillBuildChat,
  buildSkillToolCatalog,
  validateSkillDependencies,
  loadAgent,
  DEFAULT_BUILTIN_TOOL_NAMES,
  uninstallSkill,
  searchSkillHub,
  analyzeSkillHubRepo,
  analyzeGithubRepo,
  fetchPopularSkillHub,
  setSkillEnabled,
  openPathInFileManager,
} from "@kako/core";
import type { ProviderProfile, ProviderTestConfig, McpServerConfig } from "@kako/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { resolveWebDistDir, tryServeWebStatic } from "./web-static.js";

const app = new Hono();

async function validateSkillMd(skillMd: string) {
  const agent = await loadAgent("main", process.cwd());
  const mcpTools = await mcpManager.listTools();
  const catalog = buildSkillToolCatalog(
    agent.tools ?? DEFAULT_BUILTIN_TOOL_NAMES,
    mcpTools,
  );
  return validateSkillDependencies(skillMd, catalog);
}

app.use("*", cors());

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    version: KAKO_CORE_VERSION,
    license: KAKO_LICENSE,
    licenseUrl: KAKO_LICENSE_URL,
    webUi: Boolean(resolveWebDistDir()),
  }),
);

app.get("/", (c) => {
  if (resolveWebDistDir()) return c.notFound();
  return c.text(
    [
      "Kako API is running but the settings Web UI is not attached on this port.",
      "",
      "Run:  kako web",
      "Dev:  pnpm dev:web  →  http://localhost:5173",
    ].join("\n"),
    503,
    { "content-type": "text/plain; charset=utf-8" },
  );
});

// --- Provider presets ---
app.get("/api/presets", (c) => c.json(listPresets()));

// --- Provider registry ---
app.get("/api/providers", async (c) => {
  const registry = await loadProviderRegistry();
  return c.json(registry);
});

app.post("/api/providers", async (c) => {
  const body = await c.req.json<ProviderProfile>();
  const registry = await upsertProvider(body);
  return c.json(registry);
});

app.post("/api/providers/from-preset", async (c) => {
  const body = await c.req.json<{
    presetId: string;
    apiKey?: string;
    models?: string[];
    defaultModel?: string;
  }>();
  const registry = await addProviderFromPreset(body.presetId, body);
  return c.json(registry);
});

app.delete("/api/providers/:id", async (c) => {
  const registry = await removeProvider(c.req.param("id"));
  return c.json(registry);
});

app.put("/api/providers/active", async (c) => {
  const body = await c.req.json<{ providerId: string; model: string }>();
  const registry = await setActiveProvider(body);
  return c.json(registry);
});

app.get("/api/providers/active", async (c) => {
  const registry = await loadProviderRegistry();
  const active = getActiveProvider(registry);
  return c.json({
    selection: registry.active,
    provider: active.profile,
    model: active.model,
  });
});

app.put("/api/providers/global-test", async (c) => {
  const body = await c.req.json<ProviderTestConfig>();
  const registry = await setGlobalTestConfig(body);
  return c.json(registry);
});

app.post("/api/providers/test", async (c) => {
  const body = await c.req.json<{
    providerId: string;
    model?: string;
    prompt?: string;
  }>();
  const result = await testProvider(body);
  return c.json(result);
});

app.post("/api/providers/test/stream", async (c) => {
  const body = await c.req.json<{
    providerId: string;
    model?: string;
    prompt?: string;
  }>();
  return streamSSE(c, async (stream) => {
    for await (const event of testProviderStream(body)) {
      await stream.writeSSE({ data: JSON.stringify(event) });
      return;
    }
  });
});

// --- MCP servers ---
app.get("/api/mcp", async (c) => {
  const registry = await loadMcpRegistry();
  return c.json(registry);
});

app.get("/api/mcp/presets", (c) => c.json(MCP_PRESETS));

app.post("/api/mcp", async (c) => {
  const body = await c.req.json<McpServerConfig>();
  const registry = await upsertMcpServer(body);
  await mcpManager.disconnect(body.id).catch(() => {});
  if (body.enabled) {
    mcpManager.startConnectJob(body, { syncTools: true });
  }
  return c.json(registry);
});

app.delete("/api/mcp/:id", async (c) => {
  const id = c.req.param("id");
  await mcpManager.onServerRemoved(id);
  const registry = await removeMcpServer(id);
  return c.json(registry);
});

app.get("/api/mcp/tools", async (c) => {
  const tools = await mcpManager.listTools();
  return c.json({ tools });
});

app.get("/api/mcp/status", async (c) => {
  const registry = await loadMcpRegistry();
  const tools = await mcpManager.listTools();
  const toolCountByServer = new Map<string, number>();
  for (const tool of tools) {
    toolCountByServer.set(tool.serverId, (toolCountByServer.get(tool.serverId) ?? 0) + 1);
  }
  const servers = await Promise.all(
    registry.servers.map(async (s) => ({
      id: s.id,
      name: s.name,
      ...mcpManager.getConnectionStatus(s.id, s.enabled),
      toolCount: toolCountByServer.get(s.id) ?? 0,
      toolsSyncedAt: await mcpManager.getToolsSyncedAt(s.id),
    })),
  );
  return c.json({ servers });
});

app.get("/api/mcp/observability/summary", async (c) => {
  const summary = await getMcpObservabilitySummary();
  return c.json(summary);
});

app.get("/api/mcp/observability/logs", async (c) => {
  const serverId = c.req.query("serverId");
  const toolName = c.req.query("toolName");
  const limit = Number(c.req.query("limit") ?? "100");
  const logs = await queryMcpCallLogs({ serverId, toolName, limit });
  return c.json({ logs });
});

app.get("/api/mcp/observability/stats", async (c) => {
  const stats = await getObservabilityStats();
  return c.json(stats);
});

app.get("/api/mcp/:id/tools", async (c) => {
  const id = c.req.param("id");
  const tools = await mcpManager.listToolsForServerId(id);
  const syncedAt = await mcpManager.getToolsSyncedAt(id);
  return c.json({ tools, connected: mcpManager.isConnected(id), syncedAt });
});

app.post("/api/mcp/sync-tools", async (c) => {
  const results = await mcpManager.syncToolsForEnabled();
  const tools = await mcpManager.listTools();
  return c.json({ ok: true, toolCount: tools.length, results });
});

app.post("/api/mcp/:id/sync-tools", async (c) => {
  const id = c.req.param("id");
  const result = await mcpManager.syncToolsForServer(id);
  const tools = await mcpManager.listToolsForServerId(id);
  return c.json({ ...result, tools });
});

app.post("/api/mcp/:id/connect", async (c) => {
  const id = c.req.param("id");
  const result = await mcpManager.connectServer(id);
  return c.json(result);
});

app.post("/api/mcp/sync", async (c) => {
  await mcpManager.syncConnections();
  const tools = await mcpManager.listTools();
  return c.json({ ok: true, toolCount: tools.length });
});

app.put("/api/mcp/:id/enabled", async (c) => {
  const id = c.req.param("id");
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  const registry = await loadMcpRegistry();
  const server = registry.servers.find((s) => s.id === id);
  if (!server) {
    return c.json({ error: "MCP server not found" }, 404);
  }
  const updated: McpServerConfig = { ...server, enabled };
  const next = await upsertMcpServer(updated);
  await mcpManager.disconnect(id).catch(() => {});
  mcpManager.resetConnectionState(id);
  if (enabled) {
    mcpManager.startConnectJob(updated, { syncTools: true });
  }
  return c.json(next);
});

// --- Skills (SkillHub + local registry) ---
app.get("/api/skills", async (c) => {
  const skills = await listInstalledSkills();
  return c.json({ skills });
});

app.get("/api/skills/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const skills = await searchSkillHub(q);
  return c.json({ skills });
});

app.get("/api/skills/popular", async (c) => {
  const limit = Number(c.req.query("limit") ?? "10");
  const skills = await fetchPopularSkillHub(Number.isFinite(limit) ? limit : 10);
  return c.json({ skills });
});

app.post("/api/skills/analyze-repo", async (c) => {
  const body = await c.req.json<{ url: string }>();
  if (!body.url?.trim()) {
    return c.json({ error: "url required" }, 400);
  }
  try {
    const result = await analyzeGithubRepo(body.url.trim());
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.post("/api/skills/install", async (c) => {
  const body = await c.req.json<{
    slug?: string;
    githubUrl?: string;
    paths?: string[];
    sourceIdentifier?: string;
    ownerUsername?: string;
    totalInstalls?: number;
  }>();
  if (body.slug) {
    try {
      const skill = await installSkillFromHub(body.slug, {
        sourceIdentifier: body.sourceIdentifier,
        ownerUsername: body.ownerUsername,
        totalInstalls: body.totalInstalls,
      });
      return c.json({ skills: await listInstalledSkills(), installed: [skill] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }
  }
  if (body.githubUrl) {
    const installed = await installSkillsFromGithub(body.githubUrl, body.paths ?? []);
    return c.json({ skills: await listInstalledSkills(), installed });
  }
  return c.json({ error: "Provide slug or githubUrl" }, 400);
});

app.post("/api/skills/install-zip", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json({ error: "file required" }, 400);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const installed = await installSkillsFromArchive(buffer);
  return c.json({ skills: await listInstalledSkills(), installed });
});

app.post("/api/skills/build", async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  const agent = await loadAgent("main", process.cwd());
  const mcpTools = await mcpManager.listTools();
  const catalog = buildSkillToolCatalog(
    agent.tools ?? DEFAULT_BUILTIN_TOOL_NAMES,
    mcpTools,
  );
  const result = await continueSkillBuildChat({
    messages: [{ role: "user", content: body.prompt ?? "" }],
    catalog,
    mcpTools,
  });
  if (!result.skillMd) {
    return c.json({
      skillMd: "",
      turn: result,
    });
  }
  return c.json({ skillMd: result.skillMd, turn: result });
});

app.post("/api/skills/build-chat", async (c) => {
  const body = await c.req.json<{ messages: Array<{ role: string; content: string }>; draftSkillMd?: string }>();
  if (!body.messages?.length) {
    return c.json({ error: "messages required" }, 400);
  }
  const messages = body.messages.filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  if (messages.at(-1)?.role !== "user") {
    return c.json({ error: "Last message must be from user" }, 400);
  }
  try {
    const agent = await loadAgent("main", process.cwd());
    const mcpTools = await mcpManager.listTools();
    const catalog = buildSkillToolCatalog(
      agent.tools ?? DEFAULT_BUILTIN_TOOL_NAMES,
      mcpTools,
    );
    const result = await continueSkillBuildChat({
      messages,
      draftSkillMd: body.draftSkillMd,
      catalog,
      mcpTools,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.post("/api/skills/validate", async (c) => {
  const body = await c.req.json<{ skillMd: string }>();
  if (!body.skillMd?.trim()) {
    return c.json({ error: "skillMd required" }, 400);
  }
  try {
    const validation = await validateSkillMd(body.skillMd.trim());
    return c.json(validation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.post("/api/skills/save", async (c) => {
  const body = await c.req.json<{ skillMd: string; force?: boolean }>();
  if (!body.skillMd?.trim()) {
    return c.json({ error: "skillMd required" }, 400);
  }
  try {
    const validation = await validateSkillMd(body.skillMd.trim());
    if (!validation.ok && !body.force) {
      return c.json(
        {
          error: "技能依赖的工具不可用或参数不匹配，请先安装 MCP/工具后再保存，或使用 force 强制保存",
          validation,
        },
        400,
      );
    }
    const skill = await installSkillFromContent(body.skillMd, "local");
    return c.json({ skills: await listInstalledSkills(), installed: [skill], validation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.put("/api/skills/:name/enabled", async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  const skill = await setSkillEnabled(c.req.param("name"), body.enabled);
  if (!skill) return c.json({ error: "Skill not found" }, 404);
  return c.json({ skills: await listInstalledSkills() });
});

app.post("/api/skills/open-dir", async (c) => {
  const body = await c.req.json<{ path: string }>();
  if (!body.path?.trim()) {
    return c.json({ error: "path required" }, 400);
  }
  try {
    await openPathInFileManager(body.path);
    return c.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.delete("/api/skills/:name", async (c) => {
  const removed = await uninstallSkill(c.req.param("name"));
  if (!removed) return c.json({ error: "Skill not found" }, 404);
  return c.json({ skills: await listInstalledSkills() });
});

const port = Number(process.env.KAKO_SERVER_PORT ?? 3721);

import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

let apiServer: Server | null = null;

export function startNodeServer(): Server {
  if (apiServer) return apiServer;
  const webRoot = resolveWebDistDir();
  const server = createServer(async (req, res) => {
    if (webRoot && (await tryServeWebStatic(req, res, webRoot))) {
      return;
    }

    const url = `http://localhost${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? await new Promise<Buffer>((resolve) => {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
          })
        : undefined;

    const response = await app.fetch(
      new Request(url, {
        method: req.method,
        headers,
        body: body?.length ? body : undefined,
      }),
    );

    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const text = await response.text();
    res.end(text);
  });

  server.listen(port, () => {
    const base = `http://localhost:${port}`;
    if (webRoot) {
      console.log(`Kako settings UI: ${base}`);
    }
    console.log(`Kako server listening on ${base}`);
    void initializeKakoHome().catch((error) => {
      console.error(
        "Kako home initialization failed:",
        error instanceof Error ? error.message : error,
      );
    });
    void mcpManager.connectAll().catch((error) => {
      console.error(
        "MCP auto-connect on startup failed:",
        error instanceof Error ? error.message : error,
      );
    });
    const syncIntervalMs = Number(process.env.KAKO_MCP_SYNC_INTERVAL_MS ?? "300000");
    if (syncIntervalMs > 0) {
      mcpManager.startPeriodicToolsSync(syncIntervalMs);
    }
  });
  apiServer = server;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startNodeServer();
}

export default app;
