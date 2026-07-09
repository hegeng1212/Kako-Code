/** Shared output-token budget for a user turn (main loop + all workflows). */

export class TurnBudgetPool {
  private _spent = 0;

  constructor(public readonly total: number | null) {}

  spent(): number {
    return this._spent;
  }

  remaining(): number {
    if (this.total == null) return Infinity;
    return Math.max(0, this.total - this._spent);
  }

  recordOutputTokens(count: number): void {
    if (count > 0) this._spent += count;
  }

  assertBeforeAgent(): void {
    if (this.total != null && this._spent >= this.total) {
      throw new TurnBudgetExhaustedError(this.total);
    }
  }
}

export class TurnBudgetExhaustedError extends Error {
  constructor(total: number) {
    super(`Turn token budget exhausted (${total.toLocaleString()} output tokens)`);
    this.name = "TurnBudgetExhaustedError";
  }
}

/** Parse "+500k", "+1.5m", "+200000" style directives from user text. */
export function parseTurnTokenTarget(text: string): number | null {
  const match = text.match(/\+(\d+(?:\.\d+)?)\s*([kKmM])?(?:\s*tokens?)?\b/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") return Math.round(value * 1_000);
  if (suffix === "m") return Math.round(value * 1_000_000);
  return Math.round(value);
}

const activeTurnBudgets = new Map<string, TurnBudgetPool>();

export function beginTurnBudget(sessionId: string, userText: string): TurnBudgetPool {
  const total = parseTurnTokenTarget(userText);
  const pool = new TurnBudgetPool(total);
  activeTurnBudgets.set(sessionId, pool);
  return pool;
}

export function getTurnBudget(sessionId: string): TurnBudgetPool | undefined {
  return activeTurnBudgets.get(sessionId);
}

export function clearTurnBudget(sessionId: string): void {
  activeTurnBudgets.delete(sessionId);
}

export function createBudgetView(sessionId: string): {
  total: number | null;
  spent(): number;
  remaining(): number;
} {
  const pool = getTurnBudget(sessionId);
  return {
    total: pool?.total ?? null,
    spent: () => pool?.spent() ?? 0,
    remaining: () => pool?.remaining() ?? Infinity,
  };
}
