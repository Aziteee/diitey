import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { isValidIsoDate } from "./content.ts";

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface EnsureContentFieldsResult {
  readonly ensuredIds: number;
  readonly ensuredCreated: number;
}

export async function ensureContentFields(
  contentRoot: string,
  sourcePaths: readonly string[],
): Promise<EnsureContentFieldsResult> {
  const existingIds = new Set<string>();
  const plans: FileEnsurePlan[] = [];

  for (const sourcePath of sourcePaths) {
    const filePath = resolve(contentRoot, ...sourcePath.split("/"));
    const plan = await planFileEnsure(filePath, sourcePath);
    plans.push(plan);
    if (typeof plan.existingId === "string") {
      if (existingIds.has(plan.existingId)) {
        throw new Error(
          `${sourcePath}: duplicate content id ${plan.existingId}`,
        );
      }
      existingIds.add(plan.existingId);
    }
  }

  let ensuredIds = 0;
  let ensuredCreated = 0;

  for (const plan of plans) {
    if (!plan.needsId && !plan.needsCreated) {
      continue;
    }

    let nextId = plan.existingId;
    if (plan.needsId) {
      nextId = allocateContentId(existingIds);
      existingIds.add(nextId);
      ensuredIds += 1;
    }

    let nextCreated = plan.existingCreated;
    if (plan.needsCreated) {
      nextCreated = await createdFromFile(plan.filePath);
      ensuredCreated += 1;
    }

    if (typeof nextId !== "string" || typeof nextCreated !== "string") {
      throw new Error(`${plan.sourcePath}: failed to ensure content fields`);
    }

    await writeAtomic(plan.filePath, renderEnsuredFile(plan, nextId, nextCreated));
  }

  return { ensuredIds, ensuredCreated };
}

interface FileEnsurePlan {
  readonly filePath: string;
  readonly sourcePath: string;
  readonly raw: string;
  readonly hasFrontMatter: boolean;
  readonly frontMatterYaml: string | null;
  readonly bodyAfterFrontMatter: string;
  readonly existingId: string | null;
  readonly existingCreated: string | null;
  readonly needsId: boolean;
  readonly needsCreated: boolean;
}

async function planFileEnsure(
  filePath: string,
  sourcePath: string,
): Promise<FileEnsurePlan> {
  const raw = await Bun.file(filePath).text();
  const match = raw.match(frontMatterPattern);

  if (!match?.[1]) {
    return {
      filePath,
      sourcePath,
      raw,
      hasFrontMatter: false,
      frontMatterYaml: null,
      bodyAfterFrontMatter: raw,
      existingId: null,
      existingCreated: null,
      needsId: true,
      needsCreated: true,
    };
  }

  const frontMatterYaml = match[1];
  const document = parseDocument(frontMatterYaml, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${sourcePath}: ${document.errors[0]?.message}`);
  }

  const attributes = (document.toJS() ?? {}) as Record<string, unknown>;
  const idDecision = decideId(attributes.id, sourcePath);
  const createdDecision = decideCreated(attributes.created, sourcePath);

  return {
    filePath,
    sourcePath,
    raw,
    hasFrontMatter: true,
    frontMatterYaml,
    bodyAfterFrontMatter: raw.slice(match[0].length),
    existingId: idDecision.existing,
    existingCreated: createdDecision.existing,
    needsId: idDecision.needs,
    needsCreated: createdDecision.needs,
  };
}

function decideId(
  value: unknown,
  sourcePath: string,
): { readonly existing: string | null; readonly needs: boolean } {
  if (isTrulyMissing(value)) {
    return { existing: null, needs: true };
  }
  if (typeof value === "string" && value.trim() !== "") {
    return { existing: value, needs: false };
  }
  throw new Error(`${sourcePath}: id must be a non-empty YAML string`);
}

function decideCreated(
  value: unknown,
  sourcePath: string,
): { readonly existing: string | null; readonly needs: boolean } {
  if (isTrulyMissing(value)) {
    return { existing: null, needs: true };
  }
  if (typeof value === "string" && isValidIsoDate(value)) {
    return { existing: value, needs: false };
  }
  throw new Error(
    `${sourcePath}: created must be a valid ISO 8601 date or datetime`,
  );
}

function isTrulyMissing(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function allocateContentId(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = crypto.randomUUID();
    if (!existingIds.has(id)) {
      return id;
    }
  }
  throw new Error("Failed to allocate a unique content id");
}

async function createdFromFile(filePath: string): Promise<string> {
  const details = await stat(filePath);
  const birthMs = details.birthtimeMs;
  const ms =
    Number.isFinite(birthMs) && birthMs > 0 ? birthMs : details.mtimeMs;
  return new Date(ms).toISOString().slice(0, 10);
}

function renderEnsuredFile(
  plan: FileEnsurePlan,
  id: string,
  created: string,
): string {
  if (!plan.hasFrontMatter || plan.frontMatterYaml === null) {
    const body = plan.raw;
    const separator = body === "" || body.startsWith("\n") ? "" : "\n";
    return `---\nid: ${yamlString(id)}\ncreated: ${yamlString(created)}\n---${separator}${body}`;
  }

  let yamlText = plan.frontMatterYaml.replace(/\s+$/, "");
  if (plan.needsId) {
    yamlText = upsertYamlScalar(yamlText, "id", id);
  }
  if (plan.needsCreated) {
    yamlText = upsertYamlScalar(yamlText, "created", created);
  }
  return `---\n${yamlText}\n---\n${plan.bodyAfterFrontMatter}`;
}

function upsertYamlScalar(yamlText: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}\\s*:.*$`, "m");
  const line = `${key}: ${yamlString(value)}`;
  if (pattern.test(yamlText)) {
    return yamlText.replace(pattern, line);
  }
  return yamlText === "" ? line : `${yamlText}\n${line}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const directory = dirname(filePath);
  const tempPath = join(
    directory,
    `.${basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
