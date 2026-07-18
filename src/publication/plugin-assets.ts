import { access, mkdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  PluginDefinition,
  PluginHeadContext,
} from "../index.ts";
import { PLUGIN_ID_PATTERN } from "../plugins.ts";
import {
  ArtifactStore,
  type ContentResource,
} from "./content-resources.ts";

export interface PluginAssetResource extends ContentResource {
  readonly pluginId: string;
  readonly name: string;
}

export interface PluginAssetBuildInput {
  readonly root: string;
  readonly entries: readonly {
    readonly definition: PluginDefinition;
    readonly entryPath: string;
  }[];
}

export interface BuiltPluginAssets {
  readonly assets: readonly PluginAssetResource[];
  readonly assetsByPath: ReadonlyMap<string, PluginAssetResource>;
  readonly headFragments: readonly string[];
}

export function pluginAssetCacheRoot(root: string): string {
  return resolve(root, "data", "cache", "plugin-assets");
}

export async function buildPluginAssets(
  input: PluginAssetBuildInput,
): Promise<BuiltPluginAssets> {
  const cacheRoot = pluginAssetCacheRoot(input.root);
  await mkdir(cacheRoot, { recursive: true });
  const store = new ArtifactStore(cacheRoot);
  const assets: PluginAssetResource[] = [];
  const byPath = new Map<string, PluginAssetResource>();
  const urlsByPlugin = new Map<string, Map<string, string>>();

  for (const entry of input.entries) {
    const publication = entry.definition.publication;
    if (!publication) continue;
    const pluginId = entry.definition.id;
    if (!pluginId) {
      throw new Error("Plugins that declare publication assets or head must have an explicit id");
    }
    if (!PLUGIN_ID_PATTERN.test(pluginId)) {
      throw new Error(`Plugin ID must match ${PLUGIN_ID_PATTERN}: ${pluginId}`);
    }
    const pluginRoot = await realpath(dirname(entry.entryPath));
    const names = new Map<string, string>();
    urlsByPlugin.set(pluginId, names);
    for (const declaration of publication.assets ?? []) {
      validateAssetName(declaration.name);
      if (names.has(declaration.name)) {
        throw new Error(`Duplicate plugin asset name: ${pluginId}/${declaration.name}`);
      }
      const target = await resolvePluginFile(pluginRoot, declaration.file);
      const artifact = await store.materialize(target);
      const publicPath = `/assets/plugins/${pluginId}/${encodeURIComponent(declaration.name)}`;
      if (byPath.has(publicPath)) {
        throw new Error(`Duplicate plugin asset URL: ${publicPath}`);
      }
      const resource = Object.freeze({
        pluginId,
        name: declaration.name,
        publicPath,
        digest: artifact.digest,
        byteLength: artifact.byteLength,
        mediaType: declaration.contentType ?? (Bun.file(target).type || "application/octet-stream"),
        cachePath: artifact.cachePath,
      });
      names.set(declaration.name, publicPath);
      assets.push(resource);
      byPath.set(publicPath, resource);
    }
  }

  const headFragments: string[] = [];
  for (const entry of input.entries) {
    const head = entry.definition.publication?.head;
    if (!head) continue;
    const pluginId = entry.definition.id!;
    const names = urlsByPlugin.get(pluginId) ?? new Map<string, string>();
    const context: PluginHeadContext = Object.freeze({
      assetUrl(name: string) {
        const url = names.get(name);
        if (!url) throw new Error(`Unknown plugin asset: ${pluginId}/${name}`);
        return url;
      },
    });
    const fragment = head(context);
    if (typeof fragment !== "string") {
      throw new Error(`Plugin ${pluginId} head generator must return a string`);
    }
    headFragments.push(fragment);
  }

  return Object.freeze({
    assets: Object.freeze(assets),
    assetsByPath: Object.freeze(byPath),
    headFragments: Object.freeze(headFragments),
  });
}

async function resolvePluginFile(pluginRoot: string, declared: string): Promise<string> {
  if (declared.trim() === "" || declared.includes("\0")) {
    throw new Error("Plugin asset file must be a non-empty path");
  }
  const candidate = isAbsolute(declared)
    ? resolve(declared)
    : resolve(pluginRoot, declared);
  let target: string;
  try {
    target = await realpath(candidate);
    const details = await stat(target);
    if (!details.isFile()) throw new Error("not a file");
    await access(target, constants.R_OK);
  } catch {
    throw new Error(`Plugin asset file is not readable: ${declared}`);
  }
  if (!isWithin(pluginRoot, target)) {
    throw new Error(`Plugin asset file escapes plugin directory: ${declared}`);
  }
  return target;
}

function validateAssetName(name: string): void {
  if (name.trim() === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`Invalid plugin asset name: ${name}`);
  }
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
