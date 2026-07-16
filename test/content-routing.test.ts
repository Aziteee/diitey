import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

const processes: SiteProcess[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const process of processes) {
    process.kill();
  }
  await Promise.all(processes.splice(0).map((process) => process.exited));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("complete content and routing model", () => {
  test("site owner can publish nested content through a mapped route", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "content", "hello.md"));
    await writeContent(siteRoot, "articles/2026/nested.md", {
      id: "nested-content",
      created: "2026-07-12",
      title: "Nested content",
    });
    await writeTheme(
      siteRoot,
      `export default defineTheme({
        collections: {
          writing: collection({
            from: "articles/*/*.md",
            schema: { title: "string" },
          }),
        },
        routes: [
          route("/writing/:year/:slug", page("article", {
            item: { collection: "writing", match: "articles/:year/:slug.md" },
          })),
        ],
      });`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/writing/2026/nested`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<h1>Nested content</h1>");
  }, 10_000);

  test("site owner cannot publish content files with duplicate content IDs", async () => {
    const siteRoot = await copyFixtureSite();
    await writeContent(siteRoot, "duplicate.md", {
      id: "hello-content",
      created: "2026-07-13",
      title: "Duplicate identity",
    });
    await writeTheme(
      siteRoot,
      `export default defineTheme({
        collections: {
          writing: collection({ from: "*.md", schema: { title: "string" } }),
        },
        routes: [
          route("/writing/:slug", page("article", {
            item: { collection: "writing", match: ":slug.md" },
          })),
        ],
      });`,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain("Duplicate content ID hello-content");
    expect(error).toContain("duplicate.md");
    expect(error).toContain("hello.md");
  }, 10_000);

  test("site owner cannot publish two content records at the same URL", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "content", "hello.md"));
    await writeContent(siteRoot, "articles/first/shared.md", {
      id: "first-shared",
      created: "2026-07-12",
      title: "First",
    });
    await writeContent(siteRoot, "articles/second/shared.md", {
      id: "second-shared",
      created: "2026-07-13",
      title: "Second",
    });
    await writeTheme(
      siteRoot,
      `export default defineTheme({
        collections: {
          writing: collection({ from: "articles/*/*.md", schema: { title: "string" } }),
        },
        routes: [
          route("/writing/:slug", page("article", {
            item: { collection: "writing", match: "articles/:folder/:slug.md" },
          })),
        ],
      });`,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain("Duplicate URL /writing/shared");
    expect(error).toContain("articles/first/shared.md");
    expect(error).toContain("articles/second/shared.md");
  }, 10_000);

  test("paginated collection routes return stable pages and reject invalid page values", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "content", "hello.md"));
    for (const [id, created] of [["first", "2026-07-12"], ["second", "2026-07-13"], ["third", "2026-07-14"]]) {
      await writeContent(siteRoot, `articles/${id}.md`, { id, created, title: id });
    }
    await writePage(
      siteRoot,
      "list",
      `import type { ContentRecord } from "../../../../../../src/index.ts";
      export default function List({ items }: { items: readonly ContentRecord[] }) {
        return <p>{items.map((item) => item.id).join(",")}</p>;
      }`,
    );
    await writeTheme(
      siteRoot,
      `export default defineTheme({
        collections: {
          writing: collection({
            from: "articles/*.md",
            orderBy: [{ field: "created", direction: "asc" }],
            schema: { title: "string" },
          }),
        },
        routes: [route("/writing", page("list", {
          items: { collection: "writing", paginate: 2 },
        }))],
      });`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const [first, second, beyond, invalid] = await Promise.all([
      fetch(`${address}/writing`).then(async (response) => ({ status: response.status, html: await response.text() })),
      fetch(`${address}/writing?page=2`).then(async (response) => ({ status: response.status, html: await response.text() })),
      fetch(`${address}/writing?page=9`).then(async (response) => ({ status: response.status, html: await response.text() })),
      fetch(`${address}/writing?page=zero`).then(async (response) => ({ status: response.status, html: await response.text() })),
    ]);

    expect(first.status).toBe(200);
    expect(first.html).toContain("<p>first,second</p>");
    expect(second.html).toContain("<p>third</p>");
    expect(beyond.html).toContain("<p></p>");
    expect(invalid.status).toBe(400);
  }, 10_000);

  test("a theme can publish collection and content routes with canonical item URLs", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "content", "hello.md"));
    await writeContent(siteRoot, "articles/hello.md", {
      id: "hello",
      created: "2026-07-12",
      title: "Hello routes",
    });
    await writePage(
      siteRoot,
      "list",
      `import type { ContentRecord } from "../../../../../../src/index.ts";
      export default function List({ items }: { items: readonly ContentRecord[] }) {
        return <a href={items[0]?.url}>{items[0]?.attributes.title as string}</a>;
      }`,
    );
    await writeTheme(
      siteRoot,
      `export default defineTheme({
        collections: {
          writing: collection({ from: "articles/*.md", schema: { title: "string" } }),
        },
        routes: [
          route("/writing", page("list", { items: { collection: "writing" } })),
          route("/writing/:slug", page("article", {
            item: { collection: "writing", match: "articles/:slug.md" },
          })),
        ],
      });`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const [list, article] = await Promise.all([
      fetch(`${address}/writing`).then(async (response) => ({ status: response.status, html: await response.text() })),
      fetch(`${address}/writing/hello`).then(async (response) => ({ status: response.status, html: await response.text() })),
    ]);

    expect(list.html).toContain('<a href="/writing/hello">Hello routes</a>');
    expect(article.status).toBe(200);
    expect(article.html).toContain("<h1>Hello routes</h1>");
  }, 10_000);

});

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".content-routing-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, { recursive: true });
  await writeFile(
    join(root, "site.config.ts"),
    `export default { theme: "./themes/minimal/theme.ts" };\n`,
  );
  return root;
}

async function writeContent(
  siteRoot: string,
  sourcePath: string,
  attributes: Record<string, unknown>,
  body = "Body.",
): Promise<void> {
  const filePath = join(siteRoot, "content", ...sourcePath.split("/"));
  await mkdir(join(filePath, ".."), { recursive: true });
  const yaml = Object.entries(attributes)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  await writeFile(filePath, `---\n${yaml}\n---\n\n${body}\n`);
}

async function writeTheme(siteRoot: string, definition: string): Promise<void> {
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";\n\n${definition}\n`,
  );
}

async function writePage(siteRoot: string, name: string, source: string): Promise<void> {
  await writeFile(join(siteRoot, "themes", "minimal", "pages", `${name}.tsx`), source);
}

function spawnSite(siteRoot: string): SiteProcess {
  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      join(import.meta.dir, "..", "index.ts"),
      "start",
      "--root",
      siteRoot,
      "--port",
      "0",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  processes.push(process);
  return process;
}

async function readServerAddress(process: SiteProcess): Promise<string> {
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      const error = await new Response(process.stderr).text();
      throw new Error(`Server exited before listening.\n${output}${error}`);
    }
    output += decoder.decode(result.value, { stream: true });
    const match = output.match(/Listening on (https?:\/\/[^\s"]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
}

async function readStartupError(process: SiteProcess): Promise<string> {
  const [exitCode, error] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  expect(exitCode).not.toBe(0);
  return error;
}
