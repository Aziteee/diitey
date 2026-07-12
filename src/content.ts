import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { parseDocument } from "yaml";
import type { ContentRecord } from "./index.ts";

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export async function buildContentRecord(
  filePath: string,
  sourcePath: string,
): Promise<ContentRecord> {
  const markdown = await readFile(filePath, "utf8");
  const frontMatter = markdown.match(frontMatterPattern);
  if (!frontMatter?.[1]) {
    throw new Error(`${sourcePath}: YAML Front Matter is required`);
  }

  const document = parseDocument(frontMatter[1], { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${sourcePath}: ${document.errors[0]?.message}`);
  }

  const attributes = document.toJS() as Record<string, unknown>;
  const id = attributes.id;
  const created = attributes.created;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${sourcePath}: id must be a non-empty YAML string`);
  }
  if (typeof created !== "string" || !isValidIsoDate(created)) {
    throw new Error(`${sourcePath}: created must be a valid ISO 8601 date or datetime`);
  }

  const rendered = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return Object.freeze({
    id,
    created: normalizeCreated(created),
    sourcePath,
    url: "",
    attributes: Object.freeze({ ...attributes }),
    html: String(rendered),
  });
}

function isValidIsoDate(value: string): boolean {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!date) {
    return false;
  }

  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate =
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day;
  if (!validCalendarDate) {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return true;
  }

  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}

function normalizeCreated(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date(value).toISOString();
}
