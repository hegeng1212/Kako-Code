import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLayout, parseInputActions } from "./terminal-layout.js";
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
  readingRewind: boolean;
  readingLine: boolean;
  rewindPhase: "list" | "confirm";
  rewindBusy: boolean;
  rewindConfirmAnchor: {
    text: string;
    timestamp: string;
    transcriptIndex: number;
  } | null;
  rewindConfirmActionIndex: number;
  rewindHandlers: unknown;
  rewindRows: unknown[];
  rewindSelected: number;
  submitRewindSelection: () => Promise<void>;
  handleRewindInput: (chunk: string) => Promise<void>;
  closeRewindPanel: () => void;
  drawActiveFooter: (...args: unknown[]) => void;
  handleReadLineAction: (action: { type: string; char?: string }) => void;
  onInput: (chunk: string) => void;
  inputBuffer: string;
  appExitRequested: boolean;
  turnExitRequested: boolean;
  lastCtrlCAt: number;
  suppressReadLineEnterUntil: number;
  clearReadLineEnterSuppress: () => void;
  armReadLineEnterSuppress: () => void;
};

async function restoreContinueExec(
  layout: ChatLayout,
): Promise<{ internals: LayoutInternals; restore: ReturnType<typeof vi.fn> }> {
  const internals = layout as unknown as LayoutInternals;
  const restore = vi.fn(async () => {});
  internals.rewindHandlers = {
    loadTurns: async () => [],
    restore,
    restoreCode: async () => {},
    summarize: async () => {},
  };
  internals.readingRewind = true;
  internals.rewindPhase = "confirm";
  internals.rewindConfirmActionIndex = 0;
  internals.rewindConfirmAnchor = {
    text: "继续执行",
    timestamp: "2026-07-14T00:00:00.000Z",
    transcriptIndex: 2,
  };
  await internals.submitRewindSelection();
  return { internals, restore };
}

async function readLineStillPending(
  linePromise: Promise<string>,
): Promise<"still-pending" | "resolved" | unknown> {
  return Promise.race([
    linePromise.then(
      () => "resolved" as const,
      (err: unknown) => err,
    ),
    Promise.resolve("still-pending" as const),
  ]);
}

