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

describe("theme not-found route", () => {
  test("unknown path without * route stays plain Not Found", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/does-not-exist`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toBe("Not Found");
  }, 10_000);

  test("route * renders theme page with status 404 and document chrome", async () => {
    const siteRoot = await copyFixtureSite();
    await writeNotFoundPage(siteRoot);
    await appendNotFoundRoute(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/does-not-exist`);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('data-not-found="true"');
    expect(html).toContain("Theme Not Found");
    expect(html).toContain('data-document-chrome="site-nav"');
    expect(html).toContain("<!doctype html>");
  }, 10_000);

  test("matched routes still return 200 when * is declared", async () => {
    const siteRoot = await copyFixtureSite();
    await writeNotFoundPage(siteRoot);
    await appendNotFoundRoute(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).not.toContain('data-not-found="true"');
  }, 10_000);

  test("missing content asset stays plain Not Found", async () => {
    const siteRoot = await copyFixtureSite();
    await writeNotFoundPage(siteRoot);
    await appendNotFoundRoute(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/assets/content/missing.bin`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toBe("Not Found");
  }, 10_000);
});

async function writeNotFoundPage(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "not-found.tsx"),
    `export default function NotFound() {
      return (
        <main data-not-found="true">
          <h1>Theme Not Found</h1>
        </main>
      );
    }
    `,
  );
}

async function appendNotFoundRoute(siteRoot: string): Promise<void> {
  const themePath = join(siteRoot, "themes", "minimal", "theme.ts");
  const themeSource = await Bun.file(themePath).text();
  const updated = themeSource.replace(
    `route(
          "/todos",
          page("todo-list", {
            items: { service: "todo.list", input: {} },
          }),
        ),
      ],`,
    `route(
          "/todos",
          page("todo-list", {
            items: { service: "todo.list", input: {} },
          }),
        ),
        route("*", page("not-found", {})),
      ],`,
  );
  if (updated === themeSource) {
    throw new Error("failed to inject not-found route into theme fixture");
  }
  await writeFile(themePath, updated);
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".not-found-"));
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
    const match = output.match(/Listening on (https?:\/\/[^\s"]+)/);
    if (match?.[1]) return match[1];
  }
}
