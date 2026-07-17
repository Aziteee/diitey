import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContentSnapshot } from "../src/publication/content-snapshot.ts";
import {
  collectContentResourceCache,
  contentResourceCacheRoot,
} from "../src/publication/content-resources.ts";
import { openPublication } from "../src/publication/runtime.ts";
import { compileSiteProgram } from "../src/publication/site-program.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

test("a content snapshot rewrites used native Markdown resources and records their immutable routes", async () => {
  const siteRoot = await copyFixtureSite();
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "asset-post.md"),
    `---
id: "asset-post"
created: "2026-07-17"
title: "Assets"
---

![Photo](./summer%20photo.png?size=large#preview)

[Guide][download]

[download]: ../shared/guide.pdf
[unused]: ./unused.txt
`,
  );
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "summer photo.png"),
    "picture bytes",
  );
  await mkdir(join(siteRoot, "content", "articles", "shared"), {
    recursive: true,
  });
  await writeFile(
    join(siteRoot, "content", "articles", "shared", "guide.pdf"),
    "guide bytes",
  );
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "unused.txt"),
    "not published",
  );

  const snapshot = await buildContentSnapshot(await compileSiteProgram(siteRoot));
  const record = snapshot.byId.get("asset-post");

  expect(record?.html).toMatch(
    /<img src="\/assets\/content\/[a-f0-9]{64}\/summer%20photo\.png\?size=large#preview" alt="Photo">/,
  );
  expect(record?.html).toMatch(
    /<a href="\/assets\/content\/[a-f0-9]{64}\/guide\.pdf">Guide<\/a>/,
  );
  expect(snapshot.resources).toHaveLength(2);
  expect(
    snapshot.resources.some((resource) =>
      resource.publicPath.startsWith("/assets/content/") &&
      resource.publicPath.endsWith("/summer%20photo.png"),
    ),
  ).toBe(true);
  expect(
    snapshot.resources.some((resource) => resource.publicPath.endsWith("/guide.pdf")),
  ).toBe(true);
});

test("a used duplicate reference definition keeps Markdown's first destination and media type", async () => {
  const siteRoot = await copyFixtureSite();
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "duplicate-reference.md"),
    `---
id: "duplicate-reference"
created: "2026-07-17"
title: "Duplicate reference"
---

[Track][audio]

[audio]: ./first.mp3
[audio]: ./second.mp3
`,
  );
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "first.mp3"),
    "first track",
  );
  await writeFile(
    join(siteRoot, "content", "articles", "2026", "second.mp3"),
    "second track",
  );

  const snapshot = await buildContentSnapshot(await compileSiteProgram(siteRoot));
  const record = snapshot.byId.get("duplicate-reference");

  expect(record?.html).toMatch(
    /<a href="\/assets\/content\/[a-f0-9]{64}\/first\.mp3">Track<\/a>/,
  );
  expect(snapshot.resources).toHaveLength(1);
  expect(snapshot.resources[0]?.publicPath).toMatch(/\/first\.mp3$/);
  expect(snapshot.resources[0]?.mediaType).toBe("audio/mpeg");
});

