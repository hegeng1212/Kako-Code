import { availableParallelism } from "node:os";

export const WORKFLOW_AGENT_LIFETIME_CAP = 1000;
export const WORKFLOW_MAX_PIPELINE_ITEMS = 4096;
/** Per-agent wall-clock limit — prevents one hung WebSearch/WebFetch from stalling the run. */
export const WORKFLOW_AGENT_TIMEOUT_MS = 180_000;

export function workflowAgentConcurrencyCap(): number {
  const cores = availableParallelism();
  return Math.min(16, Math.max(1, cores - 2));
}

export class AgentConcurrencyGate {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly cap: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.cap) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.running++;
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}
