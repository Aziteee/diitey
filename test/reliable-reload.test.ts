import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

interface ReloadInProgress {
  status: "in_progress";
  buildId: string;
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

type ReloadingStatus = StatusResult & {
  reloading: true;
  activeBuildId: string;
};

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

describe("reliable reload loop", () => {
  test("site owner can reload changed content and inspect the successful build", async () => {
    const siteRoot = await copyFixtureSite();
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    await writeContent(siteRoot, "Reloaded title", "Reloaded body.");
    const reload = await runCli<ReloadResult>(siteRoot, "reload");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const status = await runCli<StatusResult>(siteRoot, "status");

    expect(reload.exitCode).toBe(0);
    expect(reload.value.status).toBe("succeeded");
    expect(reload.value.buildId).not.toBe("");
    expect(reload.value.snapshotVersion).toBe(reload.value.buildId);
    expect(html).toContain("<h1>Reloaded title</h1>");
    expect(html).toContain("<p>Reloaded body.</p>");
    expect(status.exitCode).toBe(0);
    expect(status.value.currentSnapshotVersion).toBe(reload.value.buildId);
    expect(status.value.lastSuccessfulAt).not.toBe("");
    expect(status.value.lastAttempt).toEqual({
      buildId: reload.value.buildId,
      result: "succeeded",
    });
    expect(status.value.reloading).toBe(false);
  }, 10_000);

  test("failed reload keeps the effective snapshot and reports the failed build", async () => {
    const siteRoot = await copyFixtureSite();
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli<StatusResult>(siteRoot, "status");
    await writeFile(
      join(siteRoot, "content", "hello.md"),
      `---\nid: 123\ncreated: "2026-07-12"\ntitle: "Broken"\n---\n\nBroken body.\n`,
    );

    const reload = await runCli<ReloadFailure>(siteRoot, "reload");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const after = await runCli<StatusResult>(siteRoot, "status");

    expect(reload.exitCode).toBe(1);
    expect(reload.value.status).toBe("failed");
    expect(reload.value.buildId).not.toBe("");
    expect(reload.value.error).toContain("id must be a non-empty YAML string");
    expect(reload.value.snapshotVersion).toBe(before.value.currentSnapshotVersion);
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(html).toContain("<p>This page came from a Markdown content file.</p>");
    expect(after.value.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
    expect(after.value.lastSuccessfulAt).toBe(before.value.lastSuccessfulAt);
    expect(after.value.lastAttempt).toEqual({
      buildId: reload.value.buildId,
      result: "failed",
      error: reload.value.error,
    });
    expect(after.value.reloading).toBe(false);
  }, 10_000);

  test("timed out reload keeps the effective snapshot", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";\n\nexport default defineSite({\n  theme: "./themes/minimal/theme.ts",\n  plugins: ["./plugins/todo-list/plugin.ts"],\n  reload: { timeoutMs: 10 },\n});\n`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli<StatusResult>(siteRoot, "status");
    await writeContent(siteRoot, "Too late", "Large body. ".repeat(500_000));

    const reload = await runCli<ReloadFailure>(siteRoot, "reload");
    const html = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const after = await runCli<StatusResult>(siteRoot, "status");

    expect(reload.exitCode).toBe(1);
    expect(reload.value.status).toBe("failed");
    expect(reload.value.error).toContain("timed out after 10ms");
    expect(html).toContain("<h1>Hello, Diitey</h1>");
    expect(after.value.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
    expect(after.value.lastAttempt.result).toBe("failed");
  }, 15_000);

  test("requests keep one snapshot while a concurrent reload is rejected", async () => {
    const siteRoot = await copyFixtureSite();
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);
    const before = await runCli<StatusResult>(siteRoot, "status");
    await writeContent(
      siteRoot,
      "Concurrent title",
      "New paragraph.\n\n".repeat(50_000),
    );

    const reloadPromise = runCli<ReloadResult>(siteRoot, "reload");
    const during = await waitUntilReloading(siteRoot);
    const htmlDuring = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );
    const concurrent = await runCli<ReloadInProgress>(siteRoot, "reload");
    const reload = await reloadPromise;
    const htmlAfter = await fetch(`${address}/writing/hello`).then((response) =>
      response.text(),
    );

    expect(during.reloading).toBe(true);
    expect(during.currentSnapshotVersion).toBe(
      before.value.currentSnapshotVersion,
    );
    expect(during.activeBuildId).not.toBe("");
    expect(htmlDuring).toContain("<h1>Hello, Diitey</h1>");
    expect(htmlDuring).toContain(
      "<p>This page came from a Markdown content file.</p>",
    );
    expect(concurrent.exitCode).toBe(1);
    expect(concurrent.value).toEqual({
      status: "in_progress",
      buildId: during.activeBuildId,
      snapshotVersion: before.value.currentSnapshotVersion,
    });
    expect(reload.exitCode).toBe(0);
    expect(reload.value.buildId).toBe(during.activeBuildId);
    expect(htmlAfter).toContain("<h1>Concurrent title</h1>");
    expect(htmlAfter).toContain("<p>New paragraph.</p>");
  }, 30_000);

  test("public listener never exposes the reserved system namespace", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `export default { theme: "./themes/minimal/theme.ts" };\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "theme.ts"),
      `import { collection, defineTheme, page, route } from "../../../../../src/index.ts";\n\nexport default defineTheme({\n  collections: {\n    writing: collection({ from: "hello.md", schema: { title: "string" } }),\n  },\n  routes: [\n    route("/_system/status", page("article", {\n      item: { collection: "writing", match: "hello.md" },\n    })),\n  ],\n});\n`,
    );
    const site = spawnSite(siteRoot);
    const address = await readServerAddress(site);

    const response = await fetch(`${address}/_system/status`);

    expect(response.status).toBe(404);
  }, 10_000);

  test("reload timeout interrupts slow theme rendering", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "site.config.ts"),
      `import { defineSite } from "../../../src/index.ts";\n\nexport default defineSite({\n  theme: "./themes/minimal/theme.ts",\n  plugins: ["./plugins/todo-list/plugin.ts"],\n  reload: { timeoutMs: 1_000 },\n});\n`,
    );
    await writeFile(
      join(siteRoot, "themes", "minimal", "pages", "article.tsx"),
      `import type { ContentRecord } from "../../../../../../src/index.ts";\n\nexport default function Article({ item }: { item: ContentRecord }) {\n  const title = String(item.attributes.title);\n  if (title === "Slow render") {\n    const finishAt = Date.now() + 3_000;\n    while (Date.now() < finishAt) {}\n  }\n  return <main><h1>{title}</h1><div dangerouslySetInnerHTML={{ __html: item.html }} /></main>;\n}\n`,
    );
    const site = spawnSite(siteRoot);
    await readServerAddress(site);
    await writeContent(siteRoot, "Slow render", "Slow body.");

    const startedAt = performance.now();
    const reload = await runCli<ReloadFailure>(siteRoot, "reload");
    const elapsedMs = performance.now() - startedAt;

    expect(reload.exitCode).toBe(1);
    expect(reload.value.error).toContain("timed out after 1000ms");
    expect(elapsedMs).toBeLessThan(2_500);
  }, 10_000);

  test("runtime information is restricted to the current Windows user", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const siteRoot = await copyFixtureSite();
    const site = spawnSite(siteRoot);
    await readServerAddress(site);

    const result = await inspectWindowsAcl(
      join(siteRoot, "data", "diitey.runtime.json"),
    );

    expect(result).toEqual({ exitCode: 0, error: "" });
  }, 10_000);

  test("management commands reject damaged runtime information with a field path", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "data", "diitey.runtime.json"),
      JSON.stringify({ pid: 123, adminPort: "broken", token: "token" }),
    );

    const result = await runRawCli(siteRoot, "status");

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("runtime info.adminPort");
  });
});

async function inspectWindowsAcl(
  filePath: string,
): Promise<{ exitCode: number; error: string }> {
  const script = `$acl = [System.IO.File]::GetAccessControl($env:DIITEY_RUNTIME_FILE); $current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]); $unsafe = @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ne $current }); if (-not $acl.AreAccessRulesProtected -or $unsafe.Count -gt 0) { $sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::All); Write-Error ("SDDL=" + $sddl + " current=" + $current); exit 1 }`;
  const process = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      stdout: "ignore",
      stderr: "pipe",
      env: { ...processEnv(), DIITEY_RUNTIME_FILE: filePath },
    },
  );
  const [exitCode, error] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, error };
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

async function waitUntilReloading(siteRoot: string): Promise<ReloadingStatus> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await runCli<StatusResult>(siteRoot, "status");
    if (status.value.reloading && status.value.activeBuildId) {
      return {
        ...status.value,
        reloading: true,
        activeBuildId: status.value.activeBuildId,
      };
    }
    await Bun.sleep(25);
  }
  throw new Error("Reload completed before status reported it as running");
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

async function runRawCli(
  siteRoot: string,
  command: "reload" | "status",
): Promise<{ exitCode: number; error: string }> {
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
  const [exitCode, error] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, error };
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".reload-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
}

async function writeContent(
  siteRoot: string,
  title: string,
  body: string,
): Promise<void> {
  await writeFile(
    join(siteRoot, "content", "hello.md"),
    `---\nid: "hello-content"\ncreated: "2026-07-12"\ntitle: "${title}"\n---\n\n${body}\n`,
  );
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
