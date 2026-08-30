import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VERSION } from "../src/version.js";

test("package, CLI, and skill versions stay in sync", () => {
  const packageJson = JSON.parse(
    readFileSync("package.json", "utf8"),
  ) as { version?: string };
  const skill = readFileSync("SKILL.md", "utf8");
  const skillVersion = /^  version:\s*["']?([^"'\s]+)["']?$/m.exec(skill)?.[1];

  assert.equal(packageJson.version, VERSION);
  assert.equal(skillVersion, VERSION);
});
