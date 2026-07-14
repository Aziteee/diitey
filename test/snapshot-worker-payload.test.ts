import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildThemeIslands } from "../src/islands.ts";
import { compileSiteProgram } from "../src/publication/site-program.ts";
import { SnapshotWorker } from "../src/publication/snapshot-worker-client.ts";

const temporaryRoots: string[] = [];
const workers: SnapshotWorker[] = [];

afterEach(async () => {
  for (const worker of workers.splice(0)) {
    worker.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("snapshot worker publish-capable payload", () => {
  test("worker builds a publication candidate from pinned islands without rebuilding them", async () => {
    const siteRoot = await copyFixtureSite();
    const program = await compileSiteProgram(siteRoot, "rev-worker");
    const worker = await SnapshotWorker.create(
      siteRoot,
      program.programRevision,
      program.islands,
      program.styles,
    );
    workers.push(worker);

    const candidate = await worker.build("build-1", 10_000);

    expect(candidate.programRevision).toBe("rev-worker");
    expect(candidate.version).toBe("build-1");
    expect(candidate.routes.length).toBeGreaterThan(0);
    expect(
      candidate.content.records.some((record) => record.url.length > 0),
    ).toBe(true);
  }, 15_000);

  test("compileSiteProgram reuses provided islands instead of rebuilding", async () => {
    const siteRoot = await copyFixtureSite();
    const themePath = join(siteRoot, "themes", "minimal", "theme.ts");
    const islands = await buildThemeIslands(themePath);
    const marker = Object.freeze({
      ...islands,
      manifest: Object.freeze({
        ...islands.manifest,
        __pinned: "/assets/islands/pinned.js",
      }),
    });
    const program = await compileSiteProgram(siteRoot, "rev-reuse", {
      islands: marker,
    });

    expect(program.islands).toBe(marker);
    expect(program.islands.manifest.__pinned).toBe(
      "/assets/islands/pinned.js",
    );
    expect(program.programRevision).toBe("rev-reuse");
  }, 15_000);
});

async function copyFixtureSite(): Promise<string> {
  const siteRoot = await mkdtemp(join(import.meta.dir, "tmp-worker-"));
  temporaryRoots.push(siteRoot);
  await cp(join(import.meta.dir, "fixtures", "minimal-site"), siteRoot, {
    recursive: true,
  });
  return siteRoot;
}
