#!/usr/bin/env node
/** @deprecated Use `kako peek-spreadsheet` — delegates to CLI with bundled xlsx. */
import { spawnSync } from "node:child_process";

const filePath = process.argv[2];
const maxRows = process.argv[3] ?? "5";

if (!filePath) {
  console.error("Usage: peek-spreadsheet.mjs <file> [maxRows]");
  console.error("Prefer: kako peek-spreadsheet <file> [maxRows]");
  process.exit(1);
}

const result = spawnSync("kako", ["peek-spreadsheet", filePath, maxRows], {
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
