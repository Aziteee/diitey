import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { buildContentRecord } from "../content.ts";
import type {
  CollectionDefinition,
  ContentRecord,
  SchemaType,
  WhereCondition,
} from "../index.ts";
import type { SiteProgram } from "./site-program.ts";

export interface ContentSnapshot {
  readonly version: string;
  readonly publishedAt: string;
  readonly records: readonly ContentRecord[];
  readonly byId: ReadonlyMap<string, ContentRecord>;
  readonly byCollection: Readonly<Record<string, readonly ContentRecord[]>>;
}

export async function buildContentSnapshot(
  program: SiteProgram,
  version: string = crypto.randomUUID(),
): Promise<ContentSnapshot> {
  const sourcePaths = await scanContentFiles(program.contentRoot);
  const records = await Promise.all(
    sourcePaths.map((sourcePath) =>
      buildContentRecord(
        resolve(program.contentRoot, ...sourcePath.split("/")),
        sourcePath,
        program.markdown,
      ),
    ),
  );
  return assembleContentSnapshot(program, records, version);
}

export function assembleContentSnapshot(
  program: SiteProgram,
  records: readonly ContentRecord[],
  version: string = crypto.randomUUID(),
): ContentSnapshot {
  validateUniqueContentIds(records);
  const selectedByCollection = selectCollections(
    program.collections,
    program.collectionMatchers,
    records,
  );
  const byCollection = Object.fromEntries(
    Object.entries(selectedByCollection).map(([name, selected]) => [
      name,
      Object.freeze(
        selected.map((record) =>
          Object.freeze({
            ...record,
            attributes: Object.freeze({ ...record.attributes }),
          }),
        ),
      ),
    ]),
  ) as Readonly<Record<string, readonly ContentRecord[]>>;

  const publishedRecords = Object.freeze(
    records.map((record) =>
      Object.freeze({
        ...record,
        attributes: Object.freeze({ ...record.attributes }),
      }),
    ),
  );

  return Object.freeze({
    version,
    publishedAt: new Date().toISOString(),
    records: publishedRecords,
    byId: Object.freeze(
      new Map(publishedRecords.map((record) => [record.id, record])),
    ),
    byCollection: Object.freeze(byCollection),
  });
}

function selectCollections(
  definitions: Readonly<Record<string, CollectionDefinition>>,
  matchers: Readonly<Record<string, (sourcePath: string) => boolean>>,
  records: readonly ContentRecord[],
): Readonly<Record<string, readonly ContentRecord[]>> {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      const matches = matchers[name];
      if (!matches) throw new Error(`Missing collection matcher: ${name}`);
      const selected = records
        .filter((record) => matches(record.sourcePath))
        .map((record) => {
          const immutable = Object.freeze({
            ...record,
            attributes: Object.freeze({ ...record.attributes }),
          });
          validateThemeSchema(immutable, definition.schema);
          validateWhereTypes(immutable, definition.where ?? {});
          return immutable;
        })
        .filter((record) => matchesWhere(record, definition.where ?? {}));
      validateOrderTypes(selected, definition.orderBy ?? []);
      selected.sort((left, right) =>
        compareRecords(left, right, definition.orderBy ?? []),
      );
      return [name, Object.freeze(selected)];
    }),
  );
}

function validateUniqueContentIds(records: readonly ContentRecord[]): void {
  const seenIds = new Map<string, string>();
  for (const record of records) {
    const previousSource = seenIds.get(record.id);
    if (previousSource) {
      throw new Error(
        `Duplicate content ID ${record.id}: ${previousSource} and ${record.sourcePath}`,
      );
    }
    seenIds.set(record.id, record.sourcePath);
  }
}

