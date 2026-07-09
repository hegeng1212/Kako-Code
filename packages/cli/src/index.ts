#!/usr/bin/env node
import { Command } from "commander";
import { KAKO_CORE_VERSION } from "@kako/core";
import { runChat } from "./commands/chat.js";
import { runPeekPresentation } from "./commands/peek-presentation.js";
import { runPeekSpreadsheet } from "./commands/peek-spreadsheet.js";
import { runWeb } from "./commands/web.js";

const program = new Command();

program.name("kako").description("Kako — Agent Harness personal assistant").version(KAKO_CORE_VERSION);

program
  .command("chat", { isDefault: true })
  .description("Start an interactive chat session")
  .option("-C, --cwd <path>", "Working directory", process.cwd())
  .action(async (opts: { cwd: string }) => {
    await runChat(opts.cwd);
  });

program
  .command("web")
  .description("Open Kako settings (providers, MCP, skills)")
  .alias("settings")
  .action(async () => {
    await runWeb();
  });

program
  .command("peek-spreadsheet")
  .description("List sheets and print first rows of a spreadsheet (used by file-attachment Bash workflow)")
  .argument("<file>", "Absolute path to .xlsx, .xls, .csv, or .tsv")
  .argument("[rows]", "Max rows per sheet (default 5)", "5")
  .action(async (file: string, rows: string) => {
    const maxRows = Number(rows);
    if (!Number.isFinite(maxRows) || maxRows <= 0) {
      throw new Error("rows must be a positive number");
    }
    await runPeekSpreadsheet(file, maxRows);
  });

program
  .command("peek-presentation")
  .description("Extract slide text from PowerPoint (.pptx) — used by file-attachment Bash workflow")
  .argument("<file>", "Absolute path to .pptx or .ppt")
  .argument("[slides]", "Max slides to extract (default 5)", "5")
  .action(async (file: string, slides: string) => {
    const maxSlides = Number(slides);
    if (!Number.isFinite(maxSlides) || maxSlides <= 0) {
      throw new Error("slides must be a positive number");
    }
    await runPeekPresentation(file, maxSlides);
  });

program.parse();
