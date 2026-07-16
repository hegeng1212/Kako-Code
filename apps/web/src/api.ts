import type {
  ActiveProviderSelection,
  InstalledSkillRecord,
  McpCallLogEntry,
  McpConnectResult,
  McpObservabilitySummary,
  McpPreset,
  McpRegistry,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  McpToolsSyncResult,
  ProviderPreset,
  ProviderProfile,
  ProviderRegistry,
  ProviderTestResult,
  ProviderTestStreamEvent,
  SearchProviderPreset,
  SearchProviderProfile,
  SearchRegistry,
  SearchTestResult,
  SkillDefinition,
  SkillHubAnalyzeRepoResult,
  SkillHubSearchHit,
  SkillBuildResult,
  SkillBuildChatRequest,
  SkillBuildTurnResult,
  SkillValidationResult,
} from "@kako/shared";

const API = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const text = await res.text();
  if (!res.ok) {
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: string };
        if (body.error) throw new Error(body.error);
      } catch (e) {
        if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
      }
      throw new Error(text);
    }
    throw new Error(`请求失败 (${res.status} ${res.statusText})，请确认 API 服务已启动`);
  }
  if (!text.trim()) {
    throw new Error(`API 返回空响应 (${res.status})，请确认服务已正确构建并重启`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("API 返回无效 JSON，请重启 dev:web 并执行 pnpm --filter @kako/core build");
  }
}

