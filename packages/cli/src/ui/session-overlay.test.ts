import { describe, expect, it } from "vitest";
import { ChatLayout } from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";

function testLayout(): ChatLayout {
  return new ChatLayout(
    () => ({
      version: "0.0.0",
      agentName: "main",
      modelLabel: "test",
      cwd: "/tmp",
      sessionId: "sess-a",
      sessionLabel: "main",
      dataDir: "/tmp",
    }),
    renderInitialInputFooter(),
  );
}

describe("session overlay concurrency", () => {
  it("isTurnExitRequestedFor only matches the live turn session", () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    (layout as unknown as { turnExitRequested: boolean }).turnExitRequested = true;
    (layout as unknown as { liveTurnSessionId: string | null }).liveTurnSessionId = "sess-a";

    expect(layout.isTurnExitRequestedFor("sess-a")).toBe(true);
    expect(layout.isTurnExitRequestedFor("sess-b")).toBe(false);
  });

  it("does not present overlays for off-screen sessions while Agents is open", () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    (layout as unknown as { readingAgentsPanel: boolean }).readingAgentsPanel = true;

    expect(layout.canPresentSessionOverlay("sess-a")).toBe(false);
    expect(layout.canPresentSessionOverlay("sess-b")).toBe(false);
  });

  it("allows a focused session when the previous overlay owner is parked", () => {
    const layout = testLayout();
    layout.setSessionId("sess-b");
    (layout as unknown as { sessionOverlayOwner: string | null }).sessionOverlayOwner = "sess-a";
    (
      layout as unknown as { parkedSessions: Map<string, unknown> }
    ).parkedSessions.set("sess-a", {});

    expect(layout.canPresentSessionOverlay("sess-b")).toBe(true);
  });
});
