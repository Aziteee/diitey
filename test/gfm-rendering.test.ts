import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContentRecord } from "../src/content.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function renderMarkdown(body: string): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, ".gfm-"));
  temporaryRoots.push(root);
  const filePath = join(root, "content.md");
  await writeFile(
    filePath,
    `---
id: "gfm-content"
created: "2026-07-14"
---
${body}
`,
  );
  const record = await buildContentRecord(filePath, "content.md", {
    remarkPlugins: [],
    rehypePlugins: [],
  });
  return record.html;
}

describe("GitHub Flavored Markdown", () => {
  test("table renders to table markup", async () => {
    const html = await renderMarkdown(`| Name | Value |
| ---- | ----- |
| A    | 1     |
| B    | 2     |`);

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<th>Value</th>");
    expect(html).toContain("<td>A</td>");
    expect(html).toContain("<td>2</td>");
  });

  test("strikethrough renders to del element", async () => {
    const html = await renderMarkdown(`This is ~~removed~~ text.`);

    expect(html).toContain("<del>removed</del>");
  });

  test("task list renders checkboxes", async () => {
    const html = await renderMarkdown(`- [x] Done
- [ ] Todo`);

    expect(html).toContain(
      '<input type="checkbox" checked disabled>',
    );
    expect(html).toContain('<input type="checkbox" disabled>');
  });

  test("autolink literal renders anchor element", async () => {
    const html = await renderMarkdown(`Visit https://example.com today.`);

    expect(html).toContain(
      '<a href="https://example.com">https://example.com</a>',
    );
  });
});
