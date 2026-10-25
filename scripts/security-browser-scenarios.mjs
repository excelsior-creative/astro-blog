import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const routes = JSON.parse(
  readFileSync(new URL("./fixtures/security-routes.json", import.meta.url))
);
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("@divriots/jampack/optimize"))(
  "sharp"
);

export async function checkPage(page, origin, { touch = false } = {}) {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  assert.equal(new URL(origin).port, "43140");
  const cases = [];
  const errors = [];
  const verify = (ok, label) => {
    assert.ok(ok, label);
    cases.push(label);
  };
  const activate = locator => (touch ? locator.tap() : locator.click());
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.context().route("**/*", route => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    // Existing remote editorial media and Google Fonts are outside this
    // owned-loopback test. Never replace application scripts or search results.
    if (
      !["image", "media", "font", "stylesheet"].includes(
        route.request().resourceType()
      )
    ) {
      errors.push(
        `Unexpected external ${route.request().resourceType()}: ${route.request().url()}`
      );
    }
    return route.abort();
  });

  for (const route of routes) {
    const response = await page.goto(origin + route.path);
    verify(response.status() === 200, `${route.path} retains HTTP status`);
    verify(
      (await page.locator('link[rel="canonical"]').getAttribute("href")) ===
        route.canonical,
      `${route.path} retains its canonical URL`
    );
    verify(
      (await page.locator("main h1").innerText()).trim().length > 0 &&
        (await page.locator('a[href*="undefined"]').count()) === 0,
      `${route.path} renders content and valid collection links`
    );
    for (const image of await page.locator('main img[src^="/"]').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(image => image.decode());
      verify(
        await image.evaluate(image => image.naturalWidth > 0),
        `${route.path} local image decodes`
      );
    }
  }

  await page.goto(origin);
  verify(
    (await page.title()) === "AstroPaper",
    "home retains the AstroPaper title"
  );
  if (touch) {
    await activate(
      page.getByRole("button", { name: "Open Menu", exact: true })
    );
    verify(
      (await page
        .getByRole("button", { name: "Close Menu", exact: true })
        .getAttribute("aria-expanded")) === "true",
      "touch menu opens"
    );
  }
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await activate(page.locator("#theme-btn"));
  verify(
    (await page.locator("html").getAttribute("data-theme")) !== initialTheme,
    "theme control changes the actual document theme"
  );
  const chosenTheme = await page.locator("html").getAttribute("data-theme");
  await activate(page.getByRole("link", { name: "search", exact: true }));
  await page.waitForURL(origin + "/search/");
  verify(
    (await page.locator("html").getAttribute("data-theme")) === chosenTheme,
    "client navigation retains the chosen theme"
  );
  await page.locator("astro-island:not([ssr]) input").waitFor();
  const input = page.getByPlaceholder("Search for anything...");
  await input.fill("AstroPaper");
  await page
    .getByText("Found 11 results for 'AstroPaper'", { exact: true })
    .waitFor();
  verify(
    (await page.locator("main ul a").count()) === 11 &&
      new URL(page.url()).searchParams.get("q") === "AstroPaper",
    "real Fuse search returns eleven results and updates the URL"
  );
  await page.reload();
  await page
    .getByText("Found 11 results for 'AstroPaper'", { exact: true })
    .waitFor();
  verify(
    (await input.inputValue()) === "AstroPaper",
    "React search restores the URL query on reload"
  );
  await input.fill("A");
  await page.waitForFunction(
    () => document.querySelectorAll("main ul a").length === 0
  );
  verify(
    (await page.locator("main ul a").count()) === 0,
    "search respects the two-character minimum"
  );
  await input.fill("securitynomatchzzzz");
  await page
    .getByText("Found 0 results for 'securitynomatchzzzz'", { exact: true })
    .waitFor();
  cases.push("real Fuse search renders its empty state");

  await page.goto(origin + "/posts/astro-paper-v4/");
  const socialImage = new URL(
    await page.locator('meta[property="og:image"]').getAttribute("content")
  );
  const socialResponse = await page.request.get(origin + socialImage.pathname);
  const socialMetadata = await sharp(await socialResponse.body()).metadata();
  verify(
    socialResponse.ok() &&
      socialMetadata.width >= 1200 &&
      socialMetadata.height >= 630,
    "frontmatter social-image metadata points to an emitted real image"
  );

  const toc = page.locator("article details").first();
  verify(
    (await toc.count()) === 1 &&
      (await toc.locator("summary").innerText()) === "Open Table of contents",
    "remark plugins retain the collapsed table of contents"
  );
  await activate(toc.locator("summary"));
  verify(
    (await toc.getAttribute("open")) !== null &&
      (await toc.locator('a[href^="#"]').count()) > 0,
    "table of contents expands with real heading links"
  );
  verify(
    (await page.locator('article h2 a.heading-link[href^="#"]').count()) > 0,
    "article heading anchors initialize"
  );
  verify(
    (await page.locator("article pre.astro-code span[style]").count()) > 0,
    "Shiki retains highlighted code tokens"
  );
  verify(
    await page
      .locator("article pre")
      .first()
      .evaluate(pre => getComputedStyle(pre).whiteSpace === "pre-wrap"),
    "legacy code wrapping is preserved"
  );
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const code = await page.locator("article pre code").first().innerText();
  await activate(page.locator("article .copy-code").first());
  await page
    .locator("article .copy-code")
    .first()
    .getByText("Copied", { exact: true })
    .waitFor();
  verify(
    (await page.evaluate(() => navigator.clipboard.readText())) === code,
    "copy control writes actual article code to the clipboard"
  );
  await activate(
    page.getByRole("button", { name: "Back to Top", exact: true })
  );
  await page.waitForFunction(() => scrollY < 5);
  cases.push("article back-to-top control scrolls the document");

  await page.goto(origin + "/posts/");
  await activate(page.getByRole("link", { name: "Next", exact: true }));
  await page.waitForURL(origin + "/posts/2/");
  verify(
    await page
      .getByRole("navigation", { name: "Pagination" })
      .innerText()
      .then(text => text.includes("2 /")),
    "post pagination advances with valid content IDs"
  );
  await page.goto(origin + "/tags/docs/");
  await activate(page.getByRole("link", { name: "Next", exact: true }));
  await page.waitForURL(origin + "/tags/docs/2/");
  cases.push("tag pagination retains the legacy numbered URL");

  for (const path of [
    "/robots.txt",
    "/rss.xml",
    "/sitemap-index.xml",
    "/sitemap-0.xml",
  ]) {
    const response = await page.request.get(origin + path, { maxRedirects: 0 });
    verify(
      response.ok() && (await response.body()).length > 0,
      `${path} remains available`
    );
  }
  const rss = await (await page.request.get(origin + "/rss.xml")).text();
  verify(
    !rss.includes("undefined") && rss.includes("/posts/astro-paper-v4/"),
    "RSS uses the preserved article IDs"
  );
  const images = JSON.parse(
    readFileSync(new URL("./fixtures/security-og-routes.json", import.meta.url))
  );
  verify(
    images.length === 12,
    "all twelve generated OG endpoints remain present"
  );
  for (const path of images) {
    const response = await page.request.get(origin + path);
    const metadata = await sharp(await response.body()).metadata();
    verify(
      response.ok() &&
        metadata.format === "png" &&
        metadata.width === 1200 &&
        metadata.height === 630,
      `${path} serves a real 1200 by 630 PNG`
    );
  }
  verify(
    (await page.goto(origin + "/missing-security-fixture")).status() === 404,
    "unknown URLs retain the 404 response"
  );
  assert.deepEqual(
    errors,
    [],
    "No browser exceptions or unexpected external data requests"
  );
  cases.push(
    "no page exceptions or unexpected external executable/data requests"
  );
  return {
    checks: cases.length,
    failures: 0,
    mode: touch ? "mobile touch" : "desktop",
    transport: "owned-loopback; remote editorial media and fonts excluded",
    cases,
  };
}
