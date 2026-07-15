import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

type SiteProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

interface ReloadResult {
  status: "succeeded";
  buildId: string;
  snapshotVersion: string;
}

interface ReloadFailure {
  status: "failed";
  buildId: string;
  error: string;
  snapshotVersion: string;
}

interface StatusResult {
  currentSnapshotVersion: string;
  lastSuccessfulAt: string;
  lastAttempt: {
    buildId: string;
    result: "succeeded" | "failed";
    error?: string;
  };
  reloading: boolean;
  activeBuildId?: string;
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

describe("publication runtime invariants", () => {
  test("worker timeout does not silently adopt theme changes without a site restart", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/todo-list/plugin.ts"],
  reload: { timeoutMs: 1_000 },
});
`,
    );
    await writeSlowThemeMarker(siteRoot, "startup-theme");
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli<StatusResult>(siteRoot, "status");
    const beforeHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    await writeContent(siteRoot, "Slow render", "Slow body.");
    const timedOut = await runCli<ReloadFailure>(siteRoot, "reload");
    await writeSlowThemeMarker(siteRoot, "disk-theme-after-start");
    await writeContent(siteRoot, "Recovered title", "Recovered body.");
    const recovered = await runCli<ReloadResult | ReloadFailure>(siteRoot, "reload");
    const afterHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const after = await runCli<StatusResult>(siteRoot, "status");

    expect(beforeHtml).toContain('data-theme-marker="startup-theme"');
    expect(timedOut.exitCode).toBe(1);
    expect(timedOut.value.status).toBe("failed");
    expect(timedOut.value.error).toContain("timed out after 1000ms");
    expect(timedOut.value.snapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
    // After worker timeout, the site must keep serving the startup program.
    // A later content reload must not adopt theme files written after start.
    expect(afterHtml).toContain('data-theme-marker="startup-theme"');
    expect(afterHtml).not.toContain('data-theme-marker="disk-theme-after-start"');
    expect(after.value.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
    expect(recovered.exitCode).toBe(1);
    expect(recovered.value.status).toBe("failed");
    if (recovered.value.status !== "failed") {
      throw new Error("expected reload to fail after worker timeout");
    }
    expect(recovered.value.error).toMatch(/restart|unavailable|program/i);
  }, 30_000);

  test("a request-time plugin service content.exists reads the request-captured effective snapshot", async () => {
    const siteRoot = await copyFixtureSite();
    await writeExistsProbePlugin(siteRoot);
    await enableExistsProbe(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const probePromise = fetch(`${address}/_action/exists.probe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content", delayMs: 400 }),
    });
    await Bun.sleep(50);
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---
id: "replacement-content"
created: "2026-07-12"
title: "Replacement"
---

