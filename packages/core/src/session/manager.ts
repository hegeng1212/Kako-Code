import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  ProjectIndexFile,
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
import { projectIdFromCwd, projectNameFromCwd } from "./project-id.js";

const DEFAULT_TITLE = "New chat";

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

async function readSessionMeta(sessionId: SessionId): Promise<SessionMeta | null> {
  try {
    const text = await readFile(getSessionMetaPath(sessionId), "utf-8");
    return JSON.parse(text) as SessionMeta;
  } catch {
    return null;
  }
}

async function writeSessionMeta(meta: SessionMeta): Promise<void> {
  await mkdir(getSessionMemoryDir(meta.id), { recursive: true });
  await writeFile(getSessionMetaPath(meta.id), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
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

  async updateSession(
    id: SessionId,
    patch: Partial<
      Pick<SessionMeta, "title" | "status" | "jobLabel" | "agentState" | "planFilePath">
    >,
  ): Promise<Session> {
    const meta = await readSessionMeta(id);
    if (!meta) {
      throw new Error(`Session not found: ${id}`);
    }

    if (patch.title !== undefined) meta.title = patch.title;
    if (patch.status !== undefined) meta.status = patch.status;
    if (patch.jobLabel !== undefined) meta.jobLabel = patch.jobLabel;
    if (patch.agentState !== undefined) meta.agentState = patch.agentState;
    if (patch.planFilePath !== undefined) meta.planFilePath = patch.planFilePath;
    meta.updatedAt = new Date().toISOString();
    await writeSessionMeta(meta);
    return metaToSession(meta);
  }

  async endSession(id: SessionId): Promise<void> {
    const meta = await readSessionMeta(id);
    if (!meta) return;

    const memory = new FileMemoryStore(id);
    await memory.consolidate(id);

    meta.status = "ended";
    meta.updatedAt = new Date().toISOString();
    await writeSessionMeta(meta);
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
