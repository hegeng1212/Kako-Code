import type { AgentId, SessionId } from "./agent.js";
import type { SessionCapability } from "./security.js";
import type { TranscriptMessage } from "./memory.js";

/** Session lifecycle states. */
export type SessionStatus = "active" | "paused" | "ended";

/** A conversation session managed by the Session Manager. */
export interface Session {
  id: SessionId;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  metadata?: Record<string, unknown>;
}

/** Project-level context file (KAKO.md / .kako/project.md). */
export interface ProjectContext {
  path: string;
  content: string;
}

/** Options when starting a new session. */
export interface SessionStartOptions {
  agentName?: string;
  cwd?: string;
  projectContext?: ProjectContext;
  resumeSessionId?: SessionId;
  title?: string;
}

/** Registered project (working directory). */
export interface Project {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSessionId?: SessionId;
  /** ISO time when the user confirmed trust for this workspace; absent = not trusted. */
  trustedAt?: string;
}

export interface ProjectIndexFile {
  version: number;
  projects: Project[];
  /**
   * Once true, legacy trustedAt backfill has run.
   * Untrusted projects must not be auto-trusted on later startups.
   */
  workspaceTrustMigrated?: boolean;
}

export type AgentSessionState = "done" | "working" | "blocked" | "failed";

export interface SessionAgentState {
  state: AgentSessionState;
  detail: string;
  tempo: "active" | "idle" | "blocked";
  needs?: string;
  result?: string;
  since: string;
}

/** Persisted session metadata alongside transcript. */
export interface SessionMeta {
  id: SessionId;
  projectId: string;
  cwd: string;
  agentName: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  /** Session capability level for security policy. */
  capability?: SessionCapability;
  /** Parent session when this is a sub-agent child session. */
  parentSessionId?: SessionId;
  /** Compact lowercase label for background jobs (2–4 words). */
  jobLabel?: string;
  /** Harness session-state classifier output. */
  agentState?: SessionAgentState;
  /** Plan markdown file path when this session has entered plan mode. */
  planFilePath?: string;
}

export type SystemSkillHandler = "skill" | "dynamic-workflow";

export type SlashResult =
  | { type: "handled" }
  | { type: "exit" }
  | { type: "switch"; session: Session }
  | { type: "message"; text: string }
  | { type: "skill-slash"; name: string; args: string; handler: SystemSkillHandler; displayText: string }
  | { type: "workflows-panel" }
  | { type: "plan-enter"; question?: string; displayText: string }
  | { type: "plan-view"; displayText: string }
  | { type: "plan-open"; displayText: string }
  | { type: "error"; message: string };

export interface SlashCommandContext {
  cwd: string;
  session: Session;
  listSessions: () => Promise<Session[]>;
  createSession: (agentName?: string) => Promise<Session>;
  endSession: (id: SessionId) => Promise<void>;
  resumeSession: (id: SessionId) => Promise<Session>;
  updateTitle: (id: SessionId, title: string) => Promise<Session>;
}

/** Event emitted on each turn in a session. */
export interface SessionTurn {
  sessionId: SessionId;
  agentId: AgentId;
  userMessage: TranscriptMessage;
  assistantMessage?: TranscriptMessage;
  toolResults?: string[];
}
