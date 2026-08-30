import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../src/index.js";

test("isMainModule recognizes an npm-style binary symlink", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sipgate-mcp-bin-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));

  const entrypoint = join(directory, "dist-index.js");
  const binaryLink = join(directory, "sipgate-mcp");
  await writeFile(entrypoint, "#!/usr/bin/env node\n", "utf8");
  await symlink(entrypoint, binaryLink);

  assert.equal(isMainModule(pathToFileURL(entrypoint).href, binaryLink), true);
  assert.equal(isMainModule(pathToFileURL(entrypoint).href, undefined), false);
});
