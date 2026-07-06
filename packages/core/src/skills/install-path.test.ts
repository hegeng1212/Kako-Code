import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../tools/builtin/test-helpers.js";
import { skillInstallDirForName } from "./install-path.js";

describe("skillInstallDirForName", () => {
  it("installs under flat ~/.kako/skills/{name}", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako");
      expect(skillInstallDirForName("docx")).toBe(join(cwd, ".kako", "skills", "docx"));
      expect(skillInstallDirForName("brainstorming")).toBe(
        join(cwd, ".kako", "skills", "brainstorming"),
      );
    });
  });
});
