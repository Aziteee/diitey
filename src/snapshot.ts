import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ComponentType } from "preact";
import type { Pluggable } from "unified";
import { buildContentRecord } from "./content.ts";
import { loadSiteExtensions } from "./extensions.ts";
import { buildPluginRuntime, type PluginRuntime } from "./plugins.ts";
import {
  buildThemeIslands,
  renderPageWithIslands,
  type BuiltIslands,
} from "./islands.ts";
import type {
  CollectionDefinition,
  ContentRecord,
  ItemBinding,
  ListBinding,
  RouteDefinition,
  SchemaType,
  PluginDefinition,
  ServiceBinding,
  WhereCondition,
} from "./index.ts";

export interface PublishedPage {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly dynamic?: {
    readonly pageName: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly services: readonly (readonly [string, ServiceBinding])[];
  };
  readonly pagination?: {
    readonly bodies: readonly string[];
    readonly emptyBody: string;
  };
}

export interface ContentSnapshot {
  readonly version: string;
  readonly publishedAt: string;
  readonly pages: readonly PublishedPage[];
  readonly islands: BuiltIslands;
  readonly contentIds: readonly string[];
}

export interface RouteContext {
  readonly definition: RouteDefinition;
  readonly bindings: readonly (
    readonly [string, ItemBinding | ListBinding | ServiceBinding]
  )[];
  readonly Page: ComponentType<Record<string, unknown>>;
}

export interface PublishingContext {
  readonly contentRoot: string;
  readonly collections: Readonly<Record<string, CollectionDefinition>>;
  readonly routes: readonly RouteContext[];
  readonly islands: BuiltIslands;
  readonly markdown: {
    readonly remarkPlugins: readonly Pluggable[];
    readonly rehypePlugins: readonly Pluggable[];
  };
  readonly plugins: PluginRuntime;
  readonly pluginDefinitions: readonly PluginDefinition[];
  readonly reloadTimeoutMs: number;
}

const defaultReloadTimeoutMs = 30_000;

export async function loadPublishingContext(root: string): Promise<PublishingContext> {
  const extensions = await loadSiteExtensions(root);
  const { config } = extensions;
  const themePath = extensions.theme.entryPath;
  const theme = extensions.theme.definition;
  const islands = await buildThemeIslands(themePath);
  const plugins = extensions.plugins.map((plugin) => plugin.definition);
  const pluginRuntime = buildPluginRuntime(plugins);
  if (theme.routes.length === 0) {
    throw new Error("Theme must declare at least one route");
  }
  validateRoutePatterns(theme.routes);

  const routes = await Promise.all(
    theme.routes.map(async (definition) => {
      const bindings = Object.entries(definition.page.data);
      if (bindings.length === 0) {
        throw new Error(`Theme page ${definition.page.name} must declare data`);
      }
      for (const [, binding] of bindings) {
        if (!("service" in binding) && !theme.collections[binding.collection]) {
          throw new Error(`Unknown collection: ${binding.collection}`);
        }
        if ("service" in binding && !pluginRuntime.services[binding.service]) {
          throw new Error(`Unknown plugin service: ${binding.service}`);
        }
      }
      if (bindings.filter(([, binding]) => "match" in binding).length > 1) {
        throw new Error(`Theme route ${definition.path} can declare only one item binding`);
      }
      const pagePath = resolve(
        themePath,
        "..",
        "pages",
        `${definition.page.name}.tsx`,
      );
      const Page = await importDefault<ComponentType<Record<string, unknown>>>(
        pagePath,
        `theme page ${definition.page.name}`,
      );
      return Object.freeze({
        definition,
        bindings: Object.freeze(bindings),
        Page,
      });
    }),
  );

  const reloadTimeoutMs = config.reload?.timeoutMs ?? defaultReloadTimeoutMs;
  if (!Number.isInteger(reloadTimeoutMs) || reloadTimeoutMs <= 0) {
    throw new Error("reload.timeoutMs must be a positive integer");
  }

  return Object.freeze({
    contentRoot: resolve(root, "content"),
    collections: theme.collections,
    routes: Object.freeze(routes),
    islands,
    markdown: Object.freeze({
      remarkPlugins: Object.freeze(
        plugins.flatMap((plugin) => plugin.markdown?.remarkPlugins ?? []),
      ),
      rehypePlugins: Object.freeze(
        plugins.flatMap((plugin) => plugin.markdown?.rehypePlugins ?? []),
      ),
    }),
    plugins: pluginRuntime,
    pluginDefinitions: Object.freeze(plugins),
    reloadTimeoutMs,
  });
}

