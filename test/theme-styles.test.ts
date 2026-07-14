import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

interface ReloadResult {
  status: "succeeded";
  buildId: string;
  snapshotVersion: string;
}

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

describe("theme stylesheet pipeline", () => {
  test("a theme without styles starts without a core theme stylesheet link", async () => {
    const siteRoot = await copyFixtureSite();
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(html).not.toMatch(
      /rel="stylesheet"[^>]*href="\/assets\/theme\/styles-[a-f0-9]+\.css"/,
    );
    expect(html).not.toMatch(
      /href="\/assets\/theme\/styles-[a-f0-9]+\.css"[^>]*rel="stylesheet"/,
    );
  }, 10_000);

  test("document can link a hashed theme stylesheet served as immutable CSS", async () => {
    const siteRoot = await copyFixtureSite();
    await writeStylesFixture(siteRoot, {
      css: "/* diitey-theme-css-marker */ .theme-stylesheet-rule { color: #c0ffee; }",
    });
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const pageResponse = await fetch(`${address}/writing/hello`);
    const html = await pageResponse.text();
    const stylesheetPath = html.match(
      /href="(\/assets\/theme\/styles-[a-f0-9]+\.css)"/,
    )?.[1];
    expect(stylesheetPath).toBeDefined();
    expect(html).toContain(`rel="stylesheet" href="${stylesheetPath}"`);
    expect(pageResponse.headers.get("cache-control")).toBe("no-store");
    expect(html).not.toContain("<script");

    const cssResponse = await fetch(`${address}${stylesheetPath}`);
    const cssBody = await cssResponse.text();
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toContain("text/css");
    expect(cssResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cssBody).toContain("theme-stylesheet-rule");
    expect(cssBody).toContain("#c0ffee");
  }, 10_000);

  test("a declared stylesheet that is missing fails site startup", async () => {
    const siteRoot = await copyFixtureSite();
    await writeThemeWithStyles(siteRoot, "styles");
    // styles.css intentionally not written

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toMatch(/stylesheet|styles\.css|Failed to build/i);
  }, 10_000);

  test("invalid CSS fails site startup", async () => {
    const siteRoot = await copyFixtureSite();
    await writeStylesFixture(siteRoot, {
      css: "this is { not valid css !!!",
    });

    const error = await readStartupError(spawnSite(siteRoot));

    expect(error).toMatch(/stylesheet|Failed to build/i);
  }, 10_000);

  test("islands still hydrate when a theme stylesheet is present", async () => {
    const siteRoot = await copyFixtureSite();
    await writeStylesFixture(siteRoot, {
      css: "/* with-islands */ body { margin: 0; }",
    });
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "island-demo.tsx"),
      `import type { ContentRecord } from "diitey";
      import { Island } from "diitey";
      import Counter from "../islands/counter.tsx";

      export default function IslandDemo({
        items,
      }: {
        items: ContentRecord[];
      }) {
        return (
          <main>
            <h1>Islands</h1>
            <Island name="counter" component={Counter} props={{ initial: 3 }} />
          </main>
        );
      }
      `,
    );

    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);
    const html = await fetch(`${address}/island-demo`).then((response) =>
      response.text(),
    );

    expect(html).toMatch(/href="\/assets\/theme\/styles-[a-f0-9]+\.css"/);
    expect(html).toContain('data-diitey-island="counter"');
    expect(html).toMatch(
      /<script type="module" src="\/assets\/islands\/hydrate-[a-f0-9]+\.js"><\/script>/,
    );
  }, 10_000);

  test("content reload does not rebuild or rehash the theme stylesheet", async () => {
    const siteRoot = await copyFixtureSite();
    await writeStylesFixture(siteRoot, {
      css: ".pin-rule-startup { color: red; }",
    });
    const process = spawnSite(siteRoot);
    const address = await readServerAddress(process);

    const beforeHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const beforePath = beforeHtml.match(
      /href="(\/assets\/theme\/styles-[a-f0-9]+\.css)"/,
    )?.[1];
    expect(beforePath).toBeDefined();
    const beforeCss = await fetch(`${address}${beforePath}`).then((response) =>
      response.text(),
    );
    expect(beforeCss).toContain("pin-rule-startup");

    await writeFile(
      join(siteRoot, "themes", "minimal", "styles.css"),
      ".pin-rule-after-start { color: blue; }",
    );
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "hello-content"
created: "2026-07-12"
title: "Hello After Reload"
tags:
  - introduction
draft: false
rating: 5
---

Body after reload.
`,
    );
    const reload = await runCli<ReloadResult>(siteRoot, "reload");
    expect(reload.exitCode).toBe(0);
    expect(reload.value.status).toBe("succeeded");

    const afterHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const afterPath = afterHtml.match(
      /href="(\/assets\/theme\/styles-[a-f0-9]+\.css)"/,
    )?.[1];
    const afterCss = await fetch(`${address}${afterPath}`).then((response) =>
      response.text(),
    );

    expect(afterPath).toBe(beforePath);
    expect(afterCss).toBe(beforeCss);
    expect(afterCss).toContain("pin-rule-startup");
    expect(afterCss).not.toContain("pin-rule-after-start");
    expect(afterHtml).toContain("Hello After Reload");
  }, 20_000);
});

async function writeStylesFixture(
  siteRoot: string,
  options: { readonly css: string },
): Promise<void> {
  await writeThemeWithStyles(siteRoot, "styles");
  await writeFile(
    join(siteRoot, "themes", "minimal", "styles.css"),
    options.css,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "document.tsx"),
    `import type { ComponentChildren } from "preact";
    import { useThemeConfig, useThemeStylesheet } from "diitey";
    import type { MinimalThemeConfig } from "../theme.ts";

    export default function Document({
      title,
      children,
    }: {
      title: string;
      children: ComponentChildren;
    }) {
      const config = useThemeConfig<MinimalThemeConfig>();
      const stylesheet = useThemeStylesheet();

      return (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>{title}</title>
            <link rel="stylesheet" href={stylesheet} />
          </head>
          <body>
            <header data-document-chrome="site-nav">
              <strong>{config.siteName}</strong>
            </header>
            {children}
          </body>
        </html>
      );
    }
    `,
  );
}

async function writeThemeWithStyles(
  siteRoot: string,
  styles: string,
): Promise<void> {
  const themePath = join(siteRoot, "themes", "minimal", "theme.ts");
  const source = await Bun.file(themePath).text();
  if (source.includes("styles:")) return;
  await writeFile(
    themePath,
    source.replace(
      'document: "document",',
      `document: "document",\n      styles: ${JSON.stringify(styles)},`,
    ),
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".styles-"));
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

async function runCli<T>(
  siteRoot: string,
  command: "reload" | "status",
): Promise<{ exitCode: number; value: T }> {
  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      join(import.meta.dir, "..", "index.ts"),
      command,
      "--root",
      siteRoot,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (!stdout.trim()) {
    throw new Error(`CLI ${command} produced no stdout.\n${stderr}`);
  }
  return { exitCode, value: JSON.parse(stdout) as T };
}
