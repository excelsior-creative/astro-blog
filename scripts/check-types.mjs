import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/astro/bin/astro.mjs", import.meta.url)
    ),
    "check",
  ],
  { encoding: "utf8" }
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
assert.equal(result.status, 0, "Astro diagnostics failed");
assert.ok(
  Number(result.stdout.match(/Result \((\d+) files\)/)?.[1]) > 0,
  "Astro must check actual files; zero files is not a passing check"
);
