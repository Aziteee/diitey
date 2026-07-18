import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureContentFields } from "../src/content-ensure.ts";
import { openPublication } from "../src/publication/runtime.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ensure content fields", () => {
  test("writes id and created into a file without front matter", async () => {
    const contentRoot = await makeContentRoot();
    const filePath = join(contentRoot, "note.md");
    await writeFile(filePath, "Body only.\n");

    const result = await ensureContentFields(contentRoot, ["note.md"]);
    const raw = await readFile(filePath, "utf8");

    expect(result.ensuredIds).toBe(1);
    expect(result.ensuredCreated).toBe(1);
    expect(raw).toMatch(
      /^---\nid: "[0-9a-f-]{36}"\ncreated: "\d{4}-\d{2}-\d{2}"\n---\nBody only\.\n$/,
    );
  });

  test("fills only missing fields and leaves existing values alone", async () => {
    const contentRoot = await makeContentRoot();
    const filePath = join(contentRoot, "partial.md");
    await writeFile(
      filePath,
      `---\nid: "keep-me"\ntitle: "Partial"\n---\n\nBody.\n`,
    );

    const result = await ensureContentFields(contentRoot, ["partial.md"]);
    const raw = await readFile(filePath, "utf8");

    expect(result.ensuredIds).toBe(0);
    expect(result.ensuredCreated).toBe(1);
    expect(raw).toContain('id: "keep-me"');
    expect(raw).toContain('title: "Partial"');
    expect(raw).toMatch(/created: "\d{4}-\d{2}-\d{2}"/);
    expect(raw).toContain("Body.");
  });

  test("does not overwrite illegal existing values", async () => {
    const contentRoot = await makeContentRoot();
    const filePath = join(contentRoot, "bad.md");
    const original = `---\nid: 123\ncreated: "not-a-date"\n---\n\nBody.\n`;
    await writeFile(filePath, original);

    await expect(ensureContentFields(contentRoot, ["bad.md"])).rejects.toThrow(
      /id must be a non-empty YAML string|created must be a valid ISO/,
    );
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  test("openPublication with ensureContentFields publishes missing-field files", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(
      join(siteRoot, "content", "draft-note.md"),
      "No front matter yet.\n",
    );

    const publication = await openPublication({
      root: siteRoot,
      ensureContentFields: true,
    });
    try {
      const raw = await readFile(
        join(siteRoot, "content", "draft-note.md"),
        "utf8",
      );
      expect(raw).toMatch(/^---\nid: "[0-9a-f-]{36}"\ncreated: "\d{4}-\d{2}-\d{2}"\n---/);

      const status = publication.status();
      expect(status.lastAttempt.result).toBe("succeeded");
    } finally {
      await publication.close();
    }
  });

  test("reload with ensureContentFields writes missing fields on disk", async () => {
    const siteRoot = await copyFixtureSite();
    const publication = await openPublication({ root: siteRoot });
    try {
      await writeFile(
        join(siteRoot, "content", "later.md"),
        `---\ntitle: "Later"\n---\n\nLater body.\n`,
      );

      const reload = await publication.reload({ ensureContentFields: true });
      expect(reload.status).toBe("succeeded");

      const raw = await readFile(join(siteRoot, "content", "later.md"), "utf8");
      expect(raw).toMatch(/id: "[0-9a-f-]{36}"/);
      expect(raw).toMatch(/created: "\d{4}-\d{2}-\d{2}"/);
      expect(raw).toContain('title: "Later"');
    } finally {
      await publication.close();
    }
  });

  test("without the flag missing fields still fail the build", async () => {
    const siteRoot = await copyFixtureSite();
    await writeFile(join(siteRoot, "content", "missing.md"), "Body.\n");

    await expect(openPublication({ root: siteRoot })).rejects.toThrow(
      /YAML Front Matter is required|id must be/,
    );
  });
});

async function makeContentRoot(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".ensure-"));
  temporaryRoots.push(root);
  return root;
}

async function copyFixtureSite(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "fixtures", ".ensure-site-"));
  temporaryRoots.push(root);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), root, {
    recursive: true,
  });
  return root;
}
