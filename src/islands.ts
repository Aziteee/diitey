import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import {
  Fragment,
  createContext,
  h,
  type ComponentType,
  type VNode,
} from "preact";
import { useContext } from "preact/hooks";
import renderToString from "preact-render-to-string";

export interface IslandAsset {
  readonly path: string;
  readonly body: string;
}

export interface BuiltIslands {
  readonly manifest: Readonly<Record<string, string>>;
  readonly assets: readonly IslandAsset[];
  readonly runtimePath: string;
}

interface IslandProps<Props extends Record<string, unknown>> {
  readonly name: string;
  readonly component: ComponentType<Props>;
  readonly props: Props;
}

const IslandBuildContext = createContext<BuiltIslands | null>(null);
const missingThemeConfig = Symbol("missing theme config");
const ThemeConfigContext = createContext<unknown>(missingThemeConfig);

export function useThemeConfig<Config>(): Readonly<Config> {
  const config = useContext(ThemeConfigContext);
  if (config === missingThemeConfig) {
    throw new Error(
      "Theme configuration is only available while rendering a theme page",
    );
  }
  return config as Readonly<Config>;
}

export function Island<Props extends Record<string, unknown>>({
  name,
  component,
  props,
}: IslandProps<Props>): VNode {
  const islands = useContext(IslandBuildContext);
  if (!islands) {
    throw new Error("Island must be rendered by Diitey SSR");
  }
  if (!islands.manifest[name]) {
    throw new Error(`Unknown island: ${name}`);
  }
  try {
    assertJsonSerializable(props, new Set());
  } catch {
    throw new Error(`Island ${name} props must be JSON-serializable`);
  }
  const serializedProps = JSON.stringify(props);
  return h(Fragment, null, [
    h(
      "div",
      {
        "data-diitey-island": name,
        "data-diitey-props": serializedProps,
      },
      h(
        ThemeConfigContext.Provider,
        { value: missingThemeConfig },
        h(component, props),
      ),
    ),
    h("script", { type: "module", src: islands.runtimePath }),
  ]);
}

function assertJsonSerializable(value: unknown, ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number");
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Unsupported JSON value");
  }
  if (ancestors.has(value)) {
    throw new Error("Circular reference");
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Non-plain object");
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertJsonSerializable(child, ancestors);
  }
  ancestors.delete(value);
}

export function renderPageWithIslands(
  Page: ComponentType<Record<string, unknown>>,
  data: Record<string, unknown>,
  islands: BuiltIslands,
  themeConfig: unknown,
): string {
  return renderToString(
    h(
      ThemeConfigContext.Provider,
      { value: themeConfig },
      h(IslandBuildContext.Provider, { value: islands }, h(Page, data)),
    ),
  );
}

export async function buildThemeIslands(themePath: string): Promise<BuiltIslands> {
  const islandsRoot = resolve(dirname(themePath), "islands");
  const entries = await readdir(islandsRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const sourceFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)),
    )
    .map((entry) => resolve(islandsRoot, entry.name))
    .sort();
  const manifest: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const assets: IslandAsset[] = [];

  for (const sourceFile of sourceFiles) {
    const name = basename(sourceFile, extname(sourceFile));
    if (manifest[name]) {
      throw new Error(`Duplicate island name: ${name}`);
    }
    const body = await buildIslandBundle(name, sourceFile);
    const hash = new Bun.CryptoHasher("sha256")
      .update(body)
      .digest("hex")
      .slice(0, 16);
    const path = `/assets/islands/${name}-${hash}.js`;
    manifest[name] = path;
    assets.push(Object.freeze({ path, body }));
  }
  const runtimeBody = buildHydrationRuntime();
  const runtimeHash = new Bun.CryptoHasher("sha256")
    .update(runtimeBody)
    .digest("hex")
    .slice(0, 16);
  const runtimePath = `/assets/islands/hydrate-${runtimeHash}.js`;
  assets.push(Object.freeze({ path: runtimePath, body: runtimeBody }));

  return Object.freeze({
    manifest: Object.freeze(manifest),
    assets: Object.freeze(assets),
    runtimePath,
  });
}

function buildHydrationRuntime(): string {
  return `const roots=[...document.querySelectorAll("[data-diitey-island]")];const names=[...new Set(roots.map(root=>root.getAttribute("data-diitey-island")).filter(Boolean))];if(names.length){const response=await fetch("/assets/island-manifest.json",{cache:"no-store"});if(!response.ok)throw new Error("Failed to load island manifest");const manifest=await response.json();await Promise.all(names.map(name=>{const path=manifest[name];if(!path)throw new Error("Unknown island: "+name);return import(path)}))}`;
}

async function buildIslandBundle(
  name: string,
  sourceFile: string,
): Promise<string> {
  const temporaryRoot = await mkdtemp(
    resolve(dirname(sourceFile), `.diitey-${name}-`),
  );
  try {
    const entryPath = resolve(temporaryRoot, "entry.tsx");
    const componentImport = relative(temporaryRoot, sourceFile).replaceAll("\\", "/");
    await writeFile(
      entryPath,
      `
        import { h, hydrate } from "preact";
        import Component from ${JSON.stringify(componentImport)};
        for (const root of document.querySelectorAll("[data-diitey-island]")) {
          if (root.getAttribute("data-diitey-island") !== ${JSON.stringify(name)}) continue;
          const props = JSON.parse(root.getAttribute("data-diitey-props") ?? "{}");
          hydrate(h(Component, props), root);
        }
      `,
    );
    let result: Awaited<ReturnType<typeof Bun.build>>;
    try {
      result = await Bun.build({
        entrypoints: [entryPath],
        target: "browser",
        format: "esm",
        minify: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to build island ${name}: ${message}`);
    }
    if (!result.success) {
      const details = result.logs.map((log) => log.message).join("\n");
      throw new Error(
        `Failed to build island ${name}${details ? `: ${details}` : ""}`,
      );
    }
    const output = result.outputs.find(
      (candidate) => candidate.kind === "entry-point",
    );
    if (!output) {
      throw new Error(
        `Failed to build island ${name}: no browser entry was emitted`,
      );
    }
    return output.text();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
