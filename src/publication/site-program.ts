import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "preact";
import type { Pluggable } from "unified";
import { loadSiteExtensions } from "../extensions.ts";
import {
  buildThemeIslands,
  type BuiltIslands,
} from "../islands.ts";
import type {
  CollectionDefinition,
  PluginDefinition,
  RouteDefinition,
} from "../index.ts";
import { buildPluginRuntime, type PluginRuntime } from "../plugins.ts";
import {
  compileCollectionMatchers,
  normalizeRoutePath,
  type ItemRouteSpec,
} from "./content-snapshot.ts";
import { compilePagePlan, type CompiledPagePlan } from "./page-plan.ts";

export interface SiteProgram {
  readonly root: string;
  readonly contentRoot: string;
  readonly programRevision: string;
  readonly collections: Readonly<Record<string, CollectionDefinition>>;
  readonly collectionMatchers: Readonly<
    Record<string, (sourcePath: string) => boolean>
  >;
  readonly itemRoutes: readonly ItemRouteSpec[];
  readonly pagePlans: readonly CompiledPagePlan[];
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

export async function compileSiteProgram(
  root: string,
  programRevision: string = crypto.randomUUID(),
): Promise<SiteProgram> {
  const extensions = await loadSiteExtensions(root);
  const { config } = extensions;
  const themePath = extensions.theme.entryPath;
  const theme = extensions.theme.definition;
  const collectionMatchers = compileCollectionMatchers(theme.collections);
  const islands = await buildThemeIslands(themePath);
  const plugins = extensions.plugins.map((plugin) => plugin.definition);
  const pluginRuntime = buildPluginRuntime(plugins);
  if (theme.routes.length === 0) {
    throw new Error("Theme must declare at least one route");
  }
  validateRoutePatterns(theme.routes);

  for (const definition of theme.routes) {
    for (const [, binding] of Object.entries(definition.page.data)) {
      if (!("service" in binding) && !theme.collections[binding.collection]) {
        throw new Error(`Unknown collection: ${binding.collection}`);
      }
    }
  }

  const pagePlans = await Promise.all(
    theme.routes.map(async (definition, index) => {
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
      return compilePagePlan({
        id: `${definition.page.name}:${index}:${definition.path}`,
        pathPattern: definition.path,
        pageName: definition.page.name,
        Page,
        data: definition.page.data,
        pluginRuntime,
        islands,
      });
    }),
  );

  const itemRoutes: ItemRouteSpec[] = [];
  for (const definition of theme.routes) {
    for (const [, binding] of Object.entries(definition.page.data)) {
      if ("match" in binding) {
        itemRoutes.push(
          Object.freeze({
            path: definition.path,
            collection: binding.collection,
            match: binding.match,
            canonical: definition.canonical,
          }),
        );
      }
    }
  }

  const reloadTimeoutMs = config.reload?.timeoutMs ?? defaultReloadTimeoutMs;

  return Object.freeze({
    root,
    contentRoot: resolve(root, "content"),
    programRevision,
    collections: theme.collections,
    collectionMatchers,
    itemRoutes: Object.freeze(itemRoutes),
    pagePlans: Object.freeze(pagePlans),
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

async function importDefault<T>(filePath: string, label: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as {
    default?: T;
  };
  if (!module.default) {
    throw new Error(`Missing default export from ${label}`);
  }
  return module.default;
}
