import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatLayout,
  ExitRequestedError,
  SessionHandoffError,
} from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

type LayoutInternals = {
  readingAgentsPanel: boolean;
  agentsPanelHandlers: unknown;
  handleAgentsPanelInput: (chunk: string) => Promise<void>;
  syncOverlayFooterAfterAgents: () => void;
  wakeSessionOverlayWaiters: () => void;
  closeAgentsPanel: (options?: { exitApp?: boolean }) => void;
};

function openAgentsForTest(layout: ChatLayout): LayoutInternals {
  const internals = layout as unknown as LayoutInternals;
  internals.agentsPanelHandlers = {
    entryCwd: () => "/tmp",
    modelLabel: () => "test",
    agentName: () => "main",
    version: "0.0.0",
    loadSessions: async () => [],
    loadBgTasks: () => [],
    loadRunningBgSessionIds: () => new Set<string>(),
    loadInterruptedSessionIds: async () => new Set<string>(),
    previewForSession: async () => "",
    answerDurationForSession: async () => 0,
  };
  internals.readingAgentsPanel = true;
  layout.setSessionId("sess-a");
  return internals;
}

describe("Agents Ctrl+C exit", () => {
  it("double Ctrl+C with underlying readLine rejects ExitRequestedError and sticky appExit", async () => {
    const layout = testLayout();
    const linePromise = layout.readLine({ plain: true });
    const agents = openAgentsForTest(layout);

    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    await expect(linePromise).rejects.toBeInstanceOf(ExitRequestedError);
    expect(layout.isAgentsPanelOpen()).toBe(false);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("mouseMove between Ctrl+Cs does not disarm exit arm", async () => {
    const layout = testLayout();
    const linePromise = layout.readLine({ plain: true });
    const agents = openAgentsForTest(layout);

    await agents.handleAgentsPanelInput("\u0003");
    // SGR any-event hover — must not clear lastCtrlCAt
    await agents.handleAgentsPanelInput("\x1b[<35;12;8M");
    await agents.handleAgentsPanelInput("\u0003");

    await expect(linePromise).rejects.toBeInstanceOf(ExitRequestedError);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("mouseDrag between Ctrl+Cs does not disarm exit arm", async () => {
    const layout = testLayout();
    const linePromise = layout.readLine({ plain: true });
    const agents = openAgentsForTest(layout);

    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\x1b[<32;14;8M");
    await agents.handleAgentsPanelInput("\u0003");

    await expect(linePromise).rejects.toBeInstanceOf(ExitRequestedError);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("exitApp skips chat re-paint and wake", async () => {
    const layout = testLayout();
    const agents = openAgentsForTest(layout);
    const syncSpy = vi.spyOn(agents, "syncOverlayFooterAfterAgents");
    const wakeSpy = vi.spyOn(agents, "wakeSessionOverlayWaiters");

    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    expect(layout.isAgentsPanelOpen()).toBe(false);
    expect(layout.consumeAppExitRequested()).toBe(true);
    expect(syncSpy).not.toHaveBeenCalled();
    expect(wakeSpy).not.toHaveBeenCalled();
  });

  it("exitApp without pending waiter keeps sticky appExit and closes Agents", async () => {
    const layout = testLayout();
    const agents = openAgentsForTest(layout);

    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    expect(layout.isAgentsPanelOpen()).toBe(false);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("SessionHandoff while Agents open keeps readLine waiter for exitApp", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    openAgentsForTest(layout);

    // Switching sessions under Agents must not orphan the outstanding reader.
    layout.parkForegroundSession();
    layout.setSessionId("sess-b");

    await expect(
      Promise.race([
        linePromise.then(
          () => "resolved" as const,
          (err: unknown) => err,
        ),
        Promise.resolve("still-pending" as const),
      ]),
    ).resolves.toBe("still-pending");

    const agents = layout as unknown as LayoutInternals;
    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    await expect(linePromise).rejects.toBeInstanceOf(ExitRequestedError);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("readLine does not arm a second waiter while Agents is open", async () => {
    const layout = testLayout();
    const first = layout.readLine({ plain: true });
    openAgentsForTest(layout);

    const secondStarted = layout.readLine({ plain: true }).then(
      () => "resolved" as const,
      (err: unknown) => err,
    );

    // Second call must wait on Agents, not overwrite/orphan the first promise.
    await expect(
      Promise.race([secondStarted, Promise.resolve("waiting" as const)]),
    ).resolves.toBe("waiting");

    const agents = layout as unknown as LayoutInternals;
    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    await expect(first).rejects.toBeInstanceOf(ExitRequestedError);
    await expect(secondStarted).resolves.toBeInstanceOf(ExitRequestedError);
    expect(layout.consumeAppExitRequested()).toBe(true);
  });

  it("double Ctrl+C rejects with ExitRequestedError not SessionHandoffError", async () => {
    const layout = testLayout();
    const linePromise = layout.readLine({ plain: true });
    const agents = openAgentsForTest(layout);

    await agents.handleAgentsPanelInput("\u0003");
    await agents.handleAgentsPanelInput("\u0003");

    try {
      await linePromise;
      expect.unreachable("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(ExitRequestedError);
      expect(err).not.toBeInstanceOf(SessionHandoffError);
    }
  });
});
