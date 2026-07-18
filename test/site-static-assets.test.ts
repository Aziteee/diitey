import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPublication } from "../src/publication/runtime.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

test("site static assets are served at root-mirrored stable paths with negotiable cache", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public"), { recursive: true });
  await writeFile(join(siteRoot, "public", "robots.txt"), "User-agent: *\nDisallow:\n");
  await writeFile(join(siteRoot, "public", "favicon.ico"), "icon-bytes");

  const publication = await openPublication({ root: siteRoot });
  try {
    const robots = await publication.handle(
      new Request("http://example.test/robots.txt"),
    );
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe("User-agent: *\nDisallow:\n");
    expect(robots.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(robots.headers.get("etag")).toMatch(/^W\/".+"$/);
    expect(robots.headers.get("last-modified")).toBeTruthy();
    expect(robots.headers.get("content-type")).toMatch(/text\/plain/);

    const head = await publication.handle(
      new Request("http://example.test/robots.txt", { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(robots.headers.get("etag"));

    const favicon = await publication.handle(
      new Request("http://example.test/favicon.ico"),
    );
    expect(favicon.status).toBe(200);
    expect(await favicon.text()).toBe("icon-bytes");
  } finally {
    await publication.close();
  }
});

test("missing public directory serves no site static assets", async () => {
  const siteRoot = await copyFixtureSite();
  const publication = await openPublication({ root: siteRoot });
  try {
    const response = await publication.handle(
      new Request("http://example.test/robots.txt"),
    );
    expect(response.status).toBe(404);
  } finally {
    await publication.close();
  }
});

test("site static asset changes are visible without reload", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public"), { recursive: true });
  const path = join(siteRoot, "public", "note.txt");
  await writeFile(path, "first");

  const publication = await openPublication({ root: siteRoot });
  try {
    expect(
      await (
        await publication.handle(new Request("http://example.test/note.txt"))
      ).text(),
    ).toBe("first");

    await writeFile(path, "second");
    expect(
      await (
        await publication.handle(new Request("http://example.test/note.txt"))
      ).text(),
    ).toBe("second");
  } finally {
    await publication.close();
  }
});

test("theme routes and reserved paths win over site static assets", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public", "writing"), { recursive: true });
  await writeFile(join(siteRoot, "public", "writing", "hello"), "from-public");
  await mkdir(join(siteRoot, "public", "assets", "theme"), { recursive: true });
  await writeFile(
    join(siteRoot, "public", "assets", "theme", "styles-fake.css"),
    "from-public",
  );
  await mkdir(join(siteRoot, "public", "_admin"), { recursive: true });
  await writeFile(join(siteRoot, "public", "_admin", "x.txt"), "from-public");

  const publication = await openPublication({ root: siteRoot });
  try {
    const page = await publication.handle(
      new Request("http://example.test/writing/hello"),
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toBe("from-public");
    expect(html).toContain("<!doctype html>");

    const themePost = await publication.handle(
      new Request("http://example.test/writing/hello", { method: "POST" }),
    );
    expect(themePost.status).toBe(405);
    expect(themePost.headers.get("allow")).toBeNull();

    const reserved = await publication.handle(
      new Request("http://example.test/assets/theme/styles-fake.css"),
    );
    expect(reserved.status).toBe(404);

    const reservedHead = await publication.handle(
      new Request("http://example.test/assets/theme/styles-fake.css", {
        method: "HEAD",
      }),
    );
    expect(reservedHead.status).toBe(404);

    const admin = await publication.handle(
      new Request("http://example.test/_admin/x.txt"),
    );
    expect(admin.status).not.toBe(200);
    expect(await admin.text()).not.toBe("from-public");
  } finally {
    await publication.close();
  }
});

test("only exact files are served; no index or directory listing", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public", "docs"), { recursive: true });
  await writeFile(join(siteRoot, "public", "docs", "index.html"), "<p>docs</p>");

  const publication = await openPublication({ root: siteRoot });
  try {
    const exact = await publication.handle(
      new Request("http://example.test/docs/index.html"),
    );
    expect(exact.status).toBe(200);
    expect(await exact.text()).toBe("<p>docs</p>");

    const bare = await publication.handle(
      new Request("http://example.test/docs"),
    );
    expect(bare.status).toBe(404);

    const slash = await publication.handle(
      new Request("http://example.test/docs/"),
    );
    expect(slash.status).toBe(404);
  } finally {
    await publication.close();
  }
});

test("dotfiles are hidden except under .well-known", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public", ".well-known"), { recursive: true });
  await writeFile(
    join(siteRoot, "public", ".well-known", "security.txt"),
    "Contact: me@example.test\n",
  );
  await writeFile(join(siteRoot, "public", ".secret"), "nope");
  await mkdir(join(siteRoot, "public", "nested"), { recursive: true });
  await writeFile(join(siteRoot, "public", "nested", ".env"), "nope");

  const publication = await openPublication({ root: siteRoot });
  try {
    const wellKnown = await publication.handle(
      new Request("http://example.test/.well-known/security.txt"),
    );
    expect(wellKnown.status).toBe(200);
    expect(await wellKnown.text()).toBe("Contact: me@example.test\n");

    expect(
      (
        await publication.handle(
          new Request("http://example.test/.secret"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await publication.handle(
          new Request("http://example.test/nested/.env"),
        )
      ).status,
    ).toBe(404);
  } finally {
    await publication.close();
  }
});

test("path escape and symlink escape resolve as not found", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public"), { recursive: true });
  await writeFile(join(siteRoot, "secret-outside.txt"), "outside");
  await symlink(
    join(siteRoot, "secret-outside.txt"),
    join(siteRoot, "public", "escape.txt"),
  );

  const publication = await openPublication({ root: siteRoot });
  try {
    expect(
      (
        await publication.handle(
          new Request("http://example.test/../secret-outside.txt"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await publication.handle(
          new Request("http://example.test/escape.txt"),
        )
      ).status,
    ).toBe(404);
  } finally {
    await publication.close();
  }
});

test("non-GET/HEAD methods on a site static asset return 405", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public"), { recursive: true });
  await writeFile(join(siteRoot, "public", "ping.txt"), "pong");

  const publication = await openPublication({ root: siteRoot });
  try {
    const response = await publication.handle(
      new Request("http://example.test/ping.txt", { method: "POST" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  } finally {
    await publication.close();
  }
});

test("If-None-Match returns 304 when etag matches", async () => {
  const siteRoot = await copyFixtureSite();
  await mkdir(join(siteRoot, "public"), { recursive: true });
  await writeFile(join(siteRoot, "public", "etag.txt"), "body");

  const publication = await openPublication({ root: siteRoot });
  try {
    const first = await publication.handle(
      new Request("http://example.test/etag.txt"),
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = await publication.handle(
      new Request("http://example.test/etag.txt", {
        headers: { "if-none-match": etag! },
      }),
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  } finally {
    await publication.close();
  }
});

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".site-static-"));
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