export async function buildInitialSnapshot(
  context: PublishingContext,
): Promise<ContentSnapshot> {
  return buildContentSnapshot(context);
}

export async function buildContentSnapshot(
  context: PublishingContext,
  version: string = crypto.randomUUID(),
): Promise<ContentSnapshot> {
  const sourcePaths = await scanContentFiles(context.contentRoot);
  const records = await Promise.all(
    sourcePaths.map((sourcePath) =>
      buildContentRecord(
        resolve(context.contentRoot, ...sourcePath.split("/")),
        sourcePath,
        context.markdown,
      ),
    ),
  );
  return buildSnapshot(context, records, version);
}

export function buildSnapshot(
  context: PublishingContext,
  records: readonly ContentRecord[],
  version: string = crypto.randomUUID(),
): ContentSnapshot {
  validateUniqueContentIds(records);
  const selectedByCollection = selectCollections(context.collections, records);
  const canonicalUrls = buildCanonicalUrls(context.routes, selectedByCollection);
  const publishedByCollection = Object.fromEntries(
    Object.entries(selectedByCollection).map(([name, selected]) => [
      name,
      Object.freeze(
        selected.map((record) =>
          Object.freeze({
            ...record,
            url: canonicalUrls.get(record.id) ?? "",
            attributes: Object.freeze({ ...record.attributes }),
          }),
        ),
      ),
    ]),
  ) as Readonly<Record<string, readonly ContentRecord[]>>;

  const pages: PublishedPage[] = [];
  const seenUrls = new Map<string, string>();
  for (const route of context.routes) {
    const contentBindings = route.bindings.filter(
      (entry): entry is readonly [string, ItemBinding | ListBinding] =>
        !("service" in entry[1]),
    );
    const serviceBindings = route.bindings.filter(
      (entry): entry is readonly [string, ServiceBinding] =>
        "service" in entry[1],
    );
    const itemEntry = contentBindings.find(([, binding]) => "match" in binding) as
      | readonly [string, ItemBinding]
      | undefined;
    if (itemEntry) {
      const [itemName, itemBinding] = itemEntry;
      for (const item of publishedByCollection[itemBinding.collection] ?? []) {
        const parameters = matchPathPattern(itemBinding.match, item.sourcePath);
        if (!parameters) {
          continue;
        }
        const path = buildRoutePath(route.definition.path, parameters);
        const data = buildPageData(contentBindings, publishedByCollection, {
          name: itemName,
          item,
        });
        addPage(
          pages,
          seenUrls,
          Object.freeze({
            path,
            title:
              typeof item.attributes.title === "string"
                ? item.attributes.title
                : "Diitey",
            body: renderPageWithIslands(
              route.Page,
              serviceBindings.length === 0
                ? data
                : { ...data, ...emptyServiceData(serviceBindings) },
              context.islands,
            ),
            ...(serviceBindings.length === 0
              ? {}
              : {
                  dynamic: Object.freeze({
                    pageName: route.definition.page.name,
                    data: Object.freeze(data),
                    services: Object.freeze(serviceBindings),
                  }),
                }),
          }),
          item.sourcePath,
        );
      }
      continue;
    }

    if (route.definition.path.includes(":")) {
      throw new Error(
        `Route ${route.definition.path} has parameters but no item binding`,
      );
    }
    const page = buildCollectionPage(
      route,
      publishedByCollection,
      context.islands,
    );
    addPage(pages, seenUrls, page, `theme route ${route.definition.path}`);
  }

  return Object.freeze({
    version,
    publishedAt: new Date().toISOString(),
    pages: Object.freeze(pages),
    islands: context.islands,
    contentIds: Object.freeze(records.map((record) => record.id)),
  });
}

