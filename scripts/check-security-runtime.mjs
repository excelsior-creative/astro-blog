import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { checkContentImages } from "./check-content-images.mjs";

// Resolve the dependencies actually used by Jampack, including scoped overrides.
const require = createRequire(import.meta.url);
const jampack = createRequire(require.resolve("@divriots/jampack/optimize"));
const load = specifier =>
  import(pathToFileURL(jampack.resolve(specifier)).href);
const { default: sharp } = await load("sharp");
const { fileTypeFromBuffer } = await load("file-type");
const { fetch } = await load("undici");
const { build } = await load("esbuild");
const jampackFile = name =>
  new URL(name, pathToFileURL(jampack.resolve("@divriots/jampack/optimize")));
const { default: state } = await import(jampackFile("./state.js"));
state.args.nocache = true;
const { compressImage } = await import(jampackFile("./compressors/images.js"));
const { compressJS } = await import(jampackFile("./compressors/js.js"));
const cases = [];
const verify = (ok, label) => {
  assert.ok(ok, label);
  cases.push(label);
};

const temporaryFile = createRequire(require.resolve("external-editor"))(
  "tmp"
).fileSync({
  prefix: "astro-security-",
  mode: 0o600,
});
try {
  writeFileSync(temporaryFile.name, "editor fixture");
  verify(
    readFileSync(temporaryFile.name, "utf8") === "editor fixture",
    "the patched temporary-file API remains compatible with the commit editor"
  );
} finally {
  temporaryFile.removeCallback();
}
verify(
  !existsSync(temporaryFile.name),
  "the commit editor's temporary-file API cleans up its owned file"
);

const contentFixture = mkdtempSync(resolve(tmpdir(), "astro-blog-og-"));
try {
  mkdirSync(resolve(contentFixture, "src/content/blog"), { recursive: true });
  mkdirSync(resolve(contentFixture, "src/assets"));
  writeFileSync(
    resolve(contentFixture, "src/content/blog/draft.md"),
    "---\ndraft: true\nogImage: ../../assets/og.png\n---\nDraft fixture\n"
  );
  const imagePath = resolve(contentFixture, "src/assets/og.png");
  await sharp({
    create: { width: 16, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toFile(imagePath);
  await assert.rejects(
    checkContentImages(contentFixture),
    /at least 1200 X 630/
  );
  cases.push(
    "content image validation rejects undersized imported images even on drafts"
  );
  await sharp({
    create: { width: 1200, height: 630, channels: 3, background: "red" },
  })
    .png()
    .toFile(imagePath);
  verify(
    (await checkContentImages(contentFixture)) === 1,
    "content image validation accepts real 1200 by 630 metadata"
  );
} finally {
  rmSync(contentFixture, { recursive: true });
}

const png = await sharp({
  create: { width: 16, height: 8, channels: 4, background: "#e86c2e" },
})
  .png()
  .toBuffer();
const avif = await compressImage(png, {
  toFormat: "avif",
  resize: { width: 8, height: 4 },
});
const decoded = await sharp(avif.data)
  .raw()
  .toBuffer({ resolveWithObject: true });
verify(
  avif.format === "avif" &&
    decoded.info.width === 8 &&
    decoded.info.height === 4,
  "Jampack's patched native image pipeline encodes, resizes and decodes AVIF"
);
verify(
  (await fileTypeFromBuffer(avif.data)).ext === "avif",
  "Jampack detects actual AVIF bytes"
);
await assert.rejects(sharp(Buffer.from("invalid image")).toBuffer());
cases.push("native decoder rejects invalid image bytes");
const svg = await compressImage(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 8"><path fill="red" d="M0 0h16v8H0z"/></svg>'
  ),
  {}
);
verify(
  svg.format === "svg" && svg.data.toString().includes('viewBox="0 0 16 8"'),
  "Jampack's SVG optimizer preserves the viewBox"
);
const compressed = await compressJS("globalThis.answer = (20 + 1) * 2;");
const sandbox = {};
runInNewContext(compressed, sandbox, { timeout: 1000 });
verify(
  sandbox.answer === 42,
  "Jampack's patched esbuild compressor preserves JavaScript behavior"
);

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "image/png" });
  response.end(png);
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
try {
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/fixture.png`,
    { signal: AbortSignal.timeout(5000) }
  );
  verify(
    response.ok && Buffer.from(await response.arrayBuffer()).equals(png),
    "Jampack's patched HTTP client reads actual owned-loopback image bytes"
  );
} finally {
  await new Promise(done => server.close(done));
}

// Run the unchanged production filter/sorter with a fixed clock. This exercises
// draft exclusion, the existing 15-minute margin and modification-date order.
const bundled = await build({
  entryPoints: ["src/utils/getSortedPosts.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "@config": resolve("src/config.ts") },
  define: { "import.meta.env.DEV": "false" },
});
const { default: sortedPosts } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const now = Date.parse("2026-10-24T12:00:00Z");
const originalNow = Date.now;
Date.now = () => now;
try {
  const post = (id, offset, extra = {}) => ({
    id,
    data: { pubDatetime: new Date(now + offset), ...extra },
  });
  const result = sortedPosts([
    post("past", -3600000),
    post("draft", -3600000, { draft: true }),
    post("scheduled", 3600000),
    post("within-margin", 600000),
    post("updated", -7200000, { modDatetime: new Date(now - 1000) }),
  ]);
  verify(
    JSON.stringify(result.map(entry => entry.id)) ===
      JSON.stringify(["within-margin", "updated", "past"]),
    "production collection filtering preserves draft, scheduled margin and modified-date ordering"
  );
} finally {
  Date.now = originalNow;
}

console.log(
  JSON.stringify({
    checks: cases.length,
    failures: 0,
    cases,
    native: sharp.versions,
  })
);
