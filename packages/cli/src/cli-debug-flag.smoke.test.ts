import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { normalizeCliArgv } from "./cli-argv.js";

function parseDebug(argv: string[]): { debug: boolean; cwd?: string } {
  let result = { debug: false, cwd: undefined as string | undefined };
  const program = new Command();
  program.exitOverride().option("--debug", "dbg");
  program
    .command("chat", { isDefault: true })
    .option("-C, --cwd <path>", "cwd", process.cwd())
    .option("--debug", "dbg")
    .action(function (this: Command, opts: { cwd: string }) {
      const globals = this.optsWithGlobals() as { debug?: boolean; cwd?: string };
      result = { debug: Boolean(globals.debug), cwd: opts.cwd ?? globals.cwd };
    });
  program.parse(normalizeCliArgv(argv));
  return result;
}

describe("cli --debug flag wiring", () => {
  it("enables for kako --debug (default chat)", () => {
    expect(parseDebug(["node", "kako", "--debug"]).debug).toBe(true);
  });

  it("enables for kako -debug after normalize", () => {
    expect(parseDebug(["node", "kako", "-debug"]).debug).toBe(true);
  });

  it("enables for kako chat --debug -C /path", () => {
    const parsed = parseDebug(["node", "kako", "chat", "--debug", "-C", "/tmp"]);
    expect(parsed.debug).toBe(true);
    expect(parsed.cwd).toBe("/tmp");
  });

  it("stays off without the flag", () => {
    expect(parseDebug(["node", "kako", "chat", "-C", "/tmp"]).debug).toBe(false);
  });
});
