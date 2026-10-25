import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve("astro/config"))("js-yaml");
const sharp = createRequire(require.resolve("@divriots/jampack/optimize"))(
  "sharp"
);

export async function checkContentImages(root = process.cwd()) {
  const base = resolve(root, "src/content/blog");
  let checked = 0;
  for (const name of readdirSync(base, { recursive: true })) {
    if (!name.endsWith(".md")) continue;
    const file = resolve(base, name);
    const frontmatter = readFileSync(file, "utf8").match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
    );
    assert.ok(frontmatter, `Missing frontmatter: ${name}`);
    const image = load(frontmatter[1]).ogImage;
    // Public paths and remote URLs remain strings. Only imported relative
    // images had the original schema's 1200 by 630 metadata constraint.
    if (
      typeof image !== "string" ||
      /^(?:\/|[a-z][a-z0-9+.-]*:|$)/i.test(image)
    )
      continue;
    const path = resolve(dirname(file), image);
    assert.ok(
      path.startsWith(resolve(root, "src") + sep),
      `Image must remain inside src: ${name}`
    );
    const metadata = await sharp(path).metadata();
    assert.ok(
      metadata.width >= 1200 && metadata.height >= 630,
      `OpenGraph image must be at least 1200 X 630 pixels: ${name}`
    );
    checked++;
  }
  return checked;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    `PASS: ${await checkContentImages()} imported content OG images meet the dimension constraint (including draft entries)`
  );
}
