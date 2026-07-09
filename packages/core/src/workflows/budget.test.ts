import { describe, expect, it, beforeEach } from "vitest";
import {
  TurnBudgetPool,
  TurnBudgetExhaustedError,
  beginTurnBudget,
  clearTurnBudget,
  getTurnBudget,
  parseTurnTokenTarget,
} from "./budget.js";

describe("parseTurnTokenTarget", () => {
  it("parses +500k style directives", () => {
    expect(parseTurnTokenTarget("research this +500k")).toBe(500_000);
    expect(parseTurnTokenTarget("go deep +1.5m tokens")).toBe(1_500_000);
    expect(parseTurnTokenTarget("use +200000 output")).toBe(200_000);
  });

  it("returns null when no directive present", () => {
    expect(parseTurnTokenTarget("normal question")).toBeNull();
  });
});

describe("TurnBudgetPool", () => {
  it("tracks spent and remaining", () => {
    const pool = new TurnBudgetPool(1000);
    expect(pool.remaining()).toBe(1000);
    pool.recordOutputTokens(400);
    expect(pool.spent()).toBe(400);
    expect(pool.remaining()).toBe(600);
  });

  it("remaining is Infinity when no total", () => {
    const pool = new TurnBudgetPool(null);
    expect(pool.remaining()).toBe(Infinity);
    pool.recordOutputTokens(999_999);
    expect(pool.remaining()).toBe(Infinity);
  });

  it("throws when budget exhausted", () => {
    const pool = new TurnBudgetPool(100);
    pool.recordOutputTokens(100);
    expect(() => pool.assertBeforeAgent()).toThrow(TurnBudgetExhaustedError);
  });
});

describe("session turn budget registry", () => {
  beforeEach(() => {
    clearTurnBudget("sess-budget");
  });

  it("beginTurnBudget stores pool per session", () => {
    beginTurnBudget("sess-budget", "+250k please");
    const pool = getTurnBudget("sess-budget");
    expect(pool?.total).toBe(250_000);
  });
});
