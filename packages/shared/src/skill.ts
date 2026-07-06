import type { SkillId } from "./agent.js";

/** Skill metadata from SKILL.md frontmatter (discovery phase). */
export interface SkillMetadata {
  name: SkillId;
  description: string;
  /** Absolute path to the skill directory. */
  path: string;
  /** Absolute path to SKILL.md — use Read to activate. */
  skillMdPath: string;
}

/** Full skill content after activation. */
export interface SkillDefinition extends SkillMetadata {
  /** Markdown body of SKILL.md (instructions). */
  instructions: string;
  /** Relative paths to scripts/, references/, assets/. */
  scripts?: string[];
  references?: string[];
  assets?: string[];
}

/** Record of a skill activation during a session. */
export interface SkillActivation {
  skillName: SkillId;
  reason: string;
  activatedAt: string;
  sessionId: string;
  agentId: string;
  durationMs?: number;
  steps?: string[];
}

/** Source locations where skills are discovered. */
export type SkillSource =
  | "global"
  | "project"
  | "builtin"
  | "skillhub"
  | "github"
  | "archive"
  | "local";

export interface InstalledSkillRecord {
  name: string;
  /** SkillHub slug, e.g. acme/data-analysis */
  slug?: string;
  description: string;
  source: SkillSource;
  version?: string;
  versionId?: string;
  commitSha?: string;
  installDir: string;
  skillMdPath: string;
  installedAt: string;
  /** When false, skill is hidden from the agent index. Default true. */
  enabled?: boolean;
  /** SkillHub global install count (when source is skillhub). */
  totalInstalls?: number;
}

export interface SkillsManifest {
  skills: InstalledSkillRecord[];
}

export interface SkillHubSearchHit {
  slug: string;
  name: string;
  description: string;
  totalInstalls?: number;
  sourceIdentifier?: string;
  ownerUsername?: string;
  /** Full slug for install, e.g. anthropics/docx */
  installSlug?: string;
}

export interface SkillHubAnalyzeRepoResult {
  repoFullName: string;
  defaultBranch: string;
  skills: Array<{
    path: string;
    slug: string;
    name: string;
    description: string;
    alreadyImported?: boolean;
  }>;
}

export interface SkillHubImportResult {
  imported: Array<{ slug?: string; displaySlug?: string; name?: string }>;
  updated: Array<{ slug?: string; displaySlug?: string; name?: string }>;
  reused: Array<{ slug?: string; displaySlug?: string; name?: string }>;
  failed: Array<{ path?: string; error?: string }>;
}

export interface SkillBuildResult {
  skillMd: string;
}

export interface SkillBuildChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: SkillBuildChatAttachment[];
}

export interface SkillBuildChatAttachment {
  name: string;
  mimeType: string;
  /** Base64-encoded file bytes (no data: URL prefix). */
  data: string;
}

export interface SkillBuildQuestionOption {
  id: string;
  label: string;
}

export interface SkillBuildQuestion {
  id: string;
  text: string;
  kind: "tool_confirm" | "tool_missing" | "agent_tool" | "param_mismatch" | "general";
  options?: SkillBuildQuestionOption[];
  relatedTool?: string;
}

export interface SkillBuildTurnResult {
  assistantMessage: string;
  skillMd?: string;
  questions: SkillBuildQuestion[];
  validation?: SkillValidationResult;
  /** True when skill draft exists and validation passes. */
  readyToSave: boolean;
  /** True when MCP tool param sections were auto-corrected from schemas. */
  autoFixedParams?: boolean;
}

export interface SkillBuildChatRequest {
  /** Client session id — one build flow; server only uses messages from this request. */
  sessionId?: string;
  messages: SkillBuildChatMessage[];
  draftSkillMd?: string;
}

export interface SkillSaveRequest {
  skillMd: string;
  /** Save even when tool dependencies are missing. */
  force?: boolean;
}

export interface SkillToolRef {
  raw: string;
  normalized: string;
}

export interface SkillToolParamIssue {
  tool: string;
  param: string;
  kind: "unknown_param" | "missing_required";
  message: string;
}

export interface SkillValidationResult {
  ok: boolean;
  toolRefs: SkillToolRef[];
  missingTools: SkillToolRef[];
  /** MCP tools referenced in the skill and available in the current environment. */
  resolvedMcpTools: SkillToolRef[];
  paramIssues: SkillToolParamIssue[];
  /** Tools referenced but not enabled on the main agent. */
  unavailableAgentTools: SkillToolRef[];
  warnings: string[];
}
