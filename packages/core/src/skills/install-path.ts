import { join } from "node:path";
import { getSkillsDir } from "../config/paths.js";

/** Flat layout: ~/.kako/skills/{skillName}/ — same for SkillHub, GitHub, zip, and local. */
export function skillInstallDirForName(skillName: string): string {
  return join(getSkillsDir(), skillName);
}
