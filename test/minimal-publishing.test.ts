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

describe("minimal publishing loop", () => {
  test("site owner can publish one content file at the theme's fixed URL", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);

    const address = await readServerAddress(process);
    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Hello, Diitey</title>");
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).toContain("<p>This page came from a Markdown content file.</p>");
    expect(html).toContain("<h2>What this fixture covers</h2>");
    expect(html).toContain("<strong>Markdown</strong>");
    expect(html).toContain("</html>");
  });

  test("theme collection filters drafts and sorts equal dates by content ID", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const firstPage = await fetch(`${address}/writing`).then((response) =>
      response.text(),
    );
    const secondPage = await fetch(`${address}/writing?page=2`).then((response) =>
      response.text(),
    );

    const alphaPosition = firstPage.indexOf("Alpha article");
    const zetaPosition = firstPage.indexOf("Zeta article");
    expect(alphaPosition).toBeGreaterThan(-1);
    expect(zetaPosition).toBeGreaterThan(alphaPosition);
    expect(firstPage).toContain('href="/writing/2025/alpha"');
    expect(firstPage).toContain('href="/writing/2026/zeta"');
    expect(firstPage).not.toContain("Draft article");
    expect(secondPage).toContain("<ol></ol>");
  });

  test("theme publishes nested content routes and excludes filtered drafts", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const article = await fetch(`${address}/writing/2025/alpha`);
    const html = await article.text();
    const draft = await fetch(`${address}/writing/2026/draft`);

    expect(article.status).toBe(200);
    expect(html).toContain("<h1>Alpha article</h1>");
    expect(html).toContain("<p>Alpha is published from a nested content path.</p>");
    expect(draft.status).toBe(404);
  });

  test("site owner can load an installed theme package and its manually managed dependency", async () => {
    const siteRoot = await copyFixtureSite();
    const themeRoot = join(siteRoot, "node_modules", "@fixture", "theme");
    const helperRoot = join(
      siteRoot,
      "node_modules",
      "@fixture",
      "theme-helper",
    );
    await mkdir(join(themeRoot, "pages"), { recursive: true });
    await mkdir(helperRoot, { recursive: true });
    await writeFile(
      join(themeRoot, "package.json"),
      JSON.stringify({
        name: "@fixture/theme",
        version: "1.0.0",
        type: "module",
        exports: "./theme.ts",
      }),
    );
    await writeFile(
      join(helperRoot, "package.json"),
      JSON.stringify({
        name: "@fixture/theme-helper",
        version: "1.0.0",
        type: "module",
        exports: "./index.ts",
      }),
    );
    await writeFile(
      join(helperRoot, "index.ts"),
      `export const decorate = (value: string) => \`Package: \${value}\`;\n`,
    );
    await writeFile(
      join(themeRoot, "theme.ts"),
      `export default {
        collections: {
          writing: { from: "hello.md", schema: { title: "string" } },
        },
        routes: [{
          path: "/package-theme",
          canonical: false,
          page: {
            name: "article",
            data: { item: { collection: "writing", match: "hello.md" } },
          },
        }],
      };\n`,
    );
    await writeFile(
      join(themeRoot, "pages", "article.tsx"),
      `import { decorate } from "@fixture/theme-helper";
      export default function Article({ item }: { item: { attributes: Record<string, unknown> } }) {
        return <h1>{decorate(String(item.attributes.title))}</h1>;
      }\n`,
    );
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({ theme: "@fixture/theme" });\n`,
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);
    const html = await fetch(`${address}/package-theme`).then((response) =>
      response.text(),
    );

    expect(html).toContain("<h1>Package: Hello, Diitey</h1>");
  }, 10_000);

  test("site owner cannot start a site whose content ID is not a YAML string", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---\nid: 123\ncreated: "2026-07-12"\ntitle: "Invalid content"\n---\n\nBody.\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("id must be a non-empty YAML string");
  });

  test("site owner cannot start a site whose created date is invalid", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---\nid: "invalid-date"\ncreated: "2026-02-30"\ntitle: "Invalid content"\n---\n\nBody.\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("created must be a valid ISO 8601 date or datetime");
  });
});

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

async function waitForStartFailure(
  process: SiteProcess,
): Promise<{ exitCode: number | null; error: string }> {
  const exitCode = await Promise.race([
    process.exited,
    Bun.sleep(1_000).then(() => null),
  ]);
  if (exitCode === null) {
    process.kill();
    await process.exited;
  }

  return {
    exitCode,
    error: await new Response(process.stderr).text(),
  };
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".tmp-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
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
    const match = output.match(/Listening on (http:\/\/[^\s]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
}
