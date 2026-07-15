import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("theme document layout", () => {
  test("theme without document keeps the core fallback shell", async () => {
    const siteRoot = await copyFixtureSite();
    const themeSource = await Bun.file(
      join(siteRoot, "themes", "minimal", "theme.ts"),
    ).text();
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      themeSource.replace(/\s*document:\s*"document",\s*/, "\n      "),
    );
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Hello, Diitey</title>");
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).not.toContain('data-document-chrome="site-nav"');
  }, 10_000);

  test("document owns head chrome title and wraps page content", async () => {
    const siteRoot = await copyFixtureSite();
    await writeDocumentFixture(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toMatch(/<meta name="theme-document" content="on"\s*\/?>/);
    expect(html).toContain("<style>.document-shell{color:rebeccapurple}</style>");
    expect(html).toContain('data-document-chrome="site-nav"');
    expect(html).toContain("Document Shell Nav");
    expect(html).toContain("<title>Hello, Diitey · Diitey Minimal Site</title>");
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).toContain("data-site-name");
    expect(html).not.toMatch(
      /<meta charset="utf-8"><title>Hello, Diitey<\/title>/,
    );
  }, 10_000);

  test("render failure under document still returns the standard 500 page", async () => {
    const siteRoot = await copyFixtureSite();
    await writeDocumentFixture(siteRoot);
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "todo-list.tsx"),
      `export default function BrokenTodoList() {
        throw new Error("document render secret");
      }
      `,
    );
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/todos`);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Page rendering failed");
    expect(body).not.toContain("document render secret");
    expect(body).not.toContain('data-document-chrome="site-nav"');
  }, 10_000);
});

async function writeDocumentFixture(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "document.tsx"),
    `import type { ComponentChildren } from "preact";
    import { useThemeConfig } from "diitey";
    import type { MinimalThemeConfig } from "../theme.ts";

    export default function Document({
      title,
      children,
    }: {
      title: string;
      children: ComponentChildren;
    }) {
      const config = useThemeConfig<MinimalThemeConfig>();
      return (
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="theme-document" content="on" />
            <title>{title} · {config.siteName}</title>
            <style>{".document-shell{color:rebeccapurple}"}</style>
          </head>
          <body class="document-shell">
            <nav data-document-chrome="site-nav">Document Shell Nav</nav>
            {children}
          </body>
        </html>
      );
    }
    `,
  );

}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".document-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
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
    const match = output.match(/Listening on (http:\/\/[^\s]+)/);
    if (match?.[1]) return match[1];
  }
}
