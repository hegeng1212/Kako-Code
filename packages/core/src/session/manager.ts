import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  ProjectIndexFile,
  ProjectWorkspaceSecurity,
  Session,
  SessionId,
  SessionMeta,
  SessionStartOptions,
  SessionStatus,
} from "@kako/shared";
import {
  getMemoryDir,
  getProjectsIndexPath,
  getSessionMemoryDir,
  getSessionMetaPath,
} from "../config/paths.js";
import { FileMemoryStore } from "../memory/store.js";
import { isProtocolWakeText } from "../background/agent-notification.js";
import { projectIdFromCwd, projectNameFromCwd } from "./project-id.js";
import {
  readSessionMeta,
  withSessionMetaLock,
  writeSessionMeta,
  writeSessionMetaAtomic,
} from "./session-meta-io.js";
import { coreDebugError } from "../debug.js";

const DEFAULT_TITLE = "new session";
const DEFAULT_TITLES = new Set(["new session", "new chat"]);

export function isDefaultSessionTitle(title: string | undefined): boolean {
  const t = (title ?? "").trim().toLowerCase();
  return !t || DEFAULT_TITLES.has(t);
}

function metaToSession(meta: SessionMeta): Session {
  return {
    id: meta.id,
    agentName: meta.agentName,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    cwd: meta.cwd,
    metadata: { title: meta.title, projectId: meta.projectId },
  };
}

/** True when transcript has no real user/assistant dialogue. */
export async function sessionHasUserDialogue(sessionId: SessionId): Promise<boolean> {
  const memory = new FileMemoryStore(sessionId);
  const transcript = await memory.loadTranscript();
  for (const msg of transcript) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (msg.metadata?.harnessInjected === true) continue;
    const content = (msg.content ?? "").trim();
    if (content) {
      if (isProtocolWakeText(content)) continue;
      return true;
    }
    if (msg.attachments && msg.attachments.length > 0) return true;
    const llmText = msg.metadata?.llmText;
    if (typeof llmText === "string" && llmText.trim()) {
      if (isProtocolWakeText(llmText)) continue;
      return true;
    }
  }
  return false;
}

async function readProjectIndex(): Promise<ProjectIndexFile> {
  try {
    const text = await readFile(getProjectsIndexPath(), "utf-8");
    return JSON.parse(text) as ProjectIndexFile;
  } catch {
    return { version: 1, projects: [] };
  }
}

