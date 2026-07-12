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

describe("Markdown extension loop", () => {
  test("site owner can render a static callout from a configured plugin", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";

      export default defineSite({
        theme: "./themes/minimal/theme.ts",
        plugins: ["./plugins/callout/plugin.ts"],
      });
      `,
    );
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "hello-content"
created: "2026-07-12"
title: "Callout"
---

:::callout{type="warning"}
Take care.
:::
`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/writing/hello`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      '<aside class="callout" data-callout-type="warning" data-static="true"><p>Take care.</p></aside>',
    );
  }, 10_000);

  test("Markdown extensions run in configured plugin order", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";

      export default defineSite({
        theme: "./themes/minimal/theme.ts",
        plugins: ["./plugins/first.ts", "./plugins/second.ts"],
      });
      `,
    );
    await mkdir(join(siteRoot, "plugins"), { recursive: true });
    await Promise.all([
      writeTextPlugin(siteRoot, "first", "[first]"),
      writeTextPlugin(siteRoot, "second", "[second]"),
    ]);
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "hello-content"
created: "2026-07-12"
title: "Plugin order"
---

Order
`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(html).toContain("<p>Order[first][second]</p>");
  }, 10_000);

  test("failed Markdown conversion keeps the effective snapshot", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";

      export default defineSite({
        theme: "./themes/minimal/theme.ts",
        plugins: ["./plugins/failing.ts"],
      });
      `,
    );
    await mkdir(join(siteRoot, "plugins"), { recursive: true });
    await writeFile(
      join(siteRoot, "plugins", "failing.ts"),
      `import { definePlugin } from "../../../../src/index.ts";

      function failOnInvalidContent() {
        return function transform(node: any) {
          if (node.type === "text" && node.value.includes("BREAK_EXTENSION")) {
            throw new Error("Markdown conversion failed deliberately");
          }
          for (const child of node.children ?? []) transform(child);
        };
      }

      export default definePlugin({
        name: "failing",
        markdown: { remarkPlugins: [failOnInvalidContent] },
      });
      `,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli(siteRoot, "status");
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "hello-content"
created: "2026-07-12"
title: "Broken extension"
---

BREAK_EXTENSION
`,
    );

    const reload = await runCli(siteRoot, "reload");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const after = await runCli(siteRoot, "status");

    expect(reload.exitCode).toBe(1);
    expect(reload.value.status).toBe("failed");
    expect(reload.value.error).toContain("Markdown conversion failed deliberately");
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).toContain("This page came from a Markdown content file.");
    expect(after.value.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
  }, 10_000);
});

async function runCli(
  siteRoot: string,
  command: "reload" | "status",
): Promise<{ exitCode: number; value: Record<string, any> }> {
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
  const [exitCode, output] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  return { exitCode, value: JSON.parse(output) as Record<string, any> };
}

async function writeTextPlugin(
  siteRoot: string,
  name: string,
  suffix: string,
): Promise<void> {
  await writeFile(
    join(siteRoot, "plugins", `${name}.ts`),
    `import { definePlugin } from "../../../../src/index.ts";

    function appendText() {
      return function transform(node: any) {
        if (node.type === "text") node.value += ${JSON.stringify(suffix)};
        for (const child of node.children ?? []) transform(child);
      };
    }

    export default definePlugin({
      name: ${JSON.stringify(name)},
      markdown: { remarkPlugins: [appendText] },
    });
    `,
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".markdown-"));
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
