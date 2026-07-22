import type { ComponentType } from "preact";
import type { Database } from "bun:sqlite";
import type {
  ContentRecord,
  ItemBinding,
  ListBinding,
  Pagination,
  ServiceBinding,
} from "../index.ts";
import {
  renderPageWithIslands,
  type BuiltIslands,
  type ThemeDocumentComponent,
} from "../islands.ts";
import { runWithTimeout } from "../plugin-invoke.ts";
import {
  callPluginService,
  createContentLookup,
  type PluginRuntime,
} from "../plugins.ts";
import {
  emptyThemeStyles,
  type BuiltThemeStyles,
} from "../styles.ts";
import type { Logger } from "../logger.ts";
import type { ContentSnapshot } from "./content-snapshot.ts";
import { normalizeRoutePath } from "./route-pattern.ts";

export interface RequestRuntime {
  readonly pluginRuntime: PluginRuntime;
  readonly pluginDatabase: Database;
  readonly logger: Logger;
  readonly islands: BuiltIslands;
  readonly styles: BuiltThemeStyles;
  readonly contentIds: ReadonlySet<string>;
  readonly contentById: ReadonlyMap<string, ContentRecord>;
}

export interface PublishedRouteEntry {
  readonly path: string;
  readonly title: string;
  readonly planId: string;
  readonly publishData: Readonly<Record<string, unknown>>;
  readonly body?: string;
  readonly pagination?: {
    readonly pageSize: number;
    readonly bindingName: string;
    readonly items: readonly ContentRecord[];
    readonly bodies?: readonly string[];
  };
}

export interface CompiledPagePlan {
  readonly id: string;
  readonly pageName: string;
  readonly pathPattern: string;
  publish(
    snapshot: ContentSnapshot,
    resolvedItems?: readonly {
      readonly path: string;
      readonly item: ContentRecord;
    }[],
  ): readonly PublishedRouteEntry[];
  render(
    entry: PublishedRouteEntry,
    request: Request,
    runtime: RequestRuntime,
  ): Promise<string>;
}

type ContentBinding = ItemBinding | ListBinding;

export interface ServicePlan {
  readonly name: string;
  readonly service: string;
  readonly literals: Readonly<Record<string, unknown>>;
  readonly refs: readonly {
    readonly key: string;
    readonly path: string;
    readonly root: string;
  }[];
  readonly dependsOn: ReadonlySet<string>;
}

export interface CompiledBinding {
  readonly name: string;
  readonly kind: "item" | "list" | "service";
  readonly content?: ContentBinding;
  readonly service?: ServicePlan;
}

export interface PagePlanStages {
  readonly bindings: readonly CompiledBinding[];
  readonly itemBinding?: CompiledBinding;
  readonly paginatedBinding?: CompiledBinding;
  readonly servicePlans: readonly ServicePlan[];
  readonly hasServices: boolean;
}

const emptyIslands: BuiltIslands = Object.freeze({
  manifest: Object.freeze({}),
  assets: Object.freeze([]),
  runtimePath: "/assets/islands/hydrate.js",
});

export function compilePageBindings(options: {
  readonly pathPattern: string;
  readonly pageName: string;
  readonly data: Readonly<
    Record<string, ItemBinding | ListBinding | ServiceBinding>
  >;
  readonly pluginRuntime?: PluginRuntime;
}): PagePlanStages {
  const pluginRuntime: PluginRuntime = options.pluginRuntime ?? {
    services: Object.freeze({}),
    serviceOwners: Object.freeze({}),
    actions: Object.freeze({}),
    adminActions: Object.freeze({}),
  };
  const bindings = Object.entries(options.data);
  const isNotFound = options.pathPattern === "*";
  if (bindings.length === 0 && !isNotFound) {
    throw new Error(`Theme page ${options.pageName} must declare data`);
  }
  if (isNotFound && bindings.length > 0) {
    throw new Error(
      `Not-found route * cannot declare data bindings (page ${options.pageName})`,
    );
  }

  const compiled: CompiledBinding[] = bindings.map(([name, binding]) => {
    if ("service" in binding) {
      if (!pluginRuntime.services[binding.service]) {
        throw new Error(`Unknown plugin service: ${binding.service}`);
      }
      return {
        name,
        kind: "service",
        service: compileServicePlan(name, binding, options.pageName),
      };
    }
    if ("match" in binding) {
      return { name, kind: "item", content: binding };
    }
    return { name, kind: "list", content: binding };
  });

  const itemBindings = compiled.filter((binding) => binding.kind === "item");
  if (itemBindings.length > 1) {
    throw new Error(
      `Theme route ${options.pathPattern} can declare only one item binding`,
    );
  }
  const listBindings = compiled.filter((binding) => binding.kind === "list");
  const paginated = listBindings.filter(
    (binding) =>
      binding.content &&
      "paginate" in binding.content &&
      binding.content.paginate !== undefined,
  );
  if (paginated.length > 1) {
    throw new Error(
      `Theme route ${options.pathPattern} can paginate only one binding`,
    );
  }

  const serviceBindings = compiled.filter(
    (binding) => binding.kind === "service",
  );
  const servicePlans = serviceBindings.map((binding) => binding.service!);
  validateServiceDependencies(options.pageName, compiled, servicePlans);

  const itemBinding = itemBindings[0];
  const isStaticPath =
    isNotFound || !options.pathPattern.includes(":");
  if (itemBinding === undefined && !isStaticPath) {
    throw new Error(
      `Route ${options.pathPattern} has parameters but no item binding`,
    );
  }

  return Object.freeze({
    bindings: Object.freeze(compiled),
    itemBinding,
    paginatedBinding: paginated[0],
    servicePlans: Object.freeze(servicePlans),
    hasServices: servicePlans.length > 0,
  });
}

