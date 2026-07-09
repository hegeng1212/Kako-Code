export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TaskCreateInput {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionTask {
  id: string;
  sessionId: string;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  blocks?: string[];
  blockedBy?: string[];
  /** Agent ID when the task is claimed; unset when available. */
  owner?: string;
}

export interface TaskCreateResult {
  id: string;
  subject: string;
  description: string;
  status: "pending";
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskGetResult {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskListSummary {
  id: string;
  subject: string;
  status: TaskStatus;
  owner: string;
  blockedBy: string[];
}

export interface TaskListResult {
  tasks: TaskListSummary[];
}

export type TaskUpdateStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface TaskUpdateInput {
  taskId: string;
  status?: TaskUpdateStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

export interface TaskUpdateResult {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  owner?: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskDeleteResult {
  taskId: string;
  deleted: true;
}
