import type { ToolDefinition, ToolSecurityMetadata } from "@kako/shared";

export const BUILTIN_SECURITY_METADATA: Record<string, ToolSecurityMetadata> = {
  Read: { readonly: true, capability: ["read"], defaultRiskLevel: "low" },
  Grep: { readonly: true, capability: ["read"], defaultRiskLevel: "low" },
  Glob: { readonly: true, capability: ["read"], defaultRiskLevel: "low" },
  Write: { sideEffect: true, capability: ["write"], defaultRiskLevel: "medium" },
  Edit: { sideEffect: true, capability: ["write"], defaultRiskLevel: "medium" },
  NotebookEdit: { sideEffect: true, capability: ["write"], defaultRiskLevel: "medium" },
  Bash: { sideEffect: true, capability: ["exec"], defaultRiskLevel: "high" },
  Monitor: { sideEffect: true, capability: ["exec"], defaultRiskLevel: "high" },
  WebFetch: { requiresNetwork: true, capability: ["network"], defaultRiskLevel: "medium" },
  WebSearch: { requiresNetwork: true, capability: ["network"], defaultRiskLevel: "medium" },
  Skill: { readonly: true, capability: ["read"], defaultRiskLevel: "none" },
  Workflow: { sideEffect: true, capability: ["exec"], defaultRiskLevel: "high" },
  EnterPlanMode: { sideEffect: true, defaultRiskLevel: "medium" },
  ExitPlanMode: { sideEffect: true, defaultRiskLevel: "medium" },
  /** Git worktree switch — no pre-approval; user steers via explicit worktree requests. */
  EnterWorktree: { defaultRiskLevel: "none" },
  ExitWorktree: { defaultRiskLevel: "none" },
  CronCreate: { sideEffect: true, modifiesExternal: true, defaultRiskLevel: "medium" },
  CronDelete: { sideEffect: true, modifiesExternal: true, defaultRiskLevel: "medium" },
  CronList: { readonly: true, defaultRiskLevel: "none" },
  /** Session task list CRUD — in-session orchestration, not pre-approval gated. */
  TaskCreate: { defaultRiskLevel: "none" },
  TaskGet: { readonly: true, defaultRiskLevel: "none" },
  TaskList: { readonly: true, defaultRiskLevel: "none" },
  TaskUpdate: { defaultRiskLevel: "none" },
  /** Background task stop — user already delegated via Agent/Workflow/Monitor. */
  TaskStop: { defaultRiskLevel: "none" },
  TaskOutput: { readonly: true, defaultRiskLevel: "none" },
  PushNotification: { modifiesExternal: true, defaultRiskLevel: "low" },
  DesignSync: { sideEffect: true, requiresNetwork: true, modifiesExternal: true, defaultRiskLevel: "high" },
  /** Interactive prompt — user interaction is the tool itself, not a pre-approval gate. */
  AskUserQuestion: { readonly: true, defaultRiskLevel: "none" },
  /** Spawns subagents; tool policy applies inside the child run, not at spawn. */
  Agent: { defaultRiskLevel: "none" },
};

export function applySecurityMetadata(definition: ToolDefinition): ToolDefinition {
  const meta = BUILTIN_SECURITY_METADATA[definition.name];
  if (!meta) return definition;
  return {
    ...definition,
    security: { ...meta, ...definition.security },
  };
}

export function mcpSecurityMetadata(transport: "stdio" | "sse" | "http"): ToolSecurityMetadata {
  return {
    sideEffect: true,
    requiresNetwork: transport !== "stdio",
    modifiesExternal: true,
    defaultRiskLevel: "medium",
    capability: ["mcp"],
  };
}