export const api = {
  getHealth: () =>
    request<{
      status: string;
      version: string;
      license?: string;
      licenseUrl?: string;
      webUi?: boolean;
    }>("/health"),
  getPresets: () => request<ProviderPreset[]>("/presets"),
  getProviders: () => request<ProviderRegistry>("/providers"),
  addFromPreset: (body: {
    presetId: string;
    apiKey?: string;
    models?: string[];
    defaultModel?: string;
  }) =>
    request<ProviderRegistry>("/providers/from-preset", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveProvider: (profile: ProviderProfile) =>
    request<ProviderRegistry>("/providers", {
      method: "POST",
      body: JSON.stringify(profile),
    }),
  removeProvider: (id: string) =>
    request<ProviderRegistry>(`/providers/${id}`, { method: "DELETE" }),
  setActive: (providerId: string, model: string) =>
    request<ProviderRegistry>("/providers/active", {
      method: "PUT",
      body: JSON.stringify({ providerId, model }),
    }),
  getActive: () =>
    request<{
      selection: ActiveProviderSelection;
      provider: ProviderProfile;
      model: string;
    }>("/providers/active"),
  testProvider: (body: { providerId: string; model?: string; prompt?: string }) =>
    request<ProviderTestResult>("/providers/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  testProviderStream: async (
    body: { providerId: string; model?: string; prompt?: string },
    onEvent: (event: ProviderTestStreamEvent) => void,
  ): Promise<void> => {
    const res = await fetch(`${API}/providers/test/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        onEvent(JSON.parse(payload) as ProviderTestStreamEvent);
        return;
      }
    }
  },
  getMcp: () => request<McpRegistry>("/mcp"),
  getMcpPresets: () => request<McpPreset[]>("/mcp/presets"),
  getMcpStatus: () => request<{ servers: McpServerStatus[] }>("/mcp/status"),
  saveMcp: (server: McpServerConfig) =>
    request<McpRegistry>("/mcp", { method: "POST", body: JSON.stringify(server) }),
  removeMcp: (id: string) =>
    request<McpRegistry>(`/mcp/${id}`, { method: "DELETE" }),
  connectMcp: (id: string) =>
    request<McpConnectResult>(`/mcp/${id}/connect`, { method: "POST" }),
  syncMcp: () =>
    request<{ ok: boolean; toolCount: number }>("/mcp/sync", { method: "POST" }),
  setMcpEnabled: (id: string, enabled: boolean) =>
    request<McpRegistry>(`/mcp/${id}/enabled`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  syncMcpTools: (serverId?: string) =>
    serverId
      ? request<McpToolsSyncResult & { tools: McpToolInfo[] }>(`/mcp/${serverId}/sync-tools`, {
          method: "POST",
        })
      : request<{ ok: boolean; toolCount: number; results: McpToolsSyncResult[] }>(
          "/mcp/sync-tools",
          { method: "POST" },
        ),
  listMcpTools: () => request<{ tools: McpToolInfo[] }>("/mcp/tools"),
  getMcpObservability: () => request<McpObservabilitySummary>("/mcp/observability/summary"),
  getMcpObservabilityStats: () =>
    request<{ totalLogs: number; mcpLogs: number; dbPath: string }>(
      "/mcp/observability/stats",
    ),
  getMcpLogs: (params: { serverId?: string; toolName?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.serverId) q.set("serverId", params.serverId);
    if (params.toolName) q.set("toolName", params.toolName);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ logs: McpCallLogEntry[] }>(
      `/mcp/observability/logs${qs ? `?${qs}` : ""}`,
    );
  },
  getSkills: () => request<{ skills: InstalledSkillRecord[] }>("/skills"),
  getSkillDetail: (name: string) =>
    request<{ record: InstalledSkillRecord; definition: SkillDefinition }>(
      `/skills/${encodeURIComponent(name)}`,
    ),
  searchSkills: (q: string) =>
    request<{ skills: SkillHubSearchHit[] }>(`/skills/search?q=${encodeURIComponent(q)}`),
  getPopularSkills: (limit = 10) =>
    request<{ skills: SkillHubSearchHit[] }>(`/skills/popular?limit=${limit}`),
  analyzeSkillRepo: (url: string) =>
    request<SkillHubAnalyzeRepoResult>("/skills/analyze-repo", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  installSkill: (body: {
    slug?: string;
    githubUrl?: string;
    paths?: string[];
    sourceIdentifier?: string;
    ownerUsername?: string;
    totalInstalls?: number;
  }) =>
    request<{ skills: InstalledSkillRecord[]; installed?: InstalledSkillRecord[] }>(
      "/skills/install",
      { method: "POST", body: JSON.stringify(body) },
    ),
  removeSkill: (name: string) =>
    request<{ skills: InstalledSkillRecord[] }>(`/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  setSkillEnabled: (name: string, enabled: boolean) =>
    request<{ skills: InstalledSkillRecord[] }>(
      `/skills/${encodeURIComponent(name)}/enabled`,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    ),
  installSkillZip: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/skills/install-zip`, { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json() as Promise<{
      skills: InstalledSkillRecord[];
      installed?: InstalledSkillRecord[];
    }>;
  },
  buildSkill: (prompt: string) =>
    request<SkillBuildResult & { turn?: SkillBuildTurnResult }>("/skills/build", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  buildSkillChat: (body: SkillBuildChatRequest) =>
    request<SkillBuildTurnResult>("/skills/build-chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  validateSkill: (skillMd: string) =>
    request<SkillValidationResult>("/skills/validate", {
      method: "POST",
      body: JSON.stringify({ skillMd }),
    }),
  saveSkill: async (skillMd: string, force = false) => {
    const res = await fetch(`${API}/skills/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillMd, force }),
    });
    const text = await res.text();
    if (!res.ok) {
      if (text) {
        try {
          const body = JSON.parse(text) as {
            error?: string;
            validation?: SkillValidationResult;
          };
          const err = new Error(body.error ?? text) as Error & {
            validation?: SkillValidationResult;
          };
          err.validation = body.validation;
          throw err;
        } catch (e) {
          if (e instanceof Error && "validation" in e) throw e;
        }
        throw new Error(text);
      }
      throw new Error(`保存失败 (${res.status})`);
    }
    return JSON.parse(text) as {
      skills: InstalledSkillRecord[];
      installed?: InstalledSkillRecord[];
      validation?: SkillValidationResult;
    };
  },
  openSkillDir: (path: string) =>
    request<{ ok: boolean }>("/skills/open-dir", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  getSearchPresets: () => request<SearchProviderPreset[]>("/search/presets"),
  getSearch: () => request<SearchRegistry>("/search"),
  saveSearch: (providers: SearchProviderProfile[]) =>
    request<SearchRegistry>("/search", {
      method: "PUT",
      body: JSON.stringify({ providers }),
    }),
  testSearch: (body: { providerId: string; query?: string }) =>
    request<SearchTestResult>("/search/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSecurity: (cwd?: string) =>
    request<import("@kako/shared").SecurityConfigFile>(
      `/security${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`,
    ),
  saveSecurity: (config: import("@kako/shared").SecurityConfigFile, cwd?: string) =>
    request<import("@kako/shared").SecurityConfigFile>(
      `/security${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`,
      {
        method: "PUT",
        body: JSON.stringify(cwd ? { ...config, cwd } : config),
      },
    ),
  getNetwork: () => request<import("@kako/shared").NetworkConfigFile>("/network"),
  saveNetwork: (config: import("@kako/shared").NetworkConfigFile) =>
    request<import("@kako/shared").NetworkConfigFile>("/network", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getMemory: () => request<MemorySettingsFile>("/memory"),
  saveMemory: (config: MemorySettingsFile) =>
    request<MemorySettingsFile>("/memory", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};

/** Mirrors ~/.kako/config/memory.json (from @kako/core MemorySettings). */
export interface MemorySettingsFile {
  version: number;
  autoRecall: { enabled: boolean; maxSnippets?: number; maxTokens?: number };
  writeApproval: { enabled: boolean };
  curated: {
    enabled: boolean;
    notesCharLimit: number;
    userCharLimit: number;
    injectFrozenSnapshot: boolean;
  };
  memoryTool: { enabled: boolean };
  backgroundReview: {
    enabled: boolean;
    model?: string | null;
    providerId?: string | null;
    cooldownSeconds: number;
    maxPerHour: number;
    maxPerDay: number;
    digestMaxChars: number;
    extractFacts: boolean;
    updateCurated: boolean;
  };
  budget: {
    enabled: boolean;
    maxLlmCallsPerHour: number;
    maxLlmCallsPerDay: number;
    maxConcurrentJobs: number;
  };
  jobs: {
    consolidate: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
    curator: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
    dreaming: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
  };
  cli?: { consolidateCommand?: { enabled: boolean } };
  injectCaps?: Record<string, number>;
}