function validateThemeSchema(
  record: ContentRecord,
  schema: Readonly<Record<string, SchemaType>>,
): void {
  for (const [field, type] of Object.entries(schema)) {
    const value = recordValue(record, field);
    const optional = type.endsWith("?");
    const requiredType = optional ? type.slice(0, -1) : type;
    if (value === undefined && optional) {
      continue;
    }
    const valid =
      requiredType === "string[]"
        ? Array.isArray(value) &&
          value.every((item) => typeof item === "string")
        : typeof value === requiredType;
    if (!valid) {
      throw new Error(`${record.sourcePath}: ${field} must be ${type}`);
    }
  }
}

function matchesWhere(
  record: ContentRecord,
  where: Readonly<Record<string, WhereCondition>>,
): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = recordValue(record, field);
    if (typeof condition !== "object" || condition === null) {
      return Object.is(value, condition);
    }
    if ("not" in condition) {
      return !Object.is(value, condition.not);
    }
    if ("contains" in condition) {
      return (
        Array.isArray(value) &&
        value.some((item) => Object.is(item, condition.contains))
      );
    }
    return condition.exists ? value !== undefined : value === undefined;
  });
}

function validateWhereTypes(
  record: ContentRecord,
  where: Readonly<Record<string, WhereCondition>>,
): void {
  for (const [field, condition] of Object.entries(where)) {
    const value = recordValue(record, field);
    if (
      value === undefined ||
      (typeof condition === "object" &&
        condition !== null &&
        "exists" in condition)
    ) {
      continue;
    }
    const expected =
      typeof condition === "object" && condition !== null && "not" in condition
        ? condition.not
        : condition;
    if (
      typeof condition === "object" &&
      condition !== null &&
      "contains" in condition
    ) {
      if (!Array.isArray(value)) {
        throw new Error(
          `${record.sourcePath}: ${field} must be an array for contains`,
        );
      }
      const item = value.find((entry) => entry !== undefined);
      if (item !== undefined && typeof item !== typeof condition.contains) {
        throw new Error(
          `${record.sourcePath}: ${field} filter has an incompatible type`,
        );
      }
    } else if (typeof value !== typeof expected) {
      throw new Error(
        `${record.sourcePath}: ${field} filter has an incompatible type`,
      );
    }
  }
}

function compareRecords(
  left: ContentRecord,
  right: ContentRecord,
  orderBy: readonly {
    readonly field: string;
    readonly direction: "asc" | "desc";
  }[],
): number {
  for (const order of orderBy) {
    const result = compareValues(
      recordValue(left, order.field),
      recordValue(right, order.field),
    );
    if (result !== 0) {
      return order.direction === "desc" ? -result : result;
    }
  }
  return left.id.localeCompare(right.id);
}

function validateOrderTypes(
  records: readonly ContentRecord[],
  orderBy: readonly { readonly field: string }[],
): void {
  for (const order of orderBy) {
    let expectedType: string | undefined;
    for (const record of records) {
      const value = recordValue(record, order.field);
      if (value === undefined) {
        continue;
      }
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (
        !(["string", "number", "boolean"] as const).includes(
          actualType as "string" | "number" | "boolean",
        )
      ) {
        throw new Error(`${order.field} cannot be ordered as ${actualType}`);
      }
      if (expectedType === undefined) {
        expectedType = actualType;
      } else if (actualType !== expectedType) {
        throw new Error(
          `${order.field} has incompatible types ${expectedType} and ${actualType}`,
        );
      }
    }
  }
}

function recordValue(record: ContentRecord, field: string): unknown {
  if (field === "id") return record.id;
  if (field === "created") return record.created;
  return record.attributes[field];
}

function compareValues(left: unknown, right: unknown): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return compareStrings(left, right);
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  throw new Error("Ordered values must have compatible scalar types");
}

async function scanContentFiles(contentRoot: string): Promise<string[]> {
  const entries = await readdir(contentRoot, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.toLowerCase().endsWith(".md") ||
          entry.name.toLowerCase().endsWith(".mdx")),
    )
    .map((entry) =>
      normalizeSourcePath(
        relative(contentRoot, resolve(entry.parentPath, entry.name)),
      ),
    )
    .sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSourcePath(path: string): string {
  return path.replaceAll("\\", "/");
}
