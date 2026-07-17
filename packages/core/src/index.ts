import { initializeKakoHome } from "./config/bootstrap.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./agent/runtime.js";
import { createLLMRouter } from "./llm/router.js";
import type { ProviderRegistry } from "@kako/shared";
import { loadProviderRegistry } from "./config/provider-store.js";
import { mcpManager } from "./mcp/manager.js";

export { getKakoHome, getAgentsDir, getSkillsDir, getSessionReportsDir } from "./config/paths.js";
export { initializeKakoHome } from "./config/bootstrap.js";
export { setCoreDebugSink, coreDebug, coreDebugError } from "./debug.js";
export { AgentRuntime, type AgentRuntimeOptions, type TurnResult, type RunTurnOptions } from "./agent/runtime.js";
export { TurnAbortedError } from "./agent/loop.js";
export { loadAgent, loadProjectContext, loadGlobalUserContext, loadWorkspaceKakoMd } from "./agent/loader.js";
export { createLLMRouter, resolveModel } from "./llm/router.js";
export { fetchWithTimeout } from "./net/fetch-with-timeout.js";
export {
  FileMemoryStore,
  createMessage,
  getTranscriptLength,
  sessionInputHistory,
  truncateSessionTranscript,
  clearSessionConversation,
  transcriptPreviewText,
} from "./memory/store.js";
export {
  summarizeTranscriptRange,
  selectedTurnEndIndex,
  type RewindSummarizeMode,
} from "./memory/rewind-summarize.js";
export {
  isCodeMutatingTool,
  summarizeCodeChanges,
  restoreCodeChangesFromTranscript,
  type RewindCodeChangeSummary,
  type RestoreCodeResult,
} from "./memory/rewind-code-restore.js";
export {
  projectToolResultsForContext,
  runCompactionCascade,
  consolidateToL1,
  preCompactFlush,
} from "./memory/compact.js";
export { loadPins, savePins, selectPinsForInject, formatPinsForPrompt } from "./memory/pins.js";
export {
  searchMemoryFts,
  rebuildMemoryFtsIndex,
  syncSessionToFts,
  memoryGet,
  closeMemoryFtsDb,
} from "./memory/index-fts.js";
export { runAutoRecall } from "./memory/auto-recall.js";
export { consolidateL1ToL2 } from "./memory/l2.js";
export { runMemoryCurator } from "./memory/curator.js";
export {
  detailPreviewFromL1,
  feedClassifierMilestoneToL1,
  resolveAgentsDetailPreview,
} from "./memory/detail-bridge.js";
export {
  listFacts,
  formatFactsExcerpt,
  loadUserProfile,
  extractFactsFromTranscript,
  applyFactDecisions,
} from "./memory/facts.js";
export {
  SessionManager,
  sessionManager,
  sessionHasUserDialogue,
  isDefaultSessionTitle,
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
export {
  SEARCH_PROVIDER_PRESETS,
  getSearchProviderPreset,
} from "./config/search-presets.js";
export {
  loadSearchRegistry,
  saveSearchRegistry,
  updateSearchRegistry,
  isSearchProviderReady,
  searchProviderReadyError,
} from "./config/search-store.js";
export {
  loadSecurityPolicy,
  saveSecurityPolicy,
  saveWorkspaceSecuritySettings,
  toSecuritySettingsFile,
  applySecuritySettingsPatch,
  type SecurityPolicy,
} from "./security/policy-store.js";
export {
  loadNetworkPolicy,
  saveNetworkPolicy,
  parseNetworkPolicy,
  addHostsToUserAllowlist,
  type NetworkPolicy,
} from "./config/network-store.js";
export { testSearchProvider } from "./web/web-search.js";
export { MCP_PRESETS } from "./config/mcp-presets.js";
export {
  loadMcpRegistry,
  saveMcpRegistry,
  upsertMcpServer,
  removeMcpServer,
} from "./mcp/config.js";
export { mcpManager, McpManager } from "./mcp/manager.js";
export { listAllCachedTools } from "./mcp/tool-cache.js";
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
export { isLowRiskBashCommand } from "./tools/bash-risk.js";
export {
  readClipboardImage,
  readClipboardText,
  writeClipboardText,
  storeClipboardImage,
  storeUserAttachment,
  resolveUserTurnInput,
  findLeadingAbsolutePath,
  parsePathReferences,
  parsePastedFilePaths,
  unescapePathCandidate,
  isImagePath,
  normalizeClipboardPath,
  peekSpreadsheet,
  formatPeekSpreadsheetBashCommand,
  peekPresentation,
  formatPeekPresentationBashCommand,
} from "./media/index.js";
export {
  ensurePlanFile,
  legacyPlanFilePathForSession,
  planFilePathForSession,
  readPlanFile,
  resolvePlanFileForSession,
} from "./tools/builtin/plan-mode-shared.js";
export { enterPlanModeSession } from "./tools/builtin/plan-mode-enter.js";
export {
  listBackgroundTasks,
  listAllBackgroundTasks,
  getBackgroundTask,
  stopBackgroundTask,
  registerBackgroundTask,
  resetBackgroundTaskStore,
  sessionsWithRunningBackgroundWork,
} from "./background/task-store.js";
export {
  createTask,
  listTasks,
  getTask,
  updateTask,
  resetTaskStore,
} from "./tasks/task-store.js";
export type { SessionTask, TaskStatus } from "./tasks/types.js";
export { reconcileStaleBackgroundWork, checkpointBackgroundWorkForProcessExit } from "./background/reconcile-stale-work.js";
export {
  INTERRUPTED_PROCESS_ERROR,
  loadInterruptedBackground,
  saveInterruptedBackground,
  upsertInterruptedItem,
  listResumableInterrupted,
  markInterruptedDiscarded,
  removeInterruptedItem,
  removeInterruptedForWorkflowRun,
} from "./background/interrupted-store.js";
export type {
  InterruptedBackgroundFile,
  InterruptedBackgroundItem,
  InterruptedWorkflowItem,
  InterruptedAgentItem,
} from "./background/interrupted-store.js";
export {
  listActiveAgentPayloads,
  upsertActiveAgentPayload,
  removeActiveAgentPayload,
} from "./background/agent-persist.js";
export type { ActiveAgentPayload } from "./background/agent-persist.js";
export {
  assertWorkflowResumable,
  agentInputFromInterrupted,
  recoverWorkflowArgsFromJournal,
  resolveInterruptedWorkflowArgs,
  resumeInterruptedWorkflow,
} from "./background/resume.js";
export type { BackgroundTask } from "./background/types.js";
export {
  discoverSkills,
  discoverSkillsForAgent,
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
  getInstalledSkillDetail,
  searchSkillHub,
  analyzeSkillHubRepo,
  analyzeGithubRepo,
  fetchPopularSkillHub,
  uninstallSkill,
  setSkillEnabled,
  openPathInFileManager,
} from "./skills/index.js";
export { loadSkill } from "./skills/loader.js";
export {
  SYSTEM_SKILL_REGISTRY,
  skillNamesForToolAllowlist,
  isDefaultSkillWithHandler,
  isSlashOnlySystemSkill,
  isSlashInvokableSkill,
  isSystemSkill,
  listSlashInvokableSkills,
  loadSlashOnlyCatalogSkills,
  loadSystemSkills,
  type SystemSkillEntry,
  type SystemSkillHandler,
  getSystemSkillHandler,
} from "./skills/system-skills.js";
export {
  buildInitSlashContentBlocks,
  INIT_SLASH_CORE_PROMPT,
  resolveSkillSlashLlmText,
  parseBareInitCommand,
  resolveSkillSlashUserContent,
} from "./skills/slash-command-message.js";
export {
  loadWorkflowRuns,
  saveWorkflowRun,
  updateWorkflowRun,
  countRunningWorkflows,
  listRunningWorkflows,
  primaryRunningWorkflow,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
} from "./workflows/store.js";
export {
  formatWorkflowRunsStatus,
  formatSessionWorkflowsStatus,
} from "./workflows/status-summary.js";
export {
  shouldRenderWorkflowFooter,
  markOrphanWorkflowInterrupted,
  liveWorkflowTaskActive,
} from "./workflows/workflow-live.js";
export {
  aggregateWorkflowJournal,
  isPhaseFatal,
  isPhaseSuccessful,
  readJournalEntries,
  resolveCurrentPhaseFromJournal,
  summarizeAgentOutput,
  type PhaseView,
  type AgentView,
  type JournalEntry,
  type WorkflowPhaseDef,
} from "./workflows/journal.js";
export { launchWorkflow, formatWorkflowToolResult, normalizeWorkflowArgs } from "./workflows/runner.js";
export { prepareWorkflowConfirm } from "./workflows/confirm-prep.js";
export {
  buildTaskNotificationMessage,
  workflowCompletedSummary,
  type WorkflowTaskNotification,
} from "./workflows/task-notification.js";
export {
  isTerminalWorkflowStatus,
  listUnpresentedTerminalWorkflowRuns,
  listTerminalRunsNeedingPresentedHeal,
  transcriptContainsWorkflowNotification,
} from "./workflows/present.js";
export {
  registerWorkflowCompleteHandler,
  unregisterWorkflowCompleteHandler,
} from "./workflows/completion-registry.js";
export {
  loadWorkflowTemplate,
  loadWorkflowMetaFromScriptPath,
  type WorkflowMeta,
} from "./workflows/registry.js";
export {
  stopWorkflowByTaskId,
  stopWorkflowByRunId,
} from "./workflows/control.js";
export { saveWorkflowArtifact } from "./workflows/save.js";
export {
  beginTurnBudget,
  clearTurnBudget,
  createBudgetView,
  getTurnBudget,
  parseTurnTokenTarget,
  TurnBudgetExhaustedError,
  TurnBudgetPool,
} from "./workflows/budget.js";
export { resolveNestedWorkflowScript } from "./workflows/nested.js";
export {
  agentCompletedSummary,
  agentFinishedTimelineLine,
  buildAgentTaskNotificationMessage,
  buildAgentWakeUserMessage,
  buildAgentResultUserMessage,
  formatBackgroundAgentLaunchResult,
  isProtocolWakeText,
  type AgentTaskRecord,
  type AgentTaskStatus,
  type AgentTaskUsage,
} from "./background/agent-notification.js";
export {
  registerAgentCompleteHandler,
  unregisterAgentCompleteHandler,
} from "./background/agent-completion-registry.js";

export {
  resolveKakoInstallRoot,
  resolveWebDist,
  resolveServerEntry,
  defaultSettingsUrl,
} from "./config/install-paths.js";
export const KAKO_CORE_VERSION = "0.2.2";
export const KAKO_LICENSE = "MIT";
export const KAKO_LICENSE_URL =
  "https://github.com/hegeng1212/Kako-Code/blob/main/LICENSE";

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
    | "beforeInteractive"
    | "afterInteractive"
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
export {
  loadMemorySettings,
  saveMemorySettings,
  resolveInjectCaps,
  parseMemorySettings,
  isAutoRecallEnabled,
  isCuratedEnabled,
  isMemoryToolEnabled,
  isBackgroundReviewEnabled,
  isWriteApprovalEnabled,
  type MemorySettings,
} from "./config/memory-store.js";
export {
  getFrozenCuratedSnapshot,
  clearFrozenCuratedSnapshot,
} from "./memory/curated-freeze.js";
export {
  loadCuratedEntries,
  addCuratedEntry,
  formatCuratedSnapshot,
} from "./memory/curated-store.js";
export {
  stageMemoryWrite,
  listPendingMemoryWrites,
  approvePendingMemoryWrite,
  rejectPendingMemoryWrite,
} from "./memory/pending.js";
export {
  runBackgroundReview,
  scheduleBackgroundReview,
} from "./memory/background-review.js";
export { runMemoryJob } from "./memory/jobs/index.js";
export { resolveModelContextWindow } from "./memory/context-window.js";
export {
  updateTokenEstimateRatio,
  applyEstimateRatio,
} from "./memory/tokens.js";
export { parseMemoryFlushPayload, FLUSH_SYSTEM_PROMPT } from "./memory/flush-schema.js";
export { loadConfig, type KakoConfig } from "./config/loader.js";
