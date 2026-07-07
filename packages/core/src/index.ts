import { initializeKakoHome } from "./config/bootstrap.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./agent/runtime.js";
import { createLLMRouter } from "./llm/router.js";
import type { ProviderRegistry } from "@kako/shared";
import { loadProviderRegistry } from "./config/provider-store.js";
import { mcpManager } from "./mcp/manager.js";

export { getKakoHome, getAgentsDir, getSkillsDir } from "./config/paths.js";
export { initializeKakoHome } from "./config/bootstrap.js";
export { AgentRuntime, type AgentRuntimeOptions, type TurnResult } from "./agent/runtime.js";
export { TurnAbortedError } from "./agent/loop.js";
export { loadAgent, loadProjectContext, loadGlobalUserContext, loadWorkspaceKakoMd } from "./agent/loader.js";
export { createLLMRouter, resolveModel } from "./llm/router.js";
export { FileMemoryStore } from "./memory/store.js";
export {
  SessionManager,
  sessionManager,
} from "./session/manager.js";
export {
  handleSlashCommand,
  formatSlashHelp,
  formatSessionList,
} from "./session/slash.js";
export { projectIdFromCwd } from "./session/project-id.js";
export {
  loadProviderRegistry,
  saveProviderRegistry,
  addProviderFromPreset,
  upsertProvider,
  removeProvider,
  setActiveProvider,
  testProvider,
  testProviderStream,
  setGlobalTestConfig,
  listPresets,
  getActiveProvider,
  checkProviderReadiness,
  getEffectiveApiKey,
} from "./config/provider-store.js";
export { PROVIDER_PRESETS } from "./config/presets.js";
export { MCP_PRESETS } from "./config/mcp-presets.js";
export {
  loadMcpRegistry,
  saveMcpRegistry,
  upsertMcpServer,
  removeMcpServer,
} from "./mcp/config.js";
export { mcpManager, McpManager } from "./mcp/manager.js";
export {
  getMcpObservabilitySummary,
  queryMcpCallLogs,
  getObservabilityStats,
} from "./observability/mcp-metrics.js";
export { getObservabilityDb } from "./observability/db.js";
export {
  BUILTIN_TOOLS,
  DEFAULT_BUILTIN_TOOL_NAMES,
  registerBuiltinTools,
  resolveAllToolNames,
  resolveAllowedToolNames,
} from "./tools/builtin/index.js";
export { ToolRegistry } from "./tools/registry.js";
export {
  readClipboardImage,
  readClipboardText,
  storeClipboardImage,
  storeUserAttachment,
  resolveUserTurnInput,
  findLeadingAbsolutePath,
  parsePathReferences,
  isImagePath,
  normalizeClipboardPath,
} from "./media/index.js";
export {
  ensurePlanFile,
  planFilePathForSession,
  readPlanFile,
} from "./tools/builtin/plan-mode-shared.js";
export {
  discoverSkills,
  filterSkillsForAgent,
  formatSkillsIndex,
  installSkillFromHub,
  installSkillsFromGithub,
  installSkillFromContent,
  installSkillsFromArchive,
  buildSkillDraft,
  continueSkillBuildChat,
  buildSkillToolCatalog,
  validateSkillDependencies,
  listInstalledSkills,
  searchSkillHub,
  analyzeSkillHubRepo,
  analyzeGithubRepo,
  fetchPopularSkillHub,
  uninstallSkill,
  setSkillEnabled,
  openPathInFileManager,
} from "./skills/index.js";

export {
  resolveKakoInstallRoot,
  resolveWebDist,
  resolveServerEntry,
  defaultSettingsUrl,
} from "./config/install-paths.js";
export const KAKO_CORE_VERSION = "0.2.0";

export interface Harness {
  registry: ProviderRegistry;
  runtime: AgentRuntime;
}

export async function createHarness(
  options: Pick<
    AgentRuntimeOptions,
    | "cwd"
    | "confirm"
    | "askUserQuestion"
    | "onTextDelta"
    | "onReasoningDelta"
    | "onReasoningEnd"
    | "onStreamUsage"
    | "onToolStart"
    | "onToolEnd"
    | "onAnswerRollback"
    | "shouldAbort"
  > & {
    agentName?: string;
  },
): Promise<Harness> {
  await initializeKakoHome();
  const registry = await loadProviderRegistry();
  await mcpManager.connectAll();
  const runtime = new AgentRuntime({ ...options, registry });
  return { registry, runtime };
}

async function ensureDirs(): Promise<void> {
  await initializeKakoHome();
}

export function createRouter(registry: ProviderRegistry) {
  return createLLMRouter(registry);
}

/** @deprecated Use loadProviderRegistry */
export { loadConfig, type KakoConfig } from "./config/loader.js";