test("the publication runtime serves only indexed content resources with immutable metadata", async () => {
  const siteRoot = await copyFixtureSite();
  await writeFile(
    join(siteRoot, "content", "hello.md"),
    `---
id: "hello-content"
created: "2026-07-12"
title: "Hello, Diitey"
---

![Logo](./logo.png)
`,
  );
  await writeFile(join(siteRoot, "content", "logo.png"), "logo bytes");
  await writeFile(join(siteRoot, "content", "unpublished.png"), "private");

  const publication = await openPublication({ root: siteRoot });
  try {
    const page = await publication.handle(
      new Request("http://example.test/writing/hello"),
    );
    const html = await page.text();
    const assetPath = html.match(/\/assets\/content\/[a-f0-9]{64}\/logo\.png/)?.[0];
    if (!assetPath) throw new Error("expected the rendered content asset URL");

    const [get, head, methodNotAllowed, unpublished] = await Promise.all([
      publication.handle(new Request(`http://example.test${assetPath}`)),
      publication.handle(new Request(`http://example.test${assetPath}`, { method: "HEAD" })),
      publication.handle(new Request(`http://example.test${assetPath}`, { method: "POST" })),
      publication.handle(
        new Request(
          "http://example.test/assets/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/unpublished.png",
        ),
      ),
    ]);

    expect(get.status).toBe(200);
    expect(await get.text()).toBe("logo bytes");
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("content-length")).toBe("10");
    expect(get.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(get.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(methodNotAllowed.status).toBe(405);
    expect(methodNotAllowed.headers.get("allow")).toBe("GET, HEAD");
    expect(unpublished.status).toBe(404);
  } finally {
    await publication.close();
  }
});

test("content resource changes become public only after a successful reload", async () => {
  const siteRoot = await copyFixtureSite();
  const contentPath = join(siteRoot, "content", "hello.md");
  const assetPath = join(siteRoot, "content", "logo.png");
  await writeFile(
    contentPath,
    `---
id: "hello-content"
created: "2026-07-12"
title: "Hello, Diitey"
---

![Logo](./logo.png)
`,
  );
  await writeFile(assetPath, "first logo");

  const publication = await openPublication({ root: siteRoot });
  try {
    const firstPath = await contentAssetPath(publication);
    expect(
      await publication
        .handle(new Request(`http://example.test${firstPath}`))
        .then((response) => response.text()),
    ).toBe("first logo");

    await writeFile(assetPath, "second logo");
    expect(await contentAssetPath(publication)).toBe(firstPath);
    expect(
      await publication
        .handle(new Request(`http://example.test${firstPath}`))
        .then((response) => response.text()),
    ).toBe("first logo");

    const reloaded = await publication.reload();
    expect(reloaded.status).toBe("succeeded");
    const secondPath = await contentAssetPath(publication);
    expect(secondPath).not.toBe(firstPath);
    expect(
      await publication
        .handle(new Request(`http://example.test${secondPath}`))
        .then((response) => response.text()),
    ).toBe("second logo");
    expect(
      (
        await publication.handle(new Request(`http://example.test${firstPath}`))
      ).status,
    ).toBe(404);

    await writeFile(
      contentPath,
      `---
id: 123
created: "2026-07-12"
title: "Broken"
---

![Logo](./logo.png)
`,
    );
    await writeFile(assetPath, "third logo");
    expect((await publication.reload()).status).toBe("failed");
    expect(await contentAssetPath(publication)).toBe(secondPath);
    expect(
      await publication
        .handle(new Request(`http://example.test${secondPath}`))
        .then((response) => response.text()),
    ).toBe("second logo");
  } finally {
    await publication.close();
  }
});

test("content resource cache collection keeps current and young artifacts", async () => {
  const siteRoot = await copyFixtureSite();
  const cacheRoot = contentResourceCacheRoot(siteRoot);
  await mkdir(cacheRoot, { recursive: true });
  const marked = "a".repeat(64);
  const oldOrphan = "b".repeat(64);
  const youngOrphan = "c".repeat(64);
  const temporary = ".tmp-00000000-0000-4000-8000-000000000000";
  const now = Date.now();
  for (const name of [marked, oldOrphan, youngOrphan, temporary]) {
    await writeFile(join(cacheRoot, name), name);
  }
  await Promise.all([
    utimes(join(cacheRoot, marked), new Date(now - 172_800_000), new Date(now - 172_800_000)),
    utimes(join(cacheRoot, oldOrphan), new Date(now - 172_800_000), new Date(now - 172_800_000)),
    utimes(join(cacheRoot, temporary), new Date(now - 172_800_000), new Date(now - 172_800_000)),
  ]);

  await collectContentResourceCache({
    cacheRoot,
    referencedDigests: new Set([marked]),
    now,
  });

  expect(await Bun.file(join(cacheRoot, marked)).exists()).toBe(true);
  expect(await Bun.file(join(cacheRoot, youngOrphan)).exists()).toBe(true);
  expect(await Bun.file(join(cacheRoot, oldOrphan)).exists()).toBe(false);
  expect(await Bun.file(join(cacheRoot, temporary)).exists()).toBe(false);
});

async function contentAssetPath(
  publication: Awaited<ReturnType<typeof openPublication>>,
): Promise<string> {
  const response = await publication.handle(
    new Request("http://example.test/writing/hello"),
  );
  const html = await response.text();
  const assetPath = html.match(/\/assets\/content\/[a-f0-9]{64}\/logo\.png/)?.[0];
  if (!assetPath) throw new Error("expected the rendered content asset URL");
  return assetPath;
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".content-assets-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  await writeFile(
    join(root, "site.config.ts"),
    `export default {
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/todo-list/plugin.ts"],
};\n`,
  );
  return root;
}
