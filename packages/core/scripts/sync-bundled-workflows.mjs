import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const source = join(coreRoot, "..", "..", "workflows", "templates");
const target = join(coreRoot, "bundled", "workflows", "templates");

await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true, force: true });
console.log(`Synced workflow templates to ${target}`);