Replacement body.
`,
    );
    const reload = await runCli<ReloadResult>(siteRoot, "reload");
    const probe = await probePromise;
    const probeBody = (await probe.json()) as {
      existed: boolean;
      contentId: string;
    };
    const missing = await fetch(`${address}/_action/exists.probe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "hello-content", delayMs: 0 }),
    });
    const present = await fetch(`${address}/_action/exists.probe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: address,
      },
      body: JSON.stringify({ contentId: "replacement-content", delayMs: 0 }),
    });

    expect(reload.exitCode).toBe(0);
    expect(probe.status).toBe(201);
    expect(probeBody).toEqual({
      existed: true,
      contentId: "hello-content",
    });
    expect(missing.status).toBe(201);
    expect(await missing.json()).toEqual({
      existed: false,
      contentId: "hello-content",
    });
    expect(present.status).toBe(201);
    expect(await present.json()).toEqual({
      existed: true,
      contentId: "replacement-content",
    });
  }, 20_000);

  test("content reload does not run plugin migrations or rebuild islands", async () => {
    const siteRoot = await copyFixtureSite();
    await writeIslandFixture(siteRoot);
    await writeMigratingPlugin(siteRoot, 1);
    await enableIslandAndMigrationSite(siteRoot);
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const beforeHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const beforeManifest = await fetch(
      `${address}/assets/island-manifest.json`,
    ).then((response) => response.json() as Promise<Record<string, string>>);
    const beforeAssetPath = beforeManifest.counter;
    expect(beforeAssetPath).toBeDefined();
    const beforeAsset = await fetch(`${address}${beforeAssetPath}`).then(
      (response) => response.text(),
    );

    await writeFile(
      join(siteRoot, "themes", "minimal", "islands", "counter.tsx"),
      `export default function Counter({ initial }: { initial: number }) {
  return <button data-island-build="after-reload">Count: {initial}</button>;
}
`,
    );
    await writeMigratingPlugin(siteRoot, 2);
    await writeContent(siteRoot, "Reloaded title", "Reloaded body.");
    const reload = await runCli<ReloadResult>(siteRoot, "reload");
    const afterHtml = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const afterManifest = await fetch(
      `${address}/assets/island-manifest.json`,
    ).then((response) => response.json() as Promise<Record<string, string>>);
    const afterAsset = await fetch(`${address}${afterManifest.counter}`).then(
      (response) => response.text(),
    );
    const database = new Database(join(siteRoot, "data", "site.sqlite"));
    const secondTable = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe_v2'",
      )
      .get();
    const schema = database
      .query<{ schema_version: number }, []>(
        "SELECT schema_version FROM diitey_plugin_schema WHERE plugin_id = 'probe'",
      )
      .get();
    database.close();

    expect(beforeHtml).toContain('data-diitey-island="counter"');
    expect(reload.exitCode).toBe(0);
    expect(afterHtml).toContain("<h1>Reloaded title</h1>");
    expect(afterManifest.counter).toBe(beforeAssetPath);
    expect(afterAsset).toBe(beforeAsset);
    expect(afterAsset).not.toContain("after-reload");
    expect(secondTable).toBeNull();
    expect(schema?.schema_version).toBe(1);
  }, 20_000);

  test("startup failure before plugin migration leaves no partial SQLite changes", async () => {
    const siteRoot = await copyFixtureSite();
    await rm(join(siteRoot, "data"), { recursive: true, force: true });
    await writeMigratingPlugin(siteRoot, 1);
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/probe/plugin.ts"],
});
`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "islands", "broken.tsx"),
      `export default function Broken() {
  return <button>{(() => { throw new Error("island build secret"); })()}</button>;
}
`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "article.tsx"),
      `import type { ContentRecord } from "../../../../../../src/index.ts";
import { Island } from "../../../../../../src/index.ts";
import Broken from "../islands/broken.tsx";

export default function Article({ item }: { item: ContentRecord }) {
  return (
    <main>
      <h1>{String(item.attributes.title)}</h1>
      <Island name="broken" component={Broken} props={{}} />
    </main>
  );
}
`,
    );

    const failure = await waitForStartFailure(spawnSite(siteRoot));
    const sqliteExists = await Bun.file(join(siteRoot, "data", "site.sqlite")).exists();

    expect(failure.exitCode).toBe(1);
    expect(failure.error.length).toBeGreaterThan(0);
    expect(sqliteExists).toBe(false);
  }, 15_000);
});

async function writeSlowThemeMarker(
  siteRoot: string,
  marker: string,
): Promise<void> {
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "article.tsx"),
    `import type { ContentRecord } from "../../../../../../src/index.ts";

export default function Article({ item }: { item: ContentRecord }) {
  const title = String(item.attributes.title);
  if (title === "Slow render") {
    const finishAt = Date.now() + 3_000;
    while (Date.now() < finishAt) {}
  }
  return (
    <main data-theme-marker="${marker}">
      <h1>{title}</h1>
      <div dangerouslySetInnerHTML={{ __html: item.html }} />
    </main>
  );
}
`,
  );
}

async function writeExistsProbePlugin(siteRoot: string): Promise<void> {
  const pluginRoot = join(siteRoot, "plugins", "exists-probe");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "plugin.ts"),
    `import { definePlugin } from "../../../../../src/index.ts";

const probeInput = {
  parse(value: unknown) {
    if (!value || typeof value !== "object") throw new Error("must be an object");
    const input = value as Record<string, unknown>;
    if (typeof input.contentId !== "string") throw new Error("contentId must be a string");
    if (typeof input.delayMs !== "number" || !Number.isFinite(input.delayMs)) {
      throw new Error("delayMs must be a number");
    }
    return input;
  },
};

export default definePlugin({
  id: "exists-probe",
  version: "1.0.0",
  schemaVersion: 0,
  services: {
    "exists.probe": {
      input: probeInput,
      output: { parse: (value: unknown) => value },
      async handler(input, { content, signal }) {
        await Bun.sleep(Number(input.delayMs));
        if (signal.aborted) throw new Error("aborted");
        return {
          existed: content.exists(String(input.contentId)),
          contentId: String(input.contentId),
        };
      },
    },
  },
  actions: {
    "exists.probe": {
      service: "exists.probe",
      bodyLimitBytes: 256,
      rateLimit: { limit: 20, windowMs: 60_000 },
      timeoutMs: 5_000,
    },
  },
});
`,
  );
}

