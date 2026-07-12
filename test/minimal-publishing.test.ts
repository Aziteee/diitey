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
  processes.length = 0;
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("minimal publishing loop", () => {
  test("site owner can publish one content file at the theme's fixed URL", async () => {
    const siteRoot = join(import.meta.dir, "fixtures", "minimal-site");
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
    expect(html).toContain("</html>");
  });

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
