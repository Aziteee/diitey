import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileSiteProgram } from "../src/publication/site-program.ts";

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

describe("configurable content directory", () => {
  test("site program defaults contentRoot to site root content/", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    const program = await compileSiteProgram(siteRoot);
    expect(program.contentRoot).toBe(await realpath(resolve(siteRoot, "content")));
  });

  test("site program resolves relative contentDir under the site root", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    await rename(join(siteRoot, "content"), join(siteRoot, "notes"));
    await writeSiteConfig(siteRoot, { contentDir: "notes" });

    const program = await compileSiteProgram(siteRoot);
    expect(program.contentRoot).toBe(await realpath(resolve(siteRoot, "notes")));
  });

  test("site program accepts an absolute contentDir outside the site root", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    const outer = await mkdtemp(join(import.meta.dir, "fixtures", ".content-dir-outer-"));
    temporaryRoots.push(outer);
    await rename(join(siteRoot, "content"), join(outer, "library"));
    await writeSiteConfig(siteRoot, { contentDir: join(outer, "library") });

    const program = await compileSiteProgram(siteRoot);
    expect(program.contentRoot).toBe(await realpath(resolve(outer, "library")));
  });

  test("site program resolves a contentDir symlink to its real path", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    const outer = await mkdtemp(join(import.meta.dir, "fixtures", ".content-dir-outer-"));
    temporaryRoots.push(outer);
    const realLibrary = join(outer, "library");
    await rename(join(siteRoot, "content"), realLibrary);
    await symlink(realLibrary, join(siteRoot, "content-link"));
    await writeSiteConfig(siteRoot, { contentDir: "content-link" });

    const program = await compileSiteProgram(siteRoot);
    expect(program.contentRoot).toBe(await realpath(realLibrary));
  });

  test("site program rejects a missing content directory path", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    await writeSiteConfig(siteRoot, { contentDir: "missing-content" });

    await expect(compileSiteProgram(siteRoot)).rejects.toThrow(
      /content directory|contentDir/i,
    );
  });

  test("site owner can publish content from a contentDir outside the site root", async () => {
    const siteRoot = await copyFixtureSite();
    await writeMinimalTheme(siteRoot);
    const outer = await mkdtemp(join(import.meta.dir, "fixtures", ".content-dir-outer-"));
    temporaryRoots.push(outer);
    const contentRoot = join(outer, "library");
    await rename(join(siteRoot, "content"), contentRoot);
    await writeSiteConfig(siteRoot, { contentDir: contentRoot });

    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<h1>");
  }, 15_000);
});

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".content-directory-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, { recursive: true });
  await writeSiteConfig(root, { theme: "./themes/minimal/theme.ts" });
  return root;
}

async function writeSiteConfig(
  siteRoot: string,
  options: {
    readonly contentDir?: string;
    readonly theme?: string;
  } = {},
): Promise<void> {
  const lines = [
    "export default {",
    `  theme: ${JSON.stringify(options.theme ?? "./themes/minimal/theme.ts")},`,
  ];
  if (options.contentDir !== undefined) {
    lines.push(`  contentDir: ${JSON.stringify(options.contentDir)},`);
  }
  lines.push("};", "");
  await writeFile(join(siteRoot, "site.config.ts"), lines.join("\n"));
}

async function writeMinimalTheme(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

export default defineTheme({
  collections: {
    writing: collection({ from: "*.md", schema: { title: "string" } }),
  },
  routes: [
    route("/writing/:slug", page("article", {
      item: { collection: "writing", match: ":slug.md" },
    })),
  ],
});
`,
  );
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
