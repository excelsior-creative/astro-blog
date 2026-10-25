import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkPage } from "./security-browser-scenarios.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(
  process.cwd() + "/",
  root,
  "Run this fixture from the repository root"
);
assert.ok(
  readdirSync(root).every(
    name =>
      (!name.startsWith(".env") && !name.startsWith(".dev.vars")) ||
      /\.(example|sample|template)$/.test(name)
  ),
  "Runtime environment files are not allowed in the local browser fixture"
);
const host = "127.0.0.1";
const port = 43140;
const origin = `http://${host}:${port}`;
// Refuse an existing listener: the fixture must own the server it exercises.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(port, host, () => probe.close(resolve));
});
const env = Object.fromEntries(
  ["HOME", "USER", "TMPDIR", "PATH", "LANG"]
    .filter(k => process.env[k])
    .map(k => [k, process.env[k]])
);
Object.assign(env, {
  ASTRO_TELEMETRY_DISABLED: "1",
  WRANGLER_SEND_METRICS: "false",
  NODE_ENV: "production",
});
const server = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/astro/bin/astro.mjs", import.meta.url)
    ),
    "preview",
    "--host",
    host,
    "--port",
    String(port),
  ],
  { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] }
);
let serverError = "";
server.stderr.on("data", data => {
  serverError = (serverError + data).slice(-8000);
});
const exit = new Promise(resolve => server.once("exit", resolve));
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(
      server.exitCode,
      null,
      `Owned preview exited before readiness: ${serverError}`
    );
    try {
      ready = (
        await fetch(origin, {
          signal: AbortSignal.timeout(500),
          redirect: "error",
        })
      ).ok;
    } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Owned preview did not become ready");
  browser = await chromium.launch({ headless: true });
  for (const mode of [
    { viewport: { width: 1440, height: 900 }, touch: false },
    { viewport: { width: 390, height: 844 }, touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: mode.viewport,
      isMobile: mode.touch,
      hasTouch: mode.touch,
      reducedMotion: "reduce",
    });
    try {
      const result = await checkPage(await context.newPage(), origin, {
        touch: mode.touch,
      });
      console.log(JSON.stringify(result));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await exit;
  clearTimeout(timer);
}
