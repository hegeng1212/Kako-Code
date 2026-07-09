/**
 * Adapt Claude Code tool copy for Kako.
 * Only product-specific substitutions (project instructions, paths, product name).
 * Model names in tool schemas stay Kako-specific where applicable.
 */
export function adaptClaudeCodeToolText(text: string): string {
  return text
    .replaceAll("CLAUDE.md", "KAKO.md")
    .replaceAll(".claude/scheduled_tasks.json", "~/.kako/config/scheduled_tasks.json")
    .replaceAll(".claude/worktrees/", ".kako/worktrees/")
    .replaceAll(".claude/commands/", ".kako/commands/")
    .replaceAll(".claude/workflows/", ".kako/workflows/")
    .replaceAll("this Claude session", "this Kako session")
    .replaceAll("when Claude exits", "when Kako exits")
    .replace(
      /Co-Authored-By: Claude [^\n]+/g,
      "Co-Authored-By: Kako <noreply@kako.dev>",
    )
    .replaceAll(
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      "🤖 Generated with Kako",
    )
    .replaceAll("Claude Code", "Kako");
}
