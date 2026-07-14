import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ConfigurableDefinition,
  ExtensionSelection,
  PluginDefinition,
  SiteDefinition,
  ThemeDefinition,
} from "./index.ts";
import {
  parseConfiguredValue,
  parsePluginDefinition,
  parseSiteDefinition,
  parseThemeDefinition,
} from "./validation.ts";

export interface LoadedExtension<T> {
  readonly reference: string;
  readonly entryPath: string;
  readonly definition: T;
}

interface LoadedConfiguredExtension<T> extends LoadedExtension<T> {
  readonly config: unknown;
}

export interface LoadedSiteExtensions {
  readonly config: SiteDefinition;
  readonly theme: LoadedConfiguredExtension<ThemeDefinition>;
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
    "site config.theme",
  );
  const plugins = await Promise.all(
    (config.plugins ?? []).map(async (selection, index) =>
      withoutConfig(
        await loadExtension<PluginDefinition>(
          root,
          selection,
          "plugin",
          `site config.plugins.${index}`,
        ),
      ),
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
  selection: ExtensionSelection,
  kind: "theme" | "plugin",
  selectionLabel: string,
): Promise<LoadedConfiguredExtension<T>> {
  const reference = typeof selection === "string" ? selection : selection.use;
  const entryPath = await resolveExtensionEntry(root, reference, kind);
  const imported = await importDefault(entryPath, `${kind} ${reference}`);
  const label = `${kind} ${reference}`;
  const hasConfiguredShape = isConfigurableDefinition(imported);
  const hasConfig =
    typeof selection !== "string" &&
    Object.prototype.hasOwnProperty.call(selection, "config");
  if (!hasConfiguredShape && hasConfig) {
    throw new Error(
      `${selectionLabel}.config: ${label} does not declare configuration`,
    );
  }
  const parsedConfig = hasConfiguredShape
    ? parseConfiguredValue(
        imported.config,
        hasConfig && typeof selection !== "string"
          ? selection.config
          : undefined,
        `${selectionLabel}.config`,
      )
    : Object.freeze({});
  const candidate = hasConfiguredShape
    ? await imported.setup(parsedConfig)
    : imported;
  const definition = (kind === "theme"
    ? parseThemeDefinition(candidate, label)
    : parsePluginDefinition(candidate, label)) as T;
  return Object.freeze({
    reference,
    entryPath,
    definition,
    config: parsedConfig,
  });
}

function withoutConfig<T>(
  extension: LoadedConfiguredExtension<T>,
): LoadedExtension<T> {
  return Object.freeze({
    reference: extension.reference,
    entryPath: extension.entryPath,
    definition: extension.definition,
  });
}

function isConfigurableDefinition(
  value: unknown,
): value is ConfigurableDefinition<unknown, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    config?: { parse?: unknown };
    setup?: unknown;
  };
  return (
    typeof candidate.config === "object" &&
    candidate.config !== null &&
    typeof candidate.config.parse === "function" &&
    typeof candidate.setup === "function"
  );
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
