import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "preact";
import type { PluginDefinition } from "../index.ts";
import {
  buildPluginAdminIslands,
  type BuiltIslands,
} from "../islands.ts";
import { buildStyles } from "../styles-build.ts";
import {
  emptyThemeStyles,
  type BuiltThemeStyles,
} from "../styles.ts";

export interface AdminPluginPage {
  readonly pluginId: string;
  readonly title: string;
  readonly componentPath: string;
  readonly Component: ComponentType<Record<string, unknown>>;
  readonly dataService: string | null;
  readonly islandName: string;
  readonly stylesheetPath: string | null;
}

export interface AdminProgram {
  readonly enabled: boolean;
  readonly pages: readonly AdminPluginPage[];
  readonly islands: BuiltIslands;
  readonly styles: BuiltThemeStyles;
  readonly coreStylesheetPath: string | null;
  readonly coreStylesheetBody: string | null;
  readonly stylesheetBodies: ReadonlyMap<string, string>;
}

const emptyIslands: BuiltIslands = Object.freeze({
  manifest: Object.freeze({}),
  assets: Object.freeze([]),
  runtimePath: "",
});

export async function compileAdminProgram(options: {
  readonly enabled: boolean;
  readonly siteRoot: string;
  readonly plugins: readonly {
    readonly definition: PluginDefinition;
    readonly entryPath: string;
  }[];
}): Promise<AdminProgram> {
  const pageSpecs: {
    pluginId: string;
    title: string;
    componentPath: string;
    dataService: string | null;
    islandName: string;
    stylesName: string | null;
    entryPath: string;
  }[] = [];

  for (const plugin of options.plugins) {
    const def = plugin.definition;
    if (!def.adminPage || !def.id) continue;
    const componentPath = resolve(
      dirname(plugin.entryPath),
      def.adminPage.component,
    );
    pageSpecs.push({
      pluginId: def.id,
      title: def.adminPage.title ?? def.id,
      componentPath,
      dataService: def.adminPage.dataService ?? null,
      islandName: `admin-${def.id}`,
      stylesName: def.adminPage.styles ?? null,
      entryPath: plugin.entryPath,
    });
  }

  if (!options.enabled) {
    return Object.freeze({
      enabled: false,
      pages: Object.freeze([]),
      islands: emptyIslands,
      styles: emptyThemeStyles,
      coreStylesheetPath: null,
      coreStylesheetBody: null,
      stylesheetBodies: new Map(),
    });
  }

  const pages: AdminPluginPage[] = [];
  const stylesheetBodies = new Map<string, string>();
  const styleAssets: { path: string; body: string }[] = [];

  for (const spec of pageSpecs) {
    const Component = await importDefaultComponent(
      spec.componentPath,
      `plugin admin page ${spec.pluginId}`,
    );

    let stylesheetPath: string | null = null;
    if (spec.stylesName) {
      const entryPath = resolve(
        dirname(spec.entryPath),
        `${spec.stylesName}.css`,
      );
      const built = await buildStyles({
        entryPath,
        label: `plugin admin stylesheet (${spec.pluginId})`,
        assetPathPrefix: "/_admin/assets",
        assetName: `plugin-${spec.pluginId}`,
        siteRoot: options.siteRoot,
      });
      if (built.stylesheetPath) {
        stylesheetPath = built.stylesheetPath;
        for (const asset of built.assets) {
          stylesheetBodies.set(asset.path, asset.body);
          styleAssets.push({ path: asset.path, body: asset.body });
        }
      }
    }

    pages.push(
      Object.freeze({
        pluginId: spec.pluginId,
        title: spec.title,
        componentPath: spec.componentPath,
        Component,
        dataService: spec.dataService,
        islandName: spec.islandName,
        stylesheetPath,
      }),
    );
  }

  const islands =
    pages.length > 0
      ? await buildPluginAdminIslands(
          pages.map((page) => ({
            name: page.islandName,
            sourceFile: page.componentPath,
          })),
        )
      : emptyIslands;

  const coreCssPath = resolve(import.meta.dir, "core.css");
  const coreStyles = await buildStyles({
    entryPath: coreCssPath,
    label: "admin stylesheet",
    assetPathPrefix: "/_admin/assets",
    assetName: "core",
    siteRoot: options.siteRoot,
  });
  const hashedBody =
    coreStyles.assets.find((asset) => asset.path === coreStyles.stylesheetPath)
      ?.body ?? null;
  const coreStylesheetPath = "/_admin/assets/core.css";
  if (hashedBody) {
    stylesheetBodies.set(coreStylesheetPath, hashedBody);
    if (coreStyles.stylesheetPath) {
      stylesheetBodies.set(coreStyles.stylesheetPath, hashedBody);
    }
  }

  return Object.freeze({
    enabled: true,
    pages: Object.freeze(pages),
    islands,
    styles: Object.freeze({
      stylesheetPath: coreStylesheetPath,
      assets: Object.freeze([
        Object.freeze({ path: coreStylesheetPath, body: hashedBody ?? "" }),
        ...(coreStyles.stylesheetPath && hashedBody
          ? [
              Object.freeze({
                path: coreStyles.stylesheetPath,
                body: hashedBody,
              }),
            ]
          : []),
        ...styleAssets.map((asset) => Object.freeze(asset)),
      ]),
    }),
    coreStylesheetPath,
    coreStylesheetBody: hashedBody,
    stylesheetBodies,
  });
}

async function importDefaultComponent(
  filePath: string,
  label: string,
): Promise<ComponentType<Record<string, unknown>>> {
  const module = (await import(pathToFileURL(filePath).href)) as {
    default?: ComponentType<Record<string, unknown>>;
  };
  if (!module.default) {
    throw new Error(`Missing default export from ${label}`);
  }
  return module.default;
}