describe("Rewind restore conversation", () => {
  it("coalesces CRLF into a single enter action", () => {
    const { actions } = parseInputActions("\r\n");
    expect(actions).toEqual([{ type: "enter" }]);
  });

  it("restores chat input footer after Restore conversation (no blank chrome)", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });

    const internals = layout as unknown as LayoutInternals;
    const footerSpy = vi.spyOn(internals, "drawActiveFooter");
    const { restore } = await restoreContinueExec(layout);

    expect(restore).toHaveBeenCalledOnce();
    expect(layout.isAgentsPanelOpen()).toBe(false);
    expect(internals.readingRewind).toBe(false);
    expect(internals.inputBuffer).toBe("继续执行");
    expect(footerSpy).toHaveBeenCalled();
    await expect(readLineStillPending(linePromise)).resolves.toBe("still-pending");
  });

  it("ignores trailing Enter after Restore so prefilled text is not auto-submitted", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    const { internals } = await restoreContinueExec(layout);

    expect(internals.suppressReadLineEnterUntil).toBeGreaterThan(Date.now());

    internals.handleReadLineAction({ type: "enter" });

    await expect(readLineStillPending(linePromise)).resolves.toBe("still-pending");
    expect(internals.inputBuffer).toBe("继续执行");
  });

  it("ignores a late stdin \\n chunk after Restore via onInput", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });
    const { internals } = await restoreContinueExec(layout);

    internals.onInput("\n");
    await Promise.resolve();
    await Promise.resolve();

    await expect(readLineStillPending(linePromise)).resolves.toBe("still-pending");
    expect(internals.inputBuffer).toBe("继续执行");
  });

  it("confirm Enter as \\r then delayed \\n does not auto-submit restore prefill", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });

    const internals = layout as unknown as LayoutInternals;
    const restore = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    internals.rewindHandlers = {
      loadTurns: async () => [],
      restore,
      restoreCode: async () => {},
      summarize: async () => {},
    };
    internals.readingRewind = true;
    internals.rewindPhase = "confirm";
    internals.rewindConfirmActionIndex = 0;
    internals.rewindConfirmAnchor = {
      text: "继续执行",
      timestamp: "2026-07-14T00:00:00.000Z",
      transcriptIndex: 2,
    };

    const first = internals.handleRewindInput("\r");
    internals.onInput("\n");
    await first;
    await Promise.resolve();
    await Promise.resolve();

    expect(restore).toHaveBeenCalledOnce();
    expect(internals.inputBuffer).toBe("继续执行");
    await expect(readLineStillPending(linePromise)).resolves.toBe("still-pending");
  });

  it("list Esc (lone buffered ESC flush) closes Rewind and restores the input box", async () => {
    vi.useFakeTimers();
    const layout = testLayout();
    layout.setSessionId("sess-a");
    void layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });

    const internals = layout as unknown as LayoutInternals & {
      settleRewindEscape: () => void;
      scheduleStdinRestFlush: () => void;
      stdinRest: string;
    };
    internals.rewindHandlers = {
      loadTurns: async () => [],
      restore: async () => {},
      restoreCode: async () => {},
      summarize: async () => {},
    };
    internals.readingRewind = true;
    internals.rewindPhase = "list";
    internals.rewindRows = [
      { kind: "current", label: "(current)" },
    ];
    internals.rewindSelected = 0;

    // Lone Esc is buffered (incomplete CSI), then flushed after 35ms.
    await internals.handleRewindInput("\x1b");
    expect(internals.readingRewind).toBe(true);
    expect(internals.stdinRest).toBe("\x1b");

    await vi.advanceTimersByTimeAsync(40);

    expect(internals.readingRewind).toBe(false);
    expect(internals.readingLine).toBe(true);
    expect(internals.stdinRest).toBe("");
    vi.useRealTimers();
  });

  it("list Enter as \\r\\n opens confirm without immediately Restoring", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    void layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });

    const internals = layout as unknown as LayoutInternals;
    const restore = vi.fn(async () => {});
    internals.rewindHandlers = {
      loadTurns: async () => [],
      restore,
      restoreCode: async () => {},
      summarize: async () => {},
    };
    internals.readingRewind = true;
    internals.rewindPhase = "list";
    internals.rewindConfirmActionIndex = 0;
    internals.rewindRows = [
      {
        kind: "history",
        label: "继续执行",
        transcriptIndex: 2,
        timestamp: "2026-07-14T00:00:00.000Z",
      },
      { kind: "current", label: "(current)" },
    ];
    internals.rewindSelected = 0;

    await internals.handleRewindInput("\r\n");

    expect(restore).not.toHaveBeenCalled();
    expect(internals.rewindPhase).toBe("confirm");
    expect(internals.readingRewind).toBe(true);
  });

  it("clears sticky exit flags on successful Restore", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    const internals = layout as unknown as LayoutInternals;
    await vi.waitFor(() => {
      expect(internals.readingLine).toBe(true);
    });
    internals.appExitRequested = true;
    internals.turnExitRequested = true;
    internals.lastCtrlCAt = Date.now();

    await restoreContinueExec(layout);

    expect(internals.appExitRequested).toBe(false);
    expect(internals.turnExitRequested).toBe(false);
    expect(internals.lastCtrlCAt).toBe(0);
    await expect(readLineStillPending(linePromise)).resolves.toBe("still-pending");
  });

  it("allows Enter after the user edits the prefilled line", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const linePromise = layout.readLine({ plain: true });
    const { internals } = await restoreContinueExec(layout);

    internals.handleReadLineAction({ type: "char", char: "!" });
    expect(internals.inputBuffer).toBe("继续执行!");
    expect(internals.suppressReadLineEnterUntil).toBe(0);

    internals.handleReadLineAction({ type: "enter" });

    await expect(linePromise).resolves.toBe("继续执行!");
  });

  it("next readLine after Restore is not blocked by leftover Enter suppress", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-a");
    const first = layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });
    const { internals } = await restoreContinueExec(layout);

    // Leftover guard from Restore still armed on the first readLine.
    expect(internals.suppressReadLineEnterUntil).toBeGreaterThan(Date.now());

    // Finish the restored prompt without using Enter (simulate prior turn ending).
    internals.handleReadLineAction({ type: "char", char: "x" });
    internals.handleReadLineAction({ type: "enter" });
    await expect(first).resolves.toBe("继续执行x");

    // A later chat turn must accept a single Enter — no sticky suppress.
    const second = layout.readLine({ plain: true });
    await vi.waitFor(() => {
      expect((layout as unknown as LayoutInternals).readingLine).toBe(true);
    });
    expect(internals.suppressReadLineEnterUntil).toBe(0);
    internals.handleReadLineAction({ type: "char", char: "h" });
    internals.handleReadLineAction({ type: "char", char: "i" });
    internals.handleReadLineAction({ type: "enter" });
    await expect(second).resolves.toBe("hi");
  });
});