export function publishPageEntries(options: {
  readonly planId: string;
  readonly pathPattern: string;
  readonly stages: PagePlanStages;
  readonly snapshot: ContentSnapshot;
  readonly resolvedItems?: readonly {
    readonly path: string;
    readonly item: ContentRecord;
  }[];
  readonly renderThemePage?: (
    data: Record<string, unknown>,
    title: string,
  ) => string;
}): readonly PublishedRouteEntry[] {
  const {
    planId,
    pathPattern,
    stages,
    snapshot,
    resolvedItems,
    renderThemePage,
  } = options;
  const { bindings, itemBinding, paginatedBinding, hasServices } = stages;

  if (pathPattern === "*") {
    return Object.freeze([]);
  }

  if (itemBinding?.content && "match" in itemBinding.content) {
    const itemName = itemBinding.name;
    const entries: PublishedRouteEntry[] = [];
    for (const { path, item } of resolvedItems ?? []) {
      const publishData = buildContentData(bindings, snapshot, {
        name: itemName,
        item,
      });
      const title =
        typeof item.attributes.title === "string"
          ? item.attributes.title
          : "Diitey";
      if (hasServices || !renderThemePage) {
        entries.push(
          Object.freeze({
            path,
            title,
            planId,
            publishData: Object.freeze(publishData),
          }),
        );
      } else {
        entries.push(
          Object.freeze({
            path,
            title,
            planId,
            publishData: Object.freeze(publishData),
            body: renderThemePage(publishData, title),
          }),
        );
      }
    }
    return Object.freeze(entries);
  }

  const path = normalizeRoutePath(pathPattern);
  const publishData = buildContentData(bindings, snapshot);
  if (paginatedBinding?.content && "paginate" in paginatedBinding.content) {
    const pageSize = paginatedBinding.content.paginate;
    if (
      pageSize === undefined ||
      !Number.isInteger(pageSize) ||
      pageSize <= 0
    ) {
      throw new Error("paginate must be a positive integer");
    }
    const listBinding = paginatedBinding.content;
    const selected = applyLimit(
      snapshot.byCollection[listBinding.collection] ?? [],
      listBinding.limit,
    );
    if (hasServices || !renderThemePage) {
      return Object.freeze([
        Object.freeze({
          path,
          title: "Diitey",
          planId,
          publishData: Object.freeze(publishData),
          pagination: Object.freeze({
            pageSize,
            bindingName: paginatedBinding.name,
            items: Object.freeze(selected),
          }),
        }),
      ]);
    }
    const renderItemsPage = (
      items: readonly ContentRecord[],
      pageNumber: number,
    ) =>
      renderThemePage(
        {
          ...publishData,
          [paginatedBinding.name]: items,
          pagination: buildPagination(
            path,
            pageNumber,
            pageSize,
            selected.length,
          ),
        },
        "Diitey",
      );
    const totalPages = Math.ceil(selected.length / pageSize);
    const bodies = Array.from({ length: totalPages }, (_, index) =>
      renderItemsPage(
        selected.slice(index * pageSize, (index + 1) * pageSize),
        index + 1,
      ),
    );
    return Object.freeze([
      Object.freeze({
        path,
        title: "Diitey",
        planId,
        publishData: Object.freeze(publishData),
        body: bodies[0] ?? renderItemsPage([], 1),
        pagination: Object.freeze({
          pageSize,
          bindingName: paginatedBinding.name,
          items: Object.freeze(selected),
          bodies: Object.freeze(bodies),
        }),
      }),
    ]);
  }

  if (hasServices || !renderThemePage) {
    return Object.freeze([
      Object.freeze({
        path,
        title: "Diitey",
        planId,
        publishData: Object.freeze(publishData),
      }),
    ]);
  }

  return Object.freeze([
    Object.freeze({
      path,
      title: "Diitey",
      planId,
      publishData: Object.freeze(publishData),
      body: renderThemePage(publishData, "Diitey"),
    }),
  ]);
}

