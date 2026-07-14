import type { PermissionMode } from "@kako/shared";
import { ensurePlanFile } from "./plan-mode-shared.js";

export interface EnterPlanModeSessionOptions {
  sessionId: string;
  currentMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode, planFilePath?: string) => void;
}

export interface EnterPlanModeSessionResult {
  entered: boolean;
  planPath: string;
}

/** Shared harness entry for /plan, shift+tab, and EnterPlanMode tool. */
export async function enterPlanModeSession(
  options: EnterPlanModeSessionOptions,
): Promise<EnterPlanModeSessionResult> {
  const planPath = await ensurePlanFile(options.sessionId);
  if (options.currentMode !== "plan") {
    options.setPermissionMode("plan", planPath);
    return { entered: true, planPath };
  }
  return { entered: false, planPath };
}
