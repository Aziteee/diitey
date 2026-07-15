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

test("content records render the supported GFM syntax", async () => {
  const root = await mkdtemp(join(import.meta.dir, ".gfm-"));
  temporaryRoots.push(root);
  const filePath = join(root, "content.md");
  await writeFile(
    filePath,
    `---
id: "gfm-content"
created: "2026-07-14"
---
| Name | Value |
| ---- | ----- |
| A    | 1     |

~~removed~~

- [x] Done

https://example.com
`,
  );

  const record = await buildContentRecord(filePath, "content.md", {
    remarkPlugins: [],
    rehypePlugins: [],
  });

  expect(record.html).toContain("<table>");
  expect(record.html).toContain("<del>removed</del>");
  expect(record.html).toContain('<input type="checkbox" checked disabled>');
  expect(record.html).toContain(
    '<a href="https://example.com">https://example.com</a>',
  );
});
