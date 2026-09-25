import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VERSION } from "../src/version.js";

test("package, lockfile, CLI, and skill versions stay in sync", () => {
  const packageJson = JSON.parse(
    readFileSync("package.json", "utf8"),
  ) as { version?: string };
  const skill = readFileSync("SKILL.md", "utf8");
  const skillVersion = /^  version:\s*["']?([^"'\s]+)["']?$/m.exec(skill)?.[1];

  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  const installs = [...skill.matchAll(/sipgate-mcp@(\S+)/g)].map((match) => match[1]);

  assert.equal(packageJson.version, VERSION);
  assert.equal(skillVersion, VERSION);
  assert.equal(lock.version, VERSION);
  assert.equal(lock.packages?.[""]?.version, VERSION);
  assert.ok(installs.length > 0);
  assert.deepEqual(new Set(installs), new Set([VERSION]));
});
