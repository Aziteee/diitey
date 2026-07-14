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
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("island loop", () => {
  test("a page loads only the island it declares while an ordinary article loads no JavaScript", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const [ordinaryHtml, islandHtml] = await Promise.all([
      fetch(`${address}/writing/2025/alpha`).then((response) => response.text()),
      fetch(`${address}/writing/hello`).then((response) => response.text()),
    ]);

    expect(ordinaryHtml).not.toContain("<script");
    expect(ordinaryHtml).not.toContain("data-diitey-island");
    expect(islandHtml).toContain("<button>Count: 2</button>");
    expect(islandHtml).toContain('data-diitey-island="counter"');
    expect(islandHtml).toContain('data-diitey-props="{&quot;initial&quot;:2}"');
    expect(islandHtml).toMatch(
      /<script type="module" src="\/assets\/islands\/hydrate-[a-f0-9]+\.js"><\/script>/,
    );
    expect(islandHtml).not.toContain("counter-");
    expect(islandHtml).not.toContain("unused-");
  }, 10_000);

  test("hashed island assets are immutable while HTML and the manifest are not long-lived", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const pageResponse = await fetch(`${address}/writing/hello`);
    const html = await pageResponse.text();
    const assetPath = html.match(
      /<script type="module" src="([^"]+)"><\/script>/,
    )?.[1];
    expect(assetPath).toBeDefined();

    const [runtimeResponse, manifestResponse] = await Promise.all([
      fetch(`${address}${assetPath}`),
      fetch(`${address}/assets/island-manifest.json`),
    ]);
    const manifest = (await manifestResponse.json()) as Record<string, string>;
    const islandResponse = await fetch(`${address}${manifest.counter}`);

    expect(runtimeResponse.status).toBe(200);
    expect(runtimeResponse.headers.get("content-type")).toContain("text/javascript");
    expect(runtimeResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(assetPath).toMatch(/^\/assets\/islands\/hydrate-[a-f0-9]+\.js$/);
    expect(manifest.counter).toMatch(
      /^\/assets\/islands\/counter-[a-f0-9]+\.js$/,
    );
    expect(islandResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(manifest.unused).toMatch(
      /^\/assets\/islands\/unused-[a-f0-9]+\.js$/,
    );
    expect(manifestResponse.headers.get("cache-control")).toBe("no-store");
    expect(pageResponse.headers.get("cache-control")).toBe("no-store");
  }, 10_000);

  test("a site cannot publish island props that are not JSON-serializable", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "interactive-article.tsx"),
      `import type { ContentRecord } from "../../../../../../src/index.ts";
      import { Island } from "../../../../../../src/index.ts";
      import Counter from "../islands/counter.tsx";

      export default function InteractiveArticle({ item }: { item: ContentRecord }) {
        return <Island
          name="counter"
          component={Counter}
          props={{ initial: 2, onChange: () => undefined }}
        />;
      }
      `,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain("Island counter props must be JSON-serializable");
  }, 10_000);

  test("an island cannot inherit theme configuration that the page did not pass as props", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "diitey";
      export default defineSite({
        theme: {
          use: "./themes/minimal/theme.ts",
          config: { secret: "server-only-theme-value" },
        },
      });
      `,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { z } from "zod";
      import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

      export default defineTheme({
        config: z.object({ secret: z.string() }).strict(),
        setup() {
          return {
            collections: {
              writing: collection({ from: "hello.md", schema: { title: "string" } }),
            },
            routes: [
              route("/writing/hello", page("interactive-article", {
                item: { collection: "writing", match: "hello.md" },
              })),
            ],
          };
        },
      });
      `,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "islands", "counter.tsx"),
      `import { useThemeConfig } from "../../../../../../src/index.ts";

      export default function Counter() {
        const config = useThemeConfig<{ secret: string }>();
        return <p>{config.secret}</p>;
      }
      `,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain(
      "Theme configuration is only available while rendering a theme page",
    );
    expect(error).not.toContain("server-only-theme-value");
  }, 10_000);

  test("a site cannot start when an island browser bundle fails to build", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    await writeFile(
      join(siteRoot, "themes", "minimal", "islands", "counter.tsx"),
      `export default function Counter( {`,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain("Failed to build island counter");
  }, 10_000);

  test("a theme cannot publish a route in the reserved assets namespace", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

      export default defineTheme({
        collections: {
          writing: collection({ from: "hello.md", schema: { title: "string" } }),
        },
        routes: [
          route("/assets/custom", page("article", {
            item: { collection: "writing", match: "hello.md" },
          })),
        ],
      });
      `,
    );

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toContain("Theme route cannot use reserved path /assets/custom");
  }, 10_000);
});

async function writeIslandFixture(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "themes", "minimal", "islands"), {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      join(siteRoot, "themes", "minimal", "islands", "counter.tsx"),
      `import { useState } from "preact/hooks";

      export default function Counter({ initial }: { initial: number }) {
        const [count, setCount] = useState(initial);
        return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
      }
      `,
    ),
    writeFile(
      join(siteRoot, "themes", "minimal", "islands", "unused.tsx"),
      `export default function Unused() { return <p>unused</p>; }`,
    ),
    writeFile(
      join(siteRoot, "themes", "minimal", "pages", "interactive-article.tsx"),
      `import type { ContentRecord } from "../../../../../../src/index.ts";
      import { Island } from "../../../../../../src/index.ts";
      import Counter from "../islands/counter.tsx";

      export default function InteractiveArticle({ item }: { item: ContentRecord }) {
        return (
          <main>
            <h1>{String(item.attributes.title)}</h1>
            <Island name="counter" component={Counter} props={{ initial: 2 }} />
          </main>
        );
      }
      `,
    ),
  ]);
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

    export default defineTheme({
      collections: {
        writing: collection({ from: "hello.md", schema: { title: "string" } }),
        articles: collection({
          from: "articles/*/*.md",
          where: { draft: { not: true } },
          orderBy: [{ field: "created", direction: "desc" }],
          schema: { title: "string", tags: "string[]?", draft: "boolean?" },
        }),
      },
      routes: [
        route("/writing/hello", page("interactive-article", {
          item: { collection: "writing", match: "hello.md" },
        })),
        route("/writing/:year/:slug", page("article", {
          item: { collection: "articles", match: "articles/:year/:slug.md" },
        })),
      ],
    });
    `,
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".islands-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  await writeFile(
    join(root, "site.config.ts"),
    `export default { theme: "./themes/minimal/theme.ts" };\n`,
  );
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

async function readStartupError(process: SiteProcess): Promise<string> {
  const exitCode = await Promise.race([
    process.exited,
    Bun.sleep(2_000).then(() => null),
  ]);
  if (exitCode === null) {
    process.kill();
    await process.exited;
  }
  const error = await new Response(process.stderr).text();
  expect(exitCode).not.toBe(0);
  return error;
}