export function compilePagePlan(options: {
  readonly id: string;
  readonly pathPattern: string;
  readonly pageName: string;
  readonly Page: ComponentType<Record<string, unknown>>;
  readonly Document?: ThemeDocumentComponent;
  readonly data: Readonly<
    Record<string, ItemBinding | ListBinding | ServiceBinding>
  >;
  readonly pluginRuntime: PluginRuntime;
  readonly islands?: BuiltIslands;
  readonly styles?: BuiltThemeStyles;
  readonly themeConfig?: unknown;
}): CompiledPagePlan {
  const islands = options.islands ?? emptyIslands;
  const styles = options.styles ?? emptyThemeStyles;
  const themeConfig = options.themeConfig;
  const stages = compilePageBindings({
    pathPattern: options.pathPattern,
    pageName: options.pageName,
    data: options.data,
    pluginRuntime: options.pluginRuntime,
  });
  const { hasServices, servicePlans } = stages;
  const renderThemePage = (
    data: Record<string, unknown>,
    title: string,
    requestIslands: BuiltIslands = islands,
    requestStyles: BuiltThemeStyles = styles,
  ): string =>
    renderPageWithIslands(options.Page, data, requestIslands, themeConfig, {
      Document: options.Document,
      title,
      stylesheetPath: requestStyles.stylesheetPath,
    });

  return Object.freeze({
    id: options.id,
    pageName: options.pageName,
    pathPattern: options.pathPattern,
    publish(
      snapshot: ContentSnapshot,
      resolvedItems?: readonly {
        readonly path: string;
        readonly item: ContentRecord;
      }[],
    ): readonly PublishedRouteEntry[] {
      return publishPageEntries({
        planId: options.id,
        pathPattern: options.pathPattern,
        stages,
        snapshot,
        resolvedItems,
        renderThemePage: (data, title) => renderThemePage(data, title),
      });
    },
    async render(
      entry: PublishedRouteEntry,
      request: Request,
      runtime: RequestRuntime,
    ): Promise<string> {
      const url = new URL(request.url);
      let data: Record<string, unknown> = { ...entry.publishData };

      if (entry.pagination) {
        const values = url.searchParams.getAll("page");
        const value = values[0] ?? "1";
        if (values.length > 1 || !/^[1-9]\d*$/.test(value)) {
          throw new PageRequestError("Invalid page", 400);
        }
        const pageNumber = Number(value);
        if (!Number.isSafeInteger(pageNumber)) {
          throw new PageRequestError("Invalid page", 400);
        }
        if (entry.pagination.bodies) {
          const body = entry.pagination.bodies[pageNumber - 1];
          if (body !== undefined) {
            return body;
          }
          return renderThemePage(
            {
              ...entry.publishData,
              [entry.pagination.bindingName]: [],
              pagination: buildPagination(
                entry.path,
                pageNumber,
                entry.pagination.pageSize,
                entry.pagination.items.length,
              ),
            },
            entry.title,
            runtime.islands,
            runtime.styles,
          );
        }
        const start = (pageNumber - 1) * entry.pagination.pageSize;
        const pageItems =
          start >= entry.pagination.items.length
            ? []
            : entry.pagination.items.slice(
                start,
                start + entry.pagination.pageSize,
              );
        data = {
          ...data,
          [entry.pagination.bindingName]: pageItems,
          pagination: buildPagination(
            entry.path,
            pageNumber,
            entry.pagination.pageSize,
            entry.pagination.items.length,
          ),
        };
      } else if (entry.body !== undefined && !hasServices) {
        return entry.body;
      }

      if (hasServices) {
        const serviceData = await resolveServices(servicePlans, data, runtime);
        data = { ...data, ...serviceData };
      }

      return renderThemePage(data, entry.title, runtime.islands, runtime.styles);
    },
  });
}

