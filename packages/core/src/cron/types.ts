export interface CronCreateInput {
  cron: string;
  prompt: string;
  recurring?: boolean;
  durable?: boolean;
}

export interface CronJob {
  id: string;
  sessionId: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string;
  /** Recurring jobs auto-expire after 7 days. */
  expiresAt: string;
}

export interface CronCreateResult {
  jobId: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  expiresAt: string;
}

export interface CronDeleteResult {
  jobId: string;
  deleted: boolean;
}

export interface CronListJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface CronListResult {
  jobs: CronListJob[];
}

export const CRON_RECURRING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
