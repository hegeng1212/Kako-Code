#!/usr/bin/env node
import { Command } from "commander";
import { KAKO_CORE_VERSION } from "@kako/core";
import { runChat } from "./commands/chat.js";

const program = new Command();

program
  .name("kako")
  .description("Kako — Agent Harness personal assistant")
  .version(KAKO_CORE_VERSION)
  .option("-C, --cwd <path>", "Working directory", process.cwd())
  .action(async (opts: { cwd: string }) => {
    await runChat(opts.cwd);
  });

program
  .command("chat")
  .description("Start an interactive chat session")
  .option("-C, --cwd <path>", "Working directory", process.cwd())
  .action(async (opts: { cwd: string }) => {
    await runChat(opts.cwd);
  });

program.parse();
