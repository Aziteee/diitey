import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  PluginDefinition,
  SiteDefinition,
  ThemeDefinition,
} from "./index.ts";
import {
  parsePluginDefinition,
  parseSiteDefinition,
  parseThemeDefinition,
} from "./validation.ts";

export interface LoadedExtension<T> {
  readonly reference: string;
  readonly entryPath: string;
  readonly definition: T;
}

export interface LoadedSiteExtensions {
  readonly config: SiteDefinition;
  readonly theme: LoadedExtension<ThemeDefinition>;
  readonly plugins: readonly LoadedExtension<PluginDefinition>[];
}

export async function loadSiteExtensions(
  root: string,
): Promise<LoadedSiteExtensions> {
  const config = parseSiteDefinition(
    await importDefault(resolve(root, "site.config.ts"), "site config"),
  );
  const theme = await loadExtension<ThemeDefinition>(
    root,
    config.theme,
    "theme",
  );
  const plugins = await Promise.all(
    (config.plugins ?? []).map((reference) =>
      loadExtension<PluginDefinition>(root, reference, "plugin"),
    ),
  );
  validatePluginIds(plugins);

  return Object.freeze({
    config,
    theme,
    plugins: Object.freeze(plugins),
  });
}

function validatePluginIds(
  plugins: readonly LoadedExtension<PluginDefinition>[],
): void {
  const referencesById = new Map<string, string>();
  for (const plugin of plugins) {
    const id = plugin.definition.id;
    if (!id) continue;
    const previous = referencesById.get(id);
    if (previous) {
      throw new Error(
        `Duplicate plugin ID ${id}: ${previous} and ${plugin.reference}`,
      );
    }
    referencesById.set(id, plugin.reference);
  }
}

async function loadExtension<T>(
  root: string,
  reference: string,
  kind: "theme" | "plugin",
): Promise<LoadedExtension<T>> {
  const entryPath = await resolveExtensionEntry(root, reference, kind);
  const imported = await importDefault(entryPath, `${kind} ${reference}`);
  const definition = (kind === "theme"
    ? parseThemeDefinition(imported, `theme ${reference}`)
    : parsePluginDefinition(imported, `plugin ${reference}`)) as T;
  return Object.freeze({ reference, entryPath, definition });
}

async function resolveExtensionEntry(
  root: string,
  reference: string,
  kind: "theme" | "plugin",
): Promise<string> {
  try {
    if (isPathReference(reference)) {
      return resolve(root, reference);
    }
    return await Bun.resolve(reference, root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot resolve ${kind} ${reference} from ${root}: ${message}`,
    );
  }
}

function isPathReference(reference: string): boolean {
  return (
    reference.startsWith("./") ||
    reference.startsWith("../") ||
    isAbsolute(reference)
  );
}

async function importDefault<T = unknown>(filePath: string, label: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as { default?: T };
  if (!module.default) throw new Error(`Missing default export from ${label}`);
  return module.default;
}
