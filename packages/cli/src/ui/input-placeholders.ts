/** Claude-style idle input prompts — picked at random each empty prompt. */

export const INPUT_PLACEHOLDER_SUGGESTIONS = [
  'Try "fix typecheck errors"',
  'Try "explain this codebase"',
  'Try "write a unit test for this"',
  'Try "review the latest changes"',
  'Try "find the bug in this function"',
  'Try "refactor this for clarity"',
  'Try "add error handling here"',
  'Try "summarize how this works"',
] as const;

/** Pick a random idle placeholder (Claude Code-style `Try "…"`). */
export function pickInputPlaceholder(
  suggestions: readonly string[] = INPUT_PLACEHOLDER_SUGGESTIONS,
  random: () => number = Math.random,
): string {
  if (suggestions.length === 0) return 'Try "explain this codebase"';
  const index = Math.floor(random() * suggestions.length) % suggestions.length;
  return suggestions[index] ?? suggestions[0]!;
}