export class PageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function buildPagination(
  path: string,
  page: number,
  pageSize: number,
  totalItems: number,
): Pagination {
  const totalPages = Math.ceil(totalItems / pageSize);
  return Object.freeze({
    page,
    pageSize,
    totalItems,
    totalPages,
    prevHref: page > 1 ? pageHref(path, page - 1) : null,
    nextHref: page < totalPages ? pageHref(path, page + 1) : null,
  });
}

function pageHref(path: string, page: number): string {
  return page <= 1 ? path : `${path}?page=${page}`;
}

function compileServicePlan(
  name: string,
  binding: ServiceBinding,
  pageName: string,
): ServicePlan {
  const literals: Record<string, unknown> = Object.create(null);
  const refs: { key: string; path: string; root: string }[] = [];
  const dependsOn = new Set<string>();
  for (const [key, value] of Object.entries(binding.input)) {
    if (isDataReference(value)) {
      const root = value.from.split(".")[0] ?? value.from;
      if (root === name) {
        throw new Error(
          `Page ${pageName} service ${name} cannot reference itself via ${value.from}`,
        );
      }
      refs.push({ key, path: value.from, root });
      dependsOn.add(root);
    } else {
      literals[key] = value;
    }
  }
  return Object.freeze({
    name,
    service: binding.service,
    literals: Object.freeze(literals),
    refs: Object.freeze(refs),
    dependsOn: Object.freeze(dependsOn),
  });
}

function validateServiceDependencies(
  pageName: string,
  bindings: readonly CompiledBinding[],
  services: readonly ServicePlan[],
): void {
  const known = new Set(bindings.map((binding) => binding.name));
  for (const service of services) {
    for (const root of service.dependsOn) {
      if (!known.has(root)) {
        throw new Error(
          `Page ${pageName} service ${service.name} references missing data ${root}`,
        );
      }
    }
  }

  const serviceNames = new Set(services.map((service) => service.name));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string, stack: string[]): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `Page ${pageName} has cyclic service data references: ${[...stack, name].join(" -> ")}`,
      );
    }
    visiting.add(name);
    const service = services.find((candidate) => candidate.name === name);
    if (service) {
      for (const dep of service.dependsOn) {
        if (serviceNames.has(dep)) {
          visit(dep, [...stack, name]);
        }
      }
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const service of services) {
    visit(service.name, []);
  }
}

function buildContentData(
  bindings: readonly CompiledBinding[],
  snapshot: ContentSnapshot,
  override?:
    | { readonly name: string; readonly item: ContentRecord }
    | { readonly name: string; readonly items: readonly ContentRecord[] },
): Record<string, unknown> {
  const data: Record<string, unknown> = Object.create(null);
  for (const binding of bindings) {
    if (binding.kind === "service") continue;
    if (override?.name === binding.name) {
      data[binding.name] = "item" in override ? override.item : override.items;
      continue;
    }
    if (binding.kind === "item") {
      throw new Error(
        `Item binding ${binding.name} has no matched content record`,
      );
    }
    const list = binding.content as ListBinding;
    data[binding.name] = applyLimit(
      snapshot.byCollection[list.collection] ?? [],
      list.limit,
    );
  }
  return data;
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

async function resolveServices(
  services: readonly ServicePlan[],
  pageData: Readonly<Record<string, unknown>>,
  runtime: RequestRuntime,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = Object.create(null);
  const remaining = new Map(services.map((service) => [service.name, service]));

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((service) =>
      [...service.dependsOn].every(
        (dep) =>
          Object.prototype.hasOwnProperty.call(pageData, dep) ||
          Object.prototype.hasOwnProperty.call(resolved, dep),
      ),
    );
    if (ready.length === 0) {
      throw new Error(
        `Unable to resolve plugin services: ${[...remaining.keys()].join(", ")}`,
      );
    }
    const results = await Promise.all(
      ready.map(async (service) => {
        const input: Record<string, unknown> = { ...service.literals };
        for (const ref of service.refs) {
          input[ref.key] = readDataPath(
            { ...pageData, ...resolved },
            ref.path,
          );
        }
        const output = await runWithTimeout(5_000, (signal) =>
          callPluginService(
            runtime.pluginRuntime,
            service.service,
            input,
            runtime.pluginDatabase,
            createContentLookup(runtime.contentById),
            signal,
            runtime.logger,
          ),
        );
        return [service.name, output] as const;
      }),
    );
    for (const [name, output] of results) {
      resolved[name] = output;
      remaining.delete(name);
    }
  }
  return resolved;
}

function isDataReference(value: unknown): value is { readonly from: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { from?: unknown }).from === "string"
  );
}

function readDataPath(
  data: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  let value: unknown = data;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null || !(segment in value)) {
      throw new Error(`Service input reference ${path} does not exist`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
