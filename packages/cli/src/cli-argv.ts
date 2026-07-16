/** Normalize CLI argv before commander parse (e.g. literal `-debug` → `--debug`). */
export function normalizeCliArgv(argv: readonly string[]): string[] {
  return argv.map((arg) => (arg === "-debug" ? "--debug" : arg));
}
