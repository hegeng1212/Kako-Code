import { describe, expect, it } from "vitest";
import { normalizeToolConfirmResult } from "@kako/shared";

describe("normalizeToolConfirmResult", () => {
  it("wraps boolean results", () => {
    expect(normalizeToolConfirmResult(true)).toEqual({ allowed: true, inputPatch: undefined });
    expect(normalizeToolConfirmResult(false)).toEqual({ allowed: false, inputPatch: undefined });
  });

  it("passes through structured results", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: true,
        permissionMode: "bypassPermissions",
      }),
    ).toEqual({
      allowed: true,
      permissionMode: "bypassPermissions",
      denialReason: undefined,
      inputPatch: undefined,
    });
  });

  it("includes denial reason when provided", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: false,
        denialReason: "User requested plan changes",
      }),
    ).toEqual({
      allowed: false,
      permissionMode: undefined,
      denialReason: "User requested plan changes",
      inputPatch: undefined,
    });
  });

  it("passes inputPatch through", () => {
    expect(
      normalizeToolConfirmResult({
        allowed: true,
        inputPatch: { scriptPath: "/tmp/preview.js" },
      }),
    ).toEqual({
      allowed: true,
      permissionMode: undefined,
      denialReason: undefined,
      inputPatch: { scriptPath: "/tmp/preview.js" },
    });
  });
});
