import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContentRecord } from "../src/content.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function writeContent(body: string): Promise<{
  readonly filePath: string;
  readonly sourcePath: string;
}> {
  const root = await mkdtemp(join(import.meta.dir, ".body-transform-"));
  temporaryRoots.push(root);
  const filePath = join(root, "content.md");
  await writeFile(
    filePath,
    `---
id: "body-transform-content"
created: "2026-07-18"
title: "OLD_TOKEN in title"
---

${body}
`,
  );
  return { filePath, sourcePath: "content.md" };
}

test("body transforms can rewrite markdown body before parsing", async () => {
  const { filePath, sourcePath } = await writeContent("Hello OLD_TOKEN world.");

  const record = await buildContentRecord(filePath, sourcePath, {
    remarkPlugins: [],
    rehypePlugins: [],
    bodyTransforms: [(body) => body.replaceAll("OLD_TOKEN", "NEW_TOKEN")],
  });

  expect(record.html).toContain("NEW_TOKEN");
  expect(record.html).not.toContain("OLD_TOKEN");
});

test("body transforms do not rewrite front matter attributes", async () => {
  const { filePath, sourcePath } = await writeContent("Hello OLD_TOKEN world.");

  const record = await buildContentRecord(filePath, sourcePath, {
    remarkPlugins: [],
    rehypePlugins: [],
    bodyTransforms: [(body) => body.replaceAll("OLD_TOKEN", "NEW_TOKEN")],
  });

  expect(record.attributes.title).toBe("OLD_TOKEN in title");
  expect(record.html).toContain("NEW_TOKEN");
});

test("body transforms run in declaration order", async () => {
  const { filePath, sourcePath } = await writeContent("alpha");

  const record = await buildContentRecord(filePath, sourcePath, {
    remarkPlugins: [],
    rehypePlugins: [],
    bodyTransforms: [
      (body) => body.replaceAll("alpha", "beta"),
      (body) => body.replaceAll("beta", "gamma"),
    ],
  });

  expect(record.html).toContain("gamma");
  expect(record.html).not.toContain("alpha");
  expect(record.html).not.toContain("beta");
});

test("body transform failure fails content conversion", async () => {
  const { filePath, sourcePath } = await writeContent("Hello.");

  await expect(
    buildContentRecord(filePath, sourcePath, {
      remarkPlugins: [],
      rehypePlugins: [],
      bodyTransforms: [
        () => {
          throw new Error("body transform failed deliberately");
        },
      ],
    }),
  ).rejects.toThrow("body transform failed deliberately");
});
