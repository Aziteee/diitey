import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContentSnapshot } from "../src/publication/content-snapshot.ts";
import { openPublication } from "../src/publication/runtime.ts";
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
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("beforeContentSnapshot", () => {
  test("runs before scanning content and receives contentRoot", async () => {
    const siteRoot = await copyFixtureSite();
    await writePlugin(
      siteRoot,
      "writer.ts",
      `import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "writer",
  name: "writer",
  async beforeContentSnapshot({ contentRoot }) {
    await writeFile(
      join(contentRoot, "from-phase.md"),
      \`---
id: "from-phase"
created: "2026-07-12"
title: "From phase"
---

Written by beforeContentSnapshot.
\`,
    );
  },
});
`,
    );
    await writeSiteConfig(siteRoot, ["./plugins/writer.ts"]);

    const program = await compileSiteProgram(siteRoot);
    const snapshot = await buildContentSnapshot(program);
    const raw = await readFile(
      join(program.contentRoot, "from-phase.md"),
      "utf8",
    );

    expect(raw).toContain("Written by beforeContentSnapshot");
    expect(snapshot.byId.get("from-phase")?.sourcePath).toBe("from-phase.md");
  });

  test("runs plugins in site.config order", async () => {
    const siteRoot = await copyFixtureSite();
    await writePlugin(
      siteRoot,
      "first.ts",
      `import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "first",
  async beforeContentSnapshot({ contentRoot }) {
    await appendFile(join(contentRoot, "order.log"), "first\\n");
  },
});
`,
    );
    await writePlugin(
      siteRoot,
      "second.ts",
      `import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "second",
  async beforeContentSnapshot({ contentRoot }) {
    await appendFile(join(contentRoot, "order.log"), "second\\n");
  },
});
`,
    );
    await writeSiteConfig(siteRoot, [
      "./plugins/first.ts",
      "./plugins/second.ts",
    ]);

    const program = await compileSiteProgram(siteRoot);
    await buildContentSnapshot(program);
    const order = await readFile(join(program.contentRoot, "order.log"), "utf8");

    expect(order).toBe("first\nsecond\n");
  });

  test("hard failure aborts openPublication", async () => {
    const siteRoot = await copyFixtureSite();
    await writePlugin(
      siteRoot,
      "boom.ts",
      `import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "boom",
  beforeContentSnapshot() {
    throw new Error("sync refused");
  },
});
`,
    );
    await writeSiteConfig(siteRoot, ["./plugins/boom.ts"]);

    await expect(openPublication({ root: siteRoot })).rejects.toThrow(
      'Plugin "boom" beforeContentSnapshot failed: sync refused',
    );
  });

  test("reload failure keeps the effective publication", async () => {
    const siteRoot = await copyFixtureSite();
    await writePlugin(
      siteRoot,
      "gate.ts",
      `import { access } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "gate",
  async beforeContentSnapshot({ contentRoot }) {
    try {
      await access(join(contentRoot, "block-reload"));
    } catch {
      return;
    }
    throw new Error("blocked for reload");
  },
});
`,
    );
    await writeSiteConfig(siteRoot, ["./plugins/gate.ts"]);

    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli(siteRoot, "status");

    await writeFile(join(siteRoot, "content", "block-reload"), "x\n");
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "hello-content"
created: "2026-07-12"
title: "Should not publish"
---

Blocked body.
`,
    );

    const reload = await runCli(siteRoot, "reload");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const after = await runCli(siteRoot, "status");

    expect(reload.exitCode).toBe(1);
    expect(reload.value.status).toBe("failed");
    expect(reload.value.error).toContain(
      'Plugin "gate" beforeContentSnapshot failed: blocked for reload',
    );
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).not.toContain("Blocked body");
    expect(after.value.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
  }, 15_000);

  test("aborted signal fails the phase before scanning", async () => {
    const siteRoot = await copyFixtureSite();
    await writePlugin(
      siteRoot,
      "noop.ts",
      `import { definePlugin } from "../../../../src/index.ts";

export default definePlugin({
  id: "noop",
  beforeContentSnapshot() {},
});
`,
    );
    await writeSiteConfig(siteRoot, ["./plugins/noop.ts"]);

    const program = await compileSiteProgram(siteRoot);
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildContentSnapshot(program, { signal: controller.signal }),
    ).rejects.toThrow("Content snapshot build was cancelled");
  });
});

async function writeSiteConfig(
  siteRoot: string,
  plugins: readonly string[],
): Promise<void> {
  const all = ["./plugins/todo-list/plugin.ts", ...plugins];
  const list = all.map((path) => `"${path}"`).join(",\n          ");
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: [
          ${list}
  ],
});
`,
  );
}

async function writePlugin(
  siteRoot: string,
  fileName: string,
  source: string,
): Promise<void> {
  await mkdir(join(siteRoot, "plugins"), { recursive: true });
  await writeFile(join(siteRoot, "plugins", fileName), source);
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".before-cs-"));
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
