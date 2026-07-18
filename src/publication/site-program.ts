import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "preact";
import type { Pluggable } from "unified";
import { loadSiteExtensions } from "../extensions.ts";
import {
  buildThemeIslands,
  type BuiltIslands,
  type ThemeDocumentComponent,
} from "../islands.ts";
import type {
  CollectionDefinition,
  MarkdownBodyTransform,
  PluginDefinition,
} from "../index.ts";
import { buildPluginRuntime, type PluginRuntime } from "../plugins.ts";
import { buildThemeStyles } from "../styles-build.ts";
import type { BuiltThemeStyles } from "../styles.ts";
import {
  compileCollectionMatchers,
  type ItemRouteSpec,
  validateRoutePatterns,
} from "./route-pattern.ts";
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
  readonly styles: BuiltThemeStyles;
  readonly usesDocument: boolean;
  readonly markdown: {
    readonly remarkPlugins: readonly Pluggable[];
    readonly rehypePlugins: readonly Pluggable[];
    readonly bodyTransforms: readonly MarkdownBodyTransform[];
  };
  readonly plugins: PluginRuntime;
  readonly pluginDefinitions: readonly PluginDefinition[];
  readonly pluginEntries: readonly {
    readonly definition: PluginDefinition;
    readonly entryPath: string;
  }[];
  readonly reloadTimeoutMs: number;
}

const defaultReloadTimeoutMs = 30_000;

export async function compileSiteProgram(
  root: string,
  programRevision: string = crypto.randomUUID(),
  options: {
    readonly islands?: BuiltIslands;
    readonly styles?: BuiltThemeStyles;
  } = {},
): Promise<SiteProgram> {
  const extensions = await loadSiteExtensions(root);
  const { config } = extensions;
  const themePath = extensions.theme.entryPath;
  const theme = extensions.theme.definition;
  const collectionMatchers = compileCollectionMatchers(theme.collections);
  const islands =
    options.islands ?? (await buildThemeIslands(themePath));
  const styles =
    options.styles ??
    (await buildThemeStyles(themePath, theme.styles, root));
  const plugins = extensions.plugins.map((plugin) => plugin.definition);
  const pluginEntries = extensions.plugins.map((plugin) =>
    Object.freeze({
      definition: plugin.definition,
      entryPath: plugin.entryPath,
    }),
  );
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

  const Document = theme.document
    ? await importDefault<ThemeDocumentComponent>(
        resolve(themePath, "..", "pages", `${theme.document}.tsx`),
        `theme document ${theme.document}`,
      )
    : undefined;

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
        Document,
        data: definition.page.data,
        pluginRuntime,
        islands,
        styles,
        themeConfig: extensions.theme.config,
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
  const contentRoot = await resolveContentRoot(root, config.contentDir);

  return Object.freeze({
    root,
    contentRoot,
    programRevision,
    collections: theme.collections,
    collectionMatchers,
    itemRoutes: Object.freeze(itemRoutes),
    pagePlans: Object.freeze(pagePlans),
    islands,
    styles,
    usesDocument: Document !== undefined,
    markdown: Object.freeze({
      remarkPlugins: Object.freeze(
        plugins.flatMap((plugin) => plugin.markdown?.remarkPlugins ?? []),
      ),
      rehypePlugins: Object.freeze(
        plugins.flatMap((plugin) => plugin.markdown?.rehypePlugins ?? []),
      ),
      bodyTransforms: Object.freeze(
        plugins.flatMap((plugin) => plugin.markdown?.bodyTransforms ?? []),
      ),
    }),
    plugins: pluginRuntime,
    pluginDefinitions: Object.freeze(plugins),
    pluginEntries: Object.freeze(pluginEntries),
    reloadTimeoutMs,
  });
}

async function resolveContentRoot(
  siteRoot: string,
  contentDir: string | undefined,
): Promise<string> {
  const declared = contentDir ?? "content";
  if (declared.trim() === "") {
    throw new Error("contentDir must be a non-empty path");
  }
  const contentRoot = isAbsolute(declared)
    ? resolve(declared)
    : resolve(siteRoot, declared);
  let info;
  try {
    info = await stat(contentRoot);
  } catch {
    throw new Error(
      `content directory does not exist: ${contentRoot} (contentDir: ${JSON.stringify(declared)})`,
    );
  }
  if (!info.isDirectory()) {
    throw new Error(
      `content directory is not a directory: ${contentRoot} (contentDir: ${JSON.stringify(declared)})`,
    );
  }
  return realpath(contentRoot);
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
