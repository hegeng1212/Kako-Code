import { randomUUID } from "node:crypto";
import type { SessionTask, TaskCreateInput, TaskDeleteResult, TaskUpdateInput } from "./types.js";

const sessionTasks = new Map<string, Map<string, SessionTask>>();

function sessionMap(sessionId: string): Map<string, SessionTask> {
  let map = sessionTasks.get(sessionId);
  if (!map) {
    map = new Map();
    sessionTasks.set(sessionId, map);
  }
  return map;
}

export function parseTaskMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Task metadata must be an object");
  }
  return raw as Record<string, unknown>;
}

export function parseTaskCreateInput(raw: Record<string, unknown>): TaskCreateInput {
  const subject = String(raw.subject ?? "").trim();
  if (!subject) {
    throw new Error("TaskCreate requires subject");
  }
  const description = String(raw.description ?? "").trim();
  if (!description) {
    throw new Error("TaskCreate requires description");
  }
  const activeForm =
    raw.activeForm !== undefined ? String(raw.activeForm).trim() || undefined : undefined;
  const metadata = parseTaskMetadata(raw.metadata);
  return { subject, description, activeForm, metadata };
}

export function createTask(sessionId: string, input: TaskCreateInput): SessionTask {
  const task: SessionTask = {
    id: `task-${randomUUID().slice(0, 8)}`,
    sessionId,
    subject: input.subject,
    description: input.description,
    status: "pending",
    ...(input.activeForm ? { activeForm: input.activeForm } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: new Date().toISOString(),
  };
  sessionMap(sessionId).set(task.id, task);
  return task;
}

export function listTasks(sessionId: string): SessionTask[] {
  return [...sessionMap(sessionId).values()];
}

/** Unresolved dependency IDs still blocking this task. */
export function openBlockedByIds(sessionId: string, task: SessionTask): string[] {
  return (task.blockedBy ?? []).filter((id) => {
    const blocker = getTask(sessionId, id);
    return blocker !== undefined && blocker.status !== "completed" && blocker.status !== "cancelled";
  });
}

export function listTasksSortedById(sessionId: string): SessionTask[] {
  return listTasks(sessionId).sort((a, b) => a.id.localeCompare(b.id));
}

export function getTask(sessionId: string, taskId: string): SessionTask | undefined {
  return sessionMap(sessionId).get(taskId);
}

export function parseTaskGetInput(raw: Record<string, unknown>): string {
  const taskId = String(raw.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("TaskGet requires taskId");
  }
  return taskId;
}

export function requireTask(sessionId: string, taskId: string): SessionTask {
  const task = getTask(sessionId, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

function appendUniqueIds(existing: string[] | undefined, ids: string[]): string[] {
  const next = [...(existing ?? [])];
  for (const id of ids) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

function linkBlockedBy(sessionId: string, task: SessionTask, blockerIds: string[]): void {
  task.blockedBy = appendUniqueIds(task.blockedBy, blockerIds);
  for (const blockerId of blockerIds) {
    const blocker = getTask(sessionId, blockerId);
    if (blocker) {
      blocker.blocks = appendUniqueIds(blocker.blocks, [task.id]);
    }
  }
}

function linkBlocks(sessionId: string, task: SessionTask, blockedIds: string[]): void {
  task.blocks = appendUniqueIds(task.blocks, blockedIds);
  for (const blockedId of blockedIds) {
    const blocked = getTask(sessionId, blockedId);
    if (blocked) {
      blocked.blockedBy = appendUniqueIds(blocked.blockedBy, [task.id]);
    }
  }
}

function mergeTaskMetadata(
  task: SessionTask,
  patch: Record<string, unknown>,
): void {
  const current = { ...(task.metadata ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete current[key];
    } else {
      current[key] = value;
    }
  }
  task.metadata = Object.keys(current).length ? current : undefined;
}

export function parseTaskUpdateInput(raw: Record<string, unknown>): TaskUpdateInput {
  const taskId = String(raw.taskId ?? "").trim();
  if (!taskId) {
    throw new Error("TaskUpdate requires taskId");
  }

  const input: TaskUpdateInput = { taskId };

  if (raw.status !== undefined) {
    const status = String(raw.status).trim();
    if (!["pending", "in_progress", "completed", "deleted"].includes(status)) {
      throw new Error(`Invalid task status: ${status}`);
    }
    input.status = status as TaskUpdateInput["status"];
  }
  if (raw.subject !== undefined) {
    const subject = String(raw.subject).trim();
    if (!subject) throw new Error("TaskUpdate subject cannot be empty");
    input.subject = subject;
  }
  if (raw.description !== undefined) {
    const description = String(raw.description).trim();
    if (!description) throw new Error("TaskUpdate description cannot be empty");
    input.description = description;
  }
  if (raw.activeForm !== undefined) {
    input.activeForm = String(raw.activeForm).trim() || undefined;
  }
  if (raw.owner !== undefined) {
    input.owner = String(raw.owner).trim() || undefined;
  }
  if (raw.metadata !== undefined) {
    input.metadata = parseTaskMetadata(raw.metadata) ?? {};
  }
  if (raw.addBlocks !== undefined) {
    if (!Array.isArray(raw.addBlocks)) {
      throw new Error("TaskUpdate addBlocks must be an array");
    }
    input.addBlocks = raw.addBlocks.map((id) => String(id).trim()).filter(Boolean);
  }
  if (raw.addBlockedBy !== undefined) {
    if (!Array.isArray(raw.addBlockedBy)) {
      throw new Error("TaskUpdate addBlockedBy must be an array");
    }
    input.addBlockedBy = raw.addBlockedBy.map((id) => String(id).trim()).filter(Boolean);
  }

  const hasUpdate =
    input.status !== undefined ||
    input.subject !== undefined ||
    input.description !== undefined ||
    input.activeForm !== undefined ||
    input.owner !== undefined ||
    input.metadata !== undefined ||
    input.addBlocks !== undefined ||
    input.addBlockedBy !== undefined;

  if (!hasUpdate) {
    throw new Error("TaskUpdate requires at least one field to change");
  }

  return input;
}

export function deleteTask(sessionId: string, taskId: string): TaskDeleteResult {
  requireTask(sessionId, taskId);
  sessionMap(sessionId).delete(taskId);
  for (const task of sessionMap(sessionId).values()) {
    task.blocks = (task.blocks ?? []).filter((id) => id !== taskId);
    task.blockedBy = (task.blockedBy ?? []).filter((id) => id !== taskId);
  }
  return { taskId, deleted: true };
}

export function updateTask(sessionId: string, input: TaskUpdateInput): SessionTask | TaskDeleteResult {
  if (input.status === "deleted") {
    return deleteTask(sessionId, input.taskId);
  }

  const task = requireTask(sessionId, input.taskId);

  if (input.status !== undefined) {
    task.status = input.status;
  }
  if (input.subject !== undefined) {
    task.subject = input.subject;
  }
  if (input.description !== undefined) {
    task.description = input.description;
  }
  if (input.activeForm !== undefined) {
    task.activeForm = input.activeForm;
  }
  if (input.owner !== undefined) {
    task.owner = input.owner;
  }
  if (input.metadata !== undefined) {
    mergeTaskMetadata(task, input.metadata);
  }
  if (input.addBlockedBy?.length) {
    linkBlockedBy(sessionId, task, input.addBlockedBy);
  }
  if (input.addBlocks?.length) {
    linkBlocks(sessionId, task, input.addBlocks);
  }

  return task;
}

/** Test-only reset. */
export function resetTaskStore(): void {
  sessionTasks.clear();
}
