/** Shallow-merge streamed tool-call argument objects (later keys win). */
export function mergeToolCallInput(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}
