import type { AgentId, SessionId } from "./agent.js";
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
}

export interface ProjectIndexFile {
  version: number;
  projects: Project[];
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
}

export type SystemSkillHandler = "skill" | "dynamic-workflow";

export type SlashResult =
  | { type: "handled" }
  | { type: "exit" }
  | { type: "switch"; session: Session }
  | { type: "message"; text: string }
  | { type: "skill-slash"; name: string; args: string; handler: SystemSkillHandler; displayText: string }
  | { type: "workflows-panel" }
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
