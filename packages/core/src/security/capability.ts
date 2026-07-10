import type { SessionCapability, ToolCapabilityKind, ToolDefinition } from "@kako/shared";

const CAPABILITY_TOOLS: Record<SessionCapability, Set<ToolCapabilityKind>> = {
  ReadOnly: new Set(["read"]),
  WorkspaceWrite: new Set(["read", "write", "mcp", "network"]),
  FullAccess: new Set(["read", "write", "exec", "mcp", "network"]),
};

export function toolCapabilitiesFromMetadata(
  capability?: ToolCapabilityKind[],
): Set<ToolCapabilityKind> {
  return new Set(capability ?? []);
}

export function isCapabilityAllowed(
  sessionCapability: SessionCapability,
  required: ToolCapabilityKind[],
): boolean {
  if (required.length === 0) return true;
  const allowed = CAPABILITY_TOOLS[sessionCapability];
  return required.every((c) => allowed.has(c));
}

export function isToolAllowedForCapability(
  definition: ToolDefinition,
  sessionCapability: SessionCapability,
): boolean {
  const required = definition.security?.capability ?? [];
  return isCapabilityAllowed(sessionCapability, required);
}

export function capabilityDenialMessage(
  sessionCapability: SessionCapability,
  required: ToolCapabilityKind[],
): string | null {
  if (isCapabilityAllowed(sessionCapability, required)) return null;
  const missing = required.filter((c) => !CAPABILITY_TOOLS[sessionCapability].has(c));
  return `Session capability ${sessionCapability} does not allow: ${missing.join(", ")}`;
}