async function enableExistsProbe(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/exists-probe/plugin.ts"],
});
`,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

export default defineTheme({
  collections: {
    writing: collection({ from: "hello.md", schema: { title: "string" } }),
  },
  routes: [
    route("/writing/hello", page("article", {
      item: { collection: "writing", match: "hello.md" },
    })),
  ],
});
`,
  );
}

async function writeMigratingPlugin(
  siteRoot: string,
  schemaVersion: 1 | 2,
): Promise<void> {
  const pluginRoot = join(siteRoot, "plugins", "probe");
  await mkdir(pluginRoot, { recursive: true });
  const migrations =
    schemaVersion === 1
      ? `[
      {
        id: "0001-create-probe",
        schemaVersion: 1,
        sql: "CREATE TABLE probe_v1 (id INTEGER PRIMARY KEY)",
      },
    ]`
      : `[
      {
        id: "0001-create-probe",
        schemaVersion: 1,
        sql: "CREATE TABLE probe_v1 (id INTEGER PRIMARY KEY)",
      },
      {
        id: "0002-create-probe-v2",
        schemaVersion: 2,
        sql: "CREATE TABLE probe_v2 (id INTEGER PRIMARY KEY)",
      },
    ]`;
  await writeFile(
    join(pluginRoot, "plugin.ts"),
    `import { definePlugin } from "../../../../../src/index.ts";

export default definePlugin({
  id: "probe",
  version: "1.0.0",
  schemaVersion: ${schemaVersion},
  migrations: ${migrations},
});
`,
  );
}

async function enableIslandAndMigrationSite(siteRoot: string): Promise<void> {
  await writeFile(
    join(siteRoot, "site.config.ts"),
    `import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/probe/plugin.ts"],
});
`,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "theme.ts"),
    `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";

export default defineTheme({
  collections: {
    writing: collection({ from: "hello.md", schema: { title: "string" } }),
  },
  routes: [
    route("/writing/hello", page("article", {
      item: { collection: "writing", match: "hello.md" },
    })),
  ],
});
`,
  );
  await writeFile(
    join(siteRoot, "themes", "minimal", "pages", "article.tsx"),
    `import type { ContentRecord } from "../../../../../../src/index.ts";
import { Island } from "../../../../../../src/index.ts";
import Counter from "../islands/counter.tsx";

export default function Article({ item }: { item: ContentRecord }) {
  return (
    <main>
      <h1>{String(item.attributes.title)}</h1>
      <Island name="counter" component={Counter} props={{ initial: 1 }} />
    </main>
  );
}
`,
  );
}

async function writeIslandFixture(siteRoot: string): Promise<void> {
  await mkdir(join(siteRoot, "themes", "minimal", "islands"), {
    recursive: true,
  });
  await writeFile(
    join(siteRoot, "themes", "minimal", "islands", "counter.tsx"),
    `export default function Counter({ initial }: { initial: number }) {
  return <button data-island-build="startup">Count: {initial}</button>;
}
`,
  );
}

async function writeContent(
  siteRoot: string,
  title: string,
  body: string,
): Promise<void> {
  await writeFile(
    join(siteRoot, "content", "hello.md"),
    `---
id: "hello-content"
created: "2026-07-12"
title: "${title}"
---

${body}
`,
  );
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".invariants-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  await rm(join(root, "data", "site.sqlite"), { force: true });
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
  const [exitCode, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (output.trim() === "") {
    throw new Error(`CLI ${command} produced no JSON (exit ${exitCode}): ${error}`);
  }
  return { exitCode, value: JSON.parse(output) as T };
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

async function waitForStartFailure(
  process: SiteProcess,
): Promise<{ exitCode: number; error: string }> {
  const exitCode = await Promise.race([
    process.exited,
    Bun.sleep(5_000).then(() => null),
  ]);
  if (exitCode === null) {
    process.kill();
    await process.exited;
    throw new Error("Site started when startup failure was expected");
  }
  return {
    exitCode,
    error: await new Response(process.stderr).text(),
  };
}
