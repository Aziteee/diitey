import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "preact";
import type { PluginDefinition } from "../index.ts";
import {
  buildPluginAdminIslands,
  type BuiltIslands,
} from "../islands.ts";
import { buildStyles } from "../styles-build.ts";
import type { BuiltThemeStyles } from "../styles.ts";

export interface AdminPluginPage {
  readonly pluginId: string;
  readonly title: string;
  readonly componentPath: string;
  readonly Component: ComponentType<Record<string, unknown>>;
  readonly dataService: string | null;
  readonly islandName: string;
}

export interface AdminProgram {
  readonly enabled: boolean;
  readonly pages: readonly AdminPluginPage[];
  readonly islands: BuiltIslands;
  readonly styles: BuiltThemeStyles;
  readonly coreStylesheetPath: string | null;
  readonly coreStylesheetBody: string | null;
}

const emptyIslands: BuiltIslands = Object.freeze({
  manifest: Object.freeze({}),
  assets: Object.freeze([]),
  runtimePath: "",
});

const emptyStyles: BuiltThemeStyles = Object.freeze({
  stylesheetPath: null,
  assets: Object.freeze([]),
});

export async function compileAdminProgram(options: {
  readonly enabled: boolean;
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
    });
  }

  if (!options.enabled) {
    return Object.freeze({
      enabled: false,
      pages: Object.freeze([]),
      islands: emptyIslands,
      styles: emptyStyles,
      coreStylesheetPath: null,
      coreStylesheetBody: null,
    });
  }

  const pages: AdminPluginPage[] = [];
  for (const spec of pageSpecs) {
    const Component = await importDefaultComponent(
      spec.componentPath,
      `plugin admin page ${spec.pluginId}`,
    );
    pages.push(
      Object.freeze({
        ...spec,
        Component,
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
  const styles = await buildStyles({
    entryPath: coreCssPath,
    label: "admin stylesheet",
    assetPathPrefix: "/_admin/assets",
    assetName: "core",
  });
  const hashedBody =
    styles.assets.find((asset) => asset.path === styles.stylesheetPath)
      ?.body ?? null;
  const coreStylesheetPath = "/_admin/assets/core.css";

  return Object.freeze({
    enabled: true,
    pages: Object.freeze(pages),
    islands,
    styles: Object.freeze({
      stylesheetPath: coreStylesheetPath,
      assets: Object.freeze([
        Object.freeze({ path: coreStylesheetPath, body: hashedBody ?? "" }),
        ...(styles.stylesheetPath && hashedBody
          ? [
              Object.freeze({
                path: styles.stylesheetPath,
                body: hashedBody,
              }),
            ]
          : []),
      ]),
    }),
    coreStylesheetPath,
    coreStylesheetBody: hashedBody,
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