function selectCollections(
  definitions: Readonly<Record<string, CollectionDefinition>>,
  records: readonly ContentRecord[],
): Readonly<Record<string, readonly ContentRecord[]>> {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      const selected = records
        .filter((record) => matchesGlob(definition.from, record.sourcePath))
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

function buildCanonicalUrls(
  routes: readonly RouteContext[],
  collections: Readonly<Record<string, readonly ContentRecord[]>>,
): ReadonlyMap<string, string> {
  const candidates = new Map<
    string,
    { readonly path: string; readonly canonical: boolean }[]
  >();
  const seenUrls = new Map<string, string>();
  for (const route of routes) {
    const itemEntry = route.bindings.find(([, binding]) => "match" in binding) as
      | readonly [string, ItemBinding]
      | undefined;
    if (!itemEntry) {
      continue;
    }
    const binding = itemEntry[1];
    for (const record of collections[binding.collection] ?? []) {
      const parameters = matchPathPattern(binding.match, record.sourcePath);
      if (!parameters) {
        continue;
      }
      const path = buildRoutePath(route.definition.path, parameters);
      const previousSource = seenUrls.get(path);
      if (previousSource) {
        throw new Error(
          `Duplicate URL ${path}: ${previousSource} and ${record.sourcePath}`,
        );
      }
      seenUrls.set(path, record.sourcePath);
      const recordCandidates = candidates.get(record.id) ?? [];
      recordCandidates.push({ path, canonical: route.definition.canonical });
      candidates.set(record.id, recordCandidates);
    }
  }

  return new Map(
    [...candidates].map(([id, urls]) => {
      if (urls.length === 1) {
        return [id, urls[0]!.path];
      }
      const canonical = urls.filter((candidate) => candidate.canonical);
      if (canonical.length !== 1) {
        throw new Error(
          `Content ID ${id} has multiple URLs and must declare exactly one canonical route`,
        );
      }
      return [id, canonical[0]!.path];
    }),
  );
}

function buildCollectionPage(
  route: RouteContext,
  collections: Readonly<Record<string, readonly ContentRecord[]>>,
  islands: BuiltIslands,
): PublishedPage {
  const contentBindings = route.bindings.filter(
    (entry): entry is readonly [string, ItemBinding | ListBinding] =>
      !("service" in entry[1]),
  );
  const serviceBindings = route.bindings.filter(
    (entry): entry is readonly [string, ServiceBinding] =>
      "service" in entry[1],
  );
  const paginated = contentBindings.filter(
    ([, binding]) => !("match" in binding) && binding.paginate !== undefined,
  ) as readonly (readonly [string, ListBinding])[];
  if (paginated.length > 1) {
    throw new Error(
      `Theme route ${route.definition.path} can paginate only one binding`,
    );
  }
  const paginatedEntry = paginated[0];
  const path = normalizeRoutePath(route.definition.path);
  if (!paginatedEntry) {
    const data = buildPageData(contentBindings, collections);
    return Object.freeze({
      path,
      title: "Diitey",
      body: renderPageWithIslands(
        route.Page,
        serviceBindings.length === 0
          ? data
          : { ...data, ...emptyServiceData(serviceBindings) },
        islands,
      ),
      ...(serviceBindings.length === 0
        ? {}
        : {
            dynamic: Object.freeze({
              pageName: route.definition.page.name,
              data: Object.freeze(data),
              services: Object.freeze(serviceBindings),
            }),
          }),
    });
  }

  if (serviceBindings.length > 0) {
    throw new Error(
      `Theme route ${route.definition.path} cannot combine pagination and plugin services`,
    );
  }

  const [bindingName, binding] = paginatedEntry;
  const pageSize = binding.paginate;
  if (
    pageSize === undefined ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0
  ) {
    throw new Error("paginate must be a positive integer");
  }
  const selected = applyLimit(collections[binding.collection] ?? [], binding.limit);
  const renderPage = (items: readonly ContentRecord[]) =>
    renderPageWithIslands(
      route.Page,
      buildPageData(contentBindings, collections, {
        name: bindingName,
        items,
      }),
      islands,
    );
  const bodies = Array.from(
    { length: Math.ceil(selected.length / pageSize) },
    (_, index) =>
      renderPage(selected.slice(index * pageSize, (index + 1) * pageSize)),
  );
  const emptyBody = renderPage([]);
  return Object.freeze({
    path,
    title: "Diitey",
    body: bodies[0] ?? emptyBody,
    pagination: Object.freeze({
      bodies: Object.freeze(bodies),
      emptyBody,
    }),
  });
}

function emptyServiceData(
  bindings: readonly (readonly [string, ServiceBinding])[],
): Record<string, unknown> {
  return Object.fromEntries(bindings.map(([name]) => [name, []]));
}

function buildPageData(
  bindings: readonly (readonly [string, ItemBinding | ListBinding])[],
  collections: Readonly<Record<string, readonly ContentRecord[]>>,
  override?:
    | { readonly name: string; readonly item: ContentRecord }
    | { readonly name: string; readonly items: readonly ContentRecord[] },
): Record<string, unknown> {
  return Object.fromEntries(
    bindings.map(([name, binding]) => {
      if (override?.name === name) {
        return [name, "item" in override ? override.item : override.items];
      }
      if ("match" in binding) {
        throw new Error(`Item binding ${name} has no matched content record`);
      }
      return [
        name,
        applyLimit(collections[binding.collection] ?? [], binding.limit),
      ];
    }),
  );
}

function applyLimit(
  records: readonly ContentRecord[],
  limit: number | undefined,
): readonly ContentRecord[] {
  if (limit === undefined) {
    return records;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return records.slice(0, limit);
}

function addPage(
  pages: PublishedPage[],
  seenUrls: Map<string, string>,
  page: PublishedPage,
  source: string,
): void {
  const previousSource = seenUrls.get(page.path);
  if (previousSource) {
    throw new Error(`Duplicate URL ${page.path}: ${previousSource} and ${source}`);
  }
  seenUrls.set(page.path, source);
  pages.push(page);
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
    if (value === undefined || (typeof condition === "object" && condition !== null && "exists" in condition)) {
      continue;
    }
    const expected =
      typeof condition === "object" && condition !== null && "not" in condition
        ? condition.not
        : condition;
    if (typeof condition === "object" && condition !== null && "contains" in condition) {
      if (!Array.isArray(value)) {
        throw new Error(`${record.sourcePath}: ${field} must be an array for contains`);
      }
      const item = value.find((entry) => entry !== undefined);
      if (item !== undefined && typeof item !== typeof condition.contains) {
        throw new Error(`${record.sourcePath}: ${field} filter has an incompatible type`);
      }
    } else if (typeof value !== typeof expected) {
      throw new Error(`${record.sourcePath}: ${field} filter has an incompatible type`);
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
      if (!(["string", "number", "boolean"] as const).includes(actualType as "string" | "number" | "boolean")) {
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
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
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

function matchesGlob(pattern: string, sourcePath: string): boolean {
  const expression = escapeRegExp(normalizeSourcePath(pattern))
    .replaceAll("\\*\\*/", "(?:.*/)?")
    .replaceAll("\\*\\*", ".*")
    .replaceAll("\\*", "[^/]*");
  return new RegExp(`^${expression}$`).test(normalizeSourcePath(sourcePath));
}

function matchPathPattern(
  pattern: string,
  sourcePath: string,
): Record<string, string> | null {
  const names: string[] = [];
  const expression = normalizeSourcePath(pattern)
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const suffixIndex = segment.indexOf(".");
        const name = segment.slice(
          1,
          suffixIndex < 0 ? undefined : suffixIndex,
        );
        const suffix =
          suffixIndex < 0 ? "" : escapeRegExp(segment.slice(suffixIndex));
        names.push(name);
        return `([^/]+)${suffix}`;
      }
      return escapeRegExp(segment).replaceAll("\\*", "[^/]*");
    })
    .join("/");
  const match = new RegExp(`^${expression}$`).exec(
    normalizeSourcePath(sourcePath),
  );
  if (!match) {
    return null;
  }
  return Object.fromEntries(
    names.map((name, index) => [name, match[index + 1] ?? ""]),
  );
}

function buildRoutePath(
  pattern: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const path = pattern.replace(/:([^/]+)/g, (_, name: string) => {
    const value = parameters[name];
    if (value === undefined) {
      throw new Error(`Route parameter :${name} cannot be generated`);
    }
    return encodeURIComponent(value);
  });
  return normalizeRoutePath(path);
}

function normalizeRoutePath(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

function validateRoutePatterns(routes: readonly RouteDefinition[]): void {
  const seen = new Map<string, string>();
  for (const route of routes) {
    const normalized = normalizeRoutePath(route.path);
    if (!normalized.startsWith("/")) {
      throw new Error(`Route path must start with /: ${route.path}`);
    }
    if (normalized === "/assets" || normalized.startsWith("/assets/")) {
      throw new Error(`Theme route cannot use reserved path ${route.path}`);
    }
    const shape = normalized
      .split("/")
      .map((segment) => (segment.startsWith(":") ? ":" : segment))
      .join("/");
    const previous = seen.get(shape);
    if (previous) {
      throw new Error(`Ambiguous route patterns ${previous} and ${route.path}`);
    }
    seen.set(shape, route.path);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function importDefault<T>(filePath: string, label: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as {
    default?: T;
  };
  if (!module.default) {
    throw new Error(`Missing default export from ${label}`);
  }
  return module.default;
}