async function writeProjectIndex(index: ProjectIndexFile): Promise<void> {
  await mkdir(dirname(getProjectsIndexPath()), { recursive: true });
  await writeFile(getProjectsIndexPath(), `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

export class SessionManager {
  isProjectTrusted(project: Project): boolean {
    return Boolean(project.trustedAt);
  }

  async ensureProjectsTrustMigrated(): Promise<void> {
    const index = await readProjectIndex();
    if (index.workspaceTrustMigrated) return;
    for (const p of index.projects) {
      if (!p.lastSessionId) {
        // Untrusted stubs (including "No, exit" leftovers wrongly backfilled earlier).
        delete p.trustedAt;
        continue;
      }
      if (!p.trustedAt) {
        p.trustedAt = p.updatedAt ?? p.createdAt;
      }
    }
    index.workspaceTrustMigrated = true;
    await writeProjectIndex(index);
  }

  async findProject(cwd: string): Promise<Project | null> {
    const normalized = resolve(cwd);
    const id = projectIdFromCwd(normalized);
    const index = await readProjectIndex();
    return index.projects.find((p) => p.id === id) ?? null;
  }

  /** Create or return the project row for cwd; new projects leave trustedAt unset. */
  async getOrCreateProject(cwd: string): Promise<Project> {
    return this.resolveProject(cwd);
  }

  async markProjectTrusted(cwd: string, at = new Date()): Promise<Project> {
    const normalized = resolve(cwd);
    const id = projectIdFromCwd(normalized);
    const index = await readProjectIndex();
    const now = at.toISOString();
    let project = index.projects.find((p) => p.id === id);
    if (!project) {
      project = {
        id,
        cwd: normalized,
        name: projectNameFromCwd(normalized),
        createdAt: now,
        updatedAt: now,
        trustedAt: now,
      };
      index.projects.push(project);
    } else {
      project.trustedAt = now;
      project.updatedAt = now;
    }
    await writeProjectIndex(index);
    return project;
  }

  async resolveProject(cwd: string): Promise<Project> {
    const normalized = resolve(cwd);
    const id = projectIdFromCwd(normalized);
    const now = new Date().toISOString();
    const index = await readProjectIndex();
    const existing = index.projects.find((p) => p.id === id);

    if (existing) {
      existing.updatedAt = now;
      await writeProjectIndex(index);
      return existing;
    }

    const project: Project = {
      id,
      cwd: normalized,
      name: projectNameFromCwd(normalized),
      createdAt: now,
      updatedAt: now,
    };
    index.projects.push(project);
    await writeProjectIndex(index);
    return project;
  }

  async getProjectSecurity(cwd: string): Promise<ProjectWorkspaceSecurity | null> {
    const project = await this.findProject(cwd);
    return project?.security ?? null;
  }

  /** Create or update the per-cwd workspace security overlay. */
  async setProjectSecurity(
    cwd: string,
    security: ProjectWorkspaceSecurity,
  ): Promise<Project> {
    const normalized = resolve(cwd);
    const id = projectIdFromCwd(normalized);
    const now = new Date().toISOString();
    const index = await readProjectIndex();
    let project = index.projects.find((p) => p.id === id);
    if (!project) {
      project = {
        id,
        cwd: normalized,
        name: projectNameFromCwd(normalized),
        createdAt: now,
        updatedAt: now,
        security,
      };
      index.projects.push(project);
    } else {
      project.security = security;
      project.updatedAt = now;
    }
    await writeProjectIndex(index);
    return project;
  }

  /**
   * If the project exists without security, persist `seed` and return it.
   * If no project row exists, return `seed` without creating a project.
   */
  async ensureProjectSecurity(
    cwd: string,
    seed: ProjectWorkspaceSecurity,
  ): Promise<ProjectWorkspaceSecurity> {
    const project = await this.findProject(cwd);
    if (!project) return seed;
    if (project.security) return project.security;
    await this.setProjectSecurity(cwd, seed);
    return seed;
  }

  /** True when this cwd previously chose "don't ask again" for the workflow name. */
  async isWorkflowAllowedForCwd(cwd: string, workflowName: string): Promise<boolean> {
    const name = workflowName.trim();
    if (!name) return false;
    const project = await this.findProject(cwd);
    return Boolean(project?.allowedWorkflows?.includes(name));
  }

  /** Persist "don't ask again" for a workflow name under this cwd's project. */
  async allowWorkflowForCwd(cwd: string, workflowName: string): Promise<void> {
    const name = workflowName.trim();
    if (!name) return;
    const project = await this.resolveProject(cwd);
    const existing = project.allowedWorkflows ?? [];
    if (existing.includes(name)) return;
    const index = await readProjectIndex();
    const row = index.projects.find((p) => p.id === project.id);
    if (!row) return;
    row.allowedWorkflows = [...existing, name];
    row.updatedAt = new Date().toISOString();
    await writeProjectIndex(index);
  }

  async createSession(options: SessionStartOptions): Promise<Session> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const project = await this.resolveProject(cwd);
    const now = new Date().toISOString();
    const sessionId: SessionId = `sess-${randomUUID().slice(0, 8)}`;
    const meta: SessionMeta = {
      id: sessionId,
      projectId: project.id,
      cwd,
      agentName: options.agentName ?? "main",
      title: options.title ?? DEFAULT_TITLE,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    await writeSessionMeta(meta);

    const index = await readProjectIndex();
    const proj = index.projects.find((p) => p.id === project.id);
    if (proj) {
      proj.lastSessionId = sessionId;
      proj.updatedAt = now;
      await writeProjectIndex(index);
    }

    return metaToSession(meta);
  }

  /**
   * CLI entry: reuse an empty idle session in this cwd (same agent) instead of
   * creating another "new session". Extra empty duplicates are deleted.
   * Agents compose still call createSession().
   *
   * Empty dialogue counts as idle even when title/jobLabel were left stale after
   * /clear or an aborted first turn — those identity fields are reset on reuse.
   */
  async createOrReuseIdleSession(options: {
    cwd: string;
    agentName?: string;
  }): Promise<Session> {
    const cwd = resolve(options.cwd);
    const agentName = options.agentName ?? "main";
    const sessions = await this.listSessions({ cwd, limit: 200 });
    const idleIds: SessionId[] = [];

    for (const session of sessions) {
      if (session.agentName !== agentName) continue;
      const meta = await readSessionMeta(session.id);
      if (!meta || meta.parentSessionId) continue;
      if (await sessionHasUserDialogue(session.id)) continue;
      idleIds.push(session.id);
    }

    if (idleIds.length === 0) {
      return this.createSession({ cwd, agentName });
    }

    // Newest first from listSessions sort — keep first, prune the rest.
    const keepId = idleIds[0]!;
    for (const id of idleIds.slice(1)) {
      await this.deleteSession(id);
    }

    const now = new Date().toISOString();
    const kept = await this.updateSession(keepId, {
      status: "active",
      title: DEFAULT_TITLE,
      jobLabel: "",
      jobName: "",
    });
    const index = await readProjectIndex();
    const project = await this.resolveProject(cwd);
    const proj = index.projects.find((p) => p.id === project.id);
    if (proj) {
      proj.lastSessionId = keepId;
      proj.updatedAt = now;
      await writeProjectIndex(index);
    }
    return kept;
  }

  /** Drop AI/list identity so an empty session shows as "new session". */
  async clearSessionListIdentity(id: SessionId): Promise<Session> {
    return this.updateSession(id, {
      title: DEFAULT_TITLE,
      jobLabel: "",
      jobName: "",
    });
  }

  /**
   * Chat entry after process start: always land on an empty idle session in this
   * cwd (reuse if present, else create). Never auto-resume dialogue / working /
   * blocked sessions — those stay available via Agents / `/resume` / switch.
   */
  async openChatEntrySession(options: {
    cwd: string;
    agentName?: string;
  }): Promise<Session> {
    return this.createOrReuseIdleSession(options);
  }

  async createChildSession(input: {
    parentSessionId: SessionId;
    agentName: string;
    cwd: string;
  }): Promise<Session> {
    const parent = await readSessionMeta(input.parentSessionId);
    if (!parent) {
      throw new Error(`Parent session not found: ${input.parentSessionId}`);
    }
    const cwd = resolve(input.cwd);
    const project = await this.resolveProject(cwd);
    const now = new Date().toISOString();
    const sessionId: SessionId = `sess-${randomUUID().slice(0, 8)}`;
    const meta: SessionMeta = {
      id: sessionId,
      projectId: project.id,
      cwd,
      agentName: input.agentName,
      title: `${input.agentName} subagent`,
      status: "active",
      createdAt: now,
      updatedAt: now,
      parentSessionId: input.parentSessionId,
    };
    await writeSessionMeta(meta);
    return metaToSession(meta);
  }

  async getSession(id: SessionId): Promise<Session | null> {
    const meta = await readSessionMeta(id);
    return meta ? metaToSession(meta) : null;
  }

  async getSessionMeta(id: SessionId): Promise<SessionMeta | null> {
    return readSessionMeta(id);
  }

  async listSessions(options?: {
    cwd?: string;
    status?: SessionStatus;
    limit?: number;
  }): Promise<Session[]> {
    const sessionsDir = join(getMemoryDir(), "sessions");
    let entries: string[];
    try {
      entries = await readdir(sessionsDir);
    } catch {
      return [];
    }

    const normalizedCwd = options?.cwd ? resolve(options.cwd) : undefined;
    const sessions: Session[] = [];

    for (const entry of entries) {
      const meta = await readSessionMeta(entry);
      if (!meta) continue;
      if (normalizedCwd && resolve(meta.cwd) !== normalizedCwd) continue;
      if (options?.status && meta.status !== options.status) continue;
      sessions.push(metaToSession(meta));
    }

    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions.slice(0, options?.limit ?? 50);
  }

  /** All session metas across working directories, newest first. */
  async listSessionMetas(options?: { limit?: number }): Promise<SessionMeta[]> {
    const sessionsDir = join(getMemoryDir(), "sessions");
    let entries: string[];
    try {
      entries = await readdir(sessionsDir);
    } catch {
      return [];
    }

    const metas: SessionMeta[] = [];
    let skipped = 0;
    for (const entry of entries) {
      const meta = await readSessionMeta(entry);
      if (!meta) {
        if (entry.startsWith("sess-")) skipped++;
        continue;
      }
      metas.push(meta);
    }

    if (skipped > 0) {
      coreDebugError("session:list-metas-skipped", {
        skipped,
        listed: metas.length,
      });
    }

    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return metas.slice(0, options?.limit ?? 100);
  }

  async updateSession(
    id: SessionId,
    patch: Partial<
      Pick<
        SessionMeta,
        "title" | "status" | "jobLabel" | "jobName" | "agentState" | "planFilePath" | "memoryCompact"
      >
    >,
  ): Promise<Session> {
    return withSessionMetaLock(id, async () => {
      const meta = await readSessionMeta(id);
      if (!meta) {
        coreDebugError("session:update-missing", { sessionId: id, patchKeys: Object.keys(patch) });
        throw new Error(`Session not found: ${id}`);
      }

      if (patch.title !== undefined) meta.title = patch.title;
      if (patch.status !== undefined) meta.status = patch.status;
      if (patch.jobLabel !== undefined) meta.jobLabel = patch.jobLabel;
      if (patch.jobName !== undefined) meta.jobName = patch.jobName;
      if (patch.agentState !== undefined) meta.agentState = patch.agentState;
      if (patch.planFilePath !== undefined) meta.planFilePath = patch.planFilePath;
      if (patch.memoryCompact !== undefined) meta.memoryCompact = patch.memoryCompact;
      meta.updatedAt = new Date().toISOString();
      await writeSessionMetaAtomic(id, meta);
      return metaToSession(meta);
    });
  }

  async endSession(id: SessionId): Promise<void> {
    const meta = await readSessionMeta(id);
    if (!meta) return;

    const memory = new FileMemoryStore(id);
    await memory.consolidate(id);
    void import("../memory/index-fts.js")
      .then(({ syncSessionToFts }) => syncSessionToFts(id))
      .catch(() => {});

    meta.status = "ended";
    meta.updatedAt = new Date().toISOString();
    await writeSessionMeta(meta);
  }

  /**
   * Permanently remove a session from disk (Agents Ctrl+X delete).
   * Unlike endSession, the session no longer appears in any list.
   */
  async deleteSession(id: SessionId): Promise<void> {
    const meta = await readSessionMeta(id);
    const sessionDir = getSessionMemoryDir(id);
    await rm(sessionDir, { recursive: true, force: true });

    if (!meta) return;
    const index = await readProjectIndex();
    let changed = false;
    for (const project of index.projects) {
      if (project.lastSessionId === id) {
        project.lastSessionId = undefined;
        project.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await writeProjectIndex(index);
  }

  async loadSessionSummary(id: SessionId): Promise<string | undefined> {
    try {
      return await readFile(join(getSessionMemoryDir(id), "summary.md"), "utf-8");
    } catch {
      return undefined;
    }
  }
}

export const sessionManager = new SessionManager();
