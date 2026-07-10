import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_BASH_DESCRIPTION } from "../claude-tool-text.js";
import { resolvePath } from "./path.js";
import { loadSecurityPolicy } from "../../security/policy-store.js";

export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 600_000;

const BASH_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_BASH_DESCRIPTION);

export const bashToolDefinition: ToolDefinition = {
  name: "Bash",
  description: BASH_DESCRIPTION,
  requiresConfirmation: true,
  sandbox: { timeoutMs: BASH_DEFAULT_TIMEOUT_MS },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        description: "The command to execute",
      },
      dangerouslyDisableSandbox: {
        type: "boolean",
        description:
          "Set this to true to dangerously override sandbox mode and run commands without sandboxing.",
      },
      description: {
        type: "string",
        description: `Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`,
      },
      run_in_background: {
        type: "boolean",
        description: "Set to true to run this command in the background.",
      },
      timeout: {
        type: "number",
        description: "Optional timeout in milliseconds (max 600000)",
      },
    },
    required: ["command"],
  },
};

/** Resolve timeout from \`timeout\` (schema) or legacy \`timeout_ms\`, with policy defaults. */
export async function resolveBashTimeoutMs(
  input: Record<string, unknown>,
  cwd?: string,
): Promise<number> {
  const policy = await loadSecurityPolicy(cwd ?? process.cwd());
  const defaultMs = policy.resources.bashTimeoutMs ?? BASH_DEFAULT_TIMEOUT_MS;
  const maxMs = policy.resources.bashMaxTimeoutMs ?? BASH_MAX_TIMEOUT_MS;
  const raw = input.timeout ?? input.timeout_ms ?? defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return Math.min(Math.floor(n), maxMs);
}

export function assertBashInputSupported(input: Record<string, unknown>): void {
  if (input.run_in_background) {
    throw new Error("Background bash commands are not supported yet");
  }
}

export const bashHandler: ToolHandler = async (input, context) => {
  assertBashInputSupported(input);

  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const cwd = input.working_directory
    ? resolvePath(String(input.working_directory), context.cwd)
    : context.cwd;
  const policy = await loadSecurityPolicy(context.cwd);
  const timeout = await resolveBashTimeoutMs(input, context.cwd);
  const maxBuffer = policy.resources.bashMaxOutputBytes ?? 10 * 1024 * 1024;

  try {
    const { stdout, stderr } = await execAsync(String(input.command), {
      cwd,
      timeout,
      maxBuffer,
      signal: context.signal,
    });
    const parts = [];
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(stderr);
    return parts.join("\n") || "(no output)";
  } catch (error) {
    const err = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const parts = [];
    if (err.stdout) parts.push(err.stdout);
    if (err.stderr) parts.push(err.stderr);
    if (parts.length) {
      return parts.join("\n");
    }
    // grep exits 1 when there are no matches — treat as empty output, not a tool failure.
    if (err.code === 1 && /\bgrep\b/.test(String(input.command))) {
      return "(no output)";
    }
    throw error;
  }
};
