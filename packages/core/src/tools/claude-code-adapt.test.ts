import { describe, expect, it } from "vitest";
import { adaptClaudeCodeToolText } from "./claude-code-adapt.js";

describe("adaptClaudeCodeToolText", () => {
  it("substitutes project instructions and product paths", () => {
    const raw =
      "See CLAUDE.md and .claude/worktrees/foo. Claude Code uses .claude/commands/bar.";
    expect(adaptClaudeCodeToolText(raw)).toBe(
      "See KAKO.md and .kako/worktrees/foo. Kako uses .kako/commands/bar.",
    );
  });

  it("substitutes cron session and durable paths", () => {
    const raw =
      "Jobs live only in this Claude session. Persist to .claude/scheduled_tasks.json when durable.";
    expect(adaptClaudeCodeToolText(raw)).toBe(
      "Jobs live only in this Kako session. Persist to ~/.kako/config/scheduled_tasks.json when durable.",
    );
  });

  it("substitutes workflow registry paths", () => {
    expect(adaptClaudeCodeToolText("Load from .claude/workflows/review.js")).toBe(
      "Load from .kako/workflows/review.js",
    );
  });

  it("substitutes git co-author and PR footer lines", () => {
    const raw = `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    expect(adaptClaudeCodeToolText(raw)).toBe(
      `Co-Authored-By: Kako <noreply@kako.dev>
🤖 Generated with Kako`,
    );
  });
});
