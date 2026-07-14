import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(html).toContain("Diitey Minimal Site");
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
    const thirdPage = await fetch(`${address}/writing?page=3`).then((response) =>
      response.text(),
    );

    const alphaPosition = firstPage.indexOf("Alpha article");
    const zetaPosition = firstPage.indexOf("Zeta article");
    expect(alphaPosition).toBeGreaterThan(-1);
    expect(zetaPosition).toBeGreaterThan(alphaPosition);
    expect(firstPage).toContain('href="/writing/2025/alpha"');
    expect(firstPage).toContain('href="/writing/2026/zeta"');
    expect(firstPage).not.toContain("Beta article");
    expect(firstPage).not.toContain("Draft article");
    expect(firstPage).toContain('href="/writing?page=2"');
    expect(firstPage).toContain('rel="next"');
    expect(firstPage).not.toContain('rel="prev"');
    expect(secondPage).toContain('href="/writing/2026/beta"');
    expect(secondPage).toContain('href="/writing/2026/gamma"');
    expect(secondPage).not.toContain("Alpha article");
    expect(secondPage).toContain('href="/writing"');
    expect(secondPage).toContain('rel="prev"');
    expect(secondPage).toContain('href="/writing?page=3"');
    expect(secondPage).toContain('rel="next"');
    expect(thirdPage).toContain('href="/writing/2026/delta"');
    expect(thirdPage).not.toContain("Alpha article");
    expect(thirdPage).not.toContain("Beta article");
    expect(thirdPage).toContain('href="/writing?page=2"');
    expect(thirdPage).toContain('rel="prev"');
    expect(thirdPage).not.toContain('rel="next"');
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

  test("site owner can configure a theme and pages can read the parsed configuration", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({
        theme: {
          use: "./themes/minimal/theme.ts",
          config: { heading: "Configured theme" },
        },
        plugins: ["./plugins/todo-list/plugin.ts"],
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { z } from "zod";
      import { collection, defineTheme, page, route } from "diitey";
      export default defineTheme({
        config: z.object({ heading: z.string().min(1) }).strict(),
        setup() {
          return {
            collections: {
              writing: collection({ from: "hello.md", schema: { title: "string" } }),
            },
            routes: [
              route("/configured-theme", page("configured-theme", {
                item: { collection: "writing", match: "hello.md" },
              })),
            ],
          };
        },
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "configured-theme.tsx"),
      `import { useThemeConfig } from "diitey";
      export default function ConfiguredTheme() {
        const config = useThemeConfig<{ heading: string }>();
        return <h1>{config.heading}</h1>;
      }\n`,
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);
    const html = await fetch(`${address}/configured-theme`).then((response) =>
      response.text(),
    );

    expect(html).toContain("<h1>Configured theme</h1>");
  });

  test("a configurable theme can supply a root default when configuration is omitted", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({ theme: "./themes/minimal/theme.ts" });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { z } from "zod";
      import { collection, defineTheme, page, route } from "diitey";
      export default defineTheme({
        config: z.string().default("Default theme"),
        setup() {
          return {
            collections: {
              writing: collection({ from: "hello.md", schema: { title: "string" } }),
            },
            routes: [route("/default-theme", page("default-theme", {
              item: { collection: "writing", match: "hello.md" },
            }))],
          };
        },
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "default-theme.tsx"),
      `import { useThemeConfig } from "diitey";
      export default function DefaultTheme() {
        const config = useThemeConfig<string>();
        return <h1>{config}</h1>;
      }\n`,
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);
    const html = await fetch(`${address}/default-theme`).then((response) =>
      response.text(),
    );

    expect(html).toContain("<h1>Default theme</h1>");
  });

  test("site owner can configure a plugin and services use the parsed configuration", async () => {
    const siteRoot = await copyFixtureSite();
    const pluginRoot = join(siteRoot, "plugins", "configured");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, "plugin.ts"),
      `import { z } from "zod";
      import { definePlugin } from "diitey";
      export default definePlugin({
        config: z.object({ message: z.string().min(1) }).strict(),
        setup(config) {
          return {
            id: "configured",
            services: {
              "configured.message": {
                input: z.object({}).strict(),
                output: z.string(),
                handler() { return config.message; },
              },
            },
          };
        },
      });\n`,
    );
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({
        theme: "./themes/minimal/theme.ts",
        plugins: [{
          use: "./plugins/configured/plugin.ts",
          config: { message: "Configured plugin" },
        }],
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { defineTheme, page, route } from "diitey";
      export default defineTheme({
        collections: {},
        routes: [route("/configured-plugin", page("configured-plugin", {
          message: { service: "configured.message", input: {} },
        }))],
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "configured-plugin.tsx"),
      `export default function ConfiguredPlugin({ message }: { message: string }) {
        return <h1>{message}</h1>;
      }\n`,
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);
    const html = await fetch(`${address}/configured-plugin`).then((response) =>
      response.text(),
    );

    expect(html).toContain("<h1>Configured plugin</h1>");
  });

  test("site owner sees the invalid site config field when startup validation fails", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `export default { theme: 42 };\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("site config.theme");
  });

  test("site owner sees the invalid theme configuration field before a database is opened", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "data"), { recursive: true, force: true });
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({
        theme: {
          use: "./themes/minimal/theme.ts",
          config: { heading: 42 },
        },
      });\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { z } from "zod";
      import { defineTheme } from "diitey";
      export default defineTheme({
        config: z.object({ heading: z.string() }).strict(),
        setup() { return { collections: {}, routes: [] }; },
      });\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("site config.theme.config.heading");
    expect(
      await Bun.file(join(siteRoot, "data", "site.sqlite")).exists(),
    ).toBe(false);
  });

  test("site owner sees the invalid theme field before a database is opened", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "data"), { recursive: true, force: true });
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `export default { theme: "./themes/minimal/theme.ts" };\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `export default { collections: {}, routes: "not-an-array" };\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("theme ./themes/minimal/theme.ts.routes");
    expect(await Bun.file(join(siteRoot, "data", "site.sqlite")).exists()).toBe(false);
  });

  test("site owner sees the invalid plugin field before a database is opened", async () => {
    const siteRoot = await copyFixtureSite();
    const pluginRoot = join(siteRoot, "plugins", "broken");
    await rm(join(siteRoot, "data"), { recursive: true, force: true });
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, "plugin.ts"),
      `export default { services: { broken: 42 } };\n`,
    );
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `export default {
        theme: "./themes/minimal/theme.ts",
        plugins: [
          "./plugins/todo-list/plugin.ts",
          "./plugins/broken/plugin.ts",
        ],
      };\n`,
    );

    const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

    expect(exitCode).toBe(1);
    expect(error).toContain("plugin ./plugins/broken/plugin.ts.services.broken");
    expect(await Bun.file(join(siteRoot, "data", "site.sqlite")).exists()).toBe(false);
  });

  test.each([
    ["body limit", "bodyLimitBytes: 512", "bodyLimitBytes: 65_537", "bodyLimitBytes"],
    ["timeout", "timeoutMs: 2_000", "timeoutMs: 0", "timeoutMs"],
    [
      "rate limit",
      "rateLimit: { limit: 20, windowMs: 60_000 }",
      "rateLimit: { limit: 0, windowMs: 60_000 }",
      "rateLimit.limit",
    ],
  ] as const)(
    "site owner sees the invalid Action %s field at startup",
    async (_label, original, replacement, fieldPath) => {
      const siteRoot = await copyFixtureSite();
      const pluginPath = join(
        siteRoot,
        "plugins",
        "todo-list",
        "plugin.ts",
      );
      const source = await readFile(pluginPath, "utf8");
      await writeFile(pluginPath, source.replace(original, replacement));

      const { exitCode, error } = await waitForStartFailure(spawnSite(siteRoot));

      expect(exitCode).toBe(1);
      expect(error).toContain(
        `plugin ./plugins/todo-list/plugin.ts.actions.todo.create.${fieldPath}`,
      );
    },
  );

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

  test("home page shows the configurable intro and every published article", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const response = await fetch(`${address}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Welcome to the Diitey minimal site.");
    expect(html).toContain('href="/writing/2025/alpha"');
    expect(html).toContain('href="/writing/2026/zeta"');
    expect(html).not.toContain("Draft article");
  });

  test("home page intro is configurable from site.config.ts", async () => {
    const siteRoot = await copyFixtureSite();
    const configPath = join(siteRoot, "site.config.ts");
    const source = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      source.replace(
        "Welcome to the Diitey minimal site.",
        "A custom intro for the home page.",
      ),
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const html = await fetch(`${address}/`).then((response) => response.text());

    expect(html).toContain("A custom intro for the home page.");
    expect(html).not.toContain("Welcome to the Diitey minimal site.");
  });

  test("home page paginates articles across multiple pages", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const [first, second, third, beyond, invalid] = await Promise.all([
      fetch(`${address}/`).then(async (response) => ({
        status: response.status,
        html: await response.text(),
      })),
      fetch(`${address}/?page=2`).then(async (response) => ({
        status: response.status,
        html: await response.text(),
      })),
      fetch(`${address}/?page=3`).then(async (response) => ({
        status: response.status,
        html: await response.text(),
      })),
      fetch(`${address}/?page=9`).then(async (response) => ({
        status: response.status,
        html: await response.text(),
      })),
      fetch(`${address}/?page=zero`).then(async (response) => ({
        status: response.status,
        html: await response.text(),
      })),
    ]);

    expect(first.status).toBe(200);
    expect(first.html).toContain("Welcome to the Diitey minimal site.");
    expect(first.html).toContain('href="/writing/2025/alpha"');
    expect(first.html).toContain('href="/writing/2026/zeta"');
    expect(first.html).not.toContain("Beta article");

    expect(second.status).toBe(200);
    expect(second.html).toContain("Welcome to the Diitey minimal site.");
    expect(second.html).toContain('href="/writing/2026/beta"');
    expect(second.html).toContain('href="/writing/2026/gamma"');
    expect(second.html).not.toContain("Alpha article");

    expect(third.status).toBe(200);
    expect(third.html).toContain('href="/writing/2026/delta"');
    expect(third.html).not.toContain("Alpha article");
    expect(third.html).not.toContain("Beta article");

    expect(beyond.status).toBe(200);
    expect(beyond.html).toContain("<ol></ol>");

    expect(invalid.status).toBe(400);
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
