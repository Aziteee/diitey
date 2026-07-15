import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  emptyThemeStyles,
  type BuiltThemeStyles,
} from "./styles.ts";

export interface BuildStylesOptions {
  readonly entryPath: string;
  readonly label: string;
  readonly assetPathPrefix: string;
  readonly assetName?: string;
  readonly siteRoot?: string;
}

export async function buildStyles(
  options: BuildStylesOptions,
): Promise<BuiltThemeStyles> {
  try {
    await access(options.entryPath);
  } catch {
    throw new Error(
      `Failed to build ${options.label}: missing entry ${options.entryPath}`,
    );
  }

  const plugins = await loadOptionalTailwindPlugins(options.siteRoot);
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [options.entryPath],
      target: "browser",
      minify: true,
      ...(plugins.length > 0 ? { plugins } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build ${options.label}: ${message}`);
  }

  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(
      `Failed to build ${options.label}${details ? `: ${details}` : ""}`,
    );
  }

  const cssOutput =
    result.outputs.find(
      (candidate) =>
        candidate.kind === "entry-point" ||
        (candidate.kind === "asset" &&
          (candidate.path.endsWith(".css") ||
            candidate.type?.includes("text/css"))),
    ) ??
    result.outputs.find((candidate) => candidate.path.endsWith(".css"));

  if (!cssOutput) {
    throw new Error(
      `Failed to build ${options.label}: no CSS asset was emitted`,
    );
  }

  const body = await cssOutput.text();
  const hash = new Bun.CryptoHasher("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 16);
  const name = options.assetName ?? "styles";
  const prefix = options.assetPathPrefix.replace(/\/+$/, "");
  const path = `${prefix}/${name}-${hash}.css`;

  return Object.freeze({
    stylesheetPath: path,
    assets: Object.freeze([Object.freeze({ path, body })]),
  });
}

export async function buildThemeStyles(
  themePath: string,
  stylesName: string | undefined,
  siteRoot?: string,
): Promise<BuiltThemeStyles> {
  if (!stylesName) {
    return emptyThemeStyles;
  }

  const entryPath = resolve(dirname(themePath), `${stylesName}.css`);
  return buildStyles({
    entryPath,
    label: "theme stylesheet",
    assetPathPrefix: "/assets/theme",
    assetName: "styles",
    siteRoot,
  });
}

async function loadOptionalTailwindPlugins(
  siteRoot: string | undefined,
): Promise<Bun.BunPlugin[]> {
  const plugin = await resolveOptionalModuleDefault<Bun.BunPlugin>(
    "bun-plugin-tailwind",
    siteRoot,
  );
  return plugin ? [plugin] : [];
}

async function resolveOptionalModuleDefault<T>(
  packageName: string,
  siteRoot: string | undefined,
): Promise<T | null> {
  const bases = [...(siteRoot ? [siteRoot] : []), process.cwd()];
  for (const base of bases) {
    try {
      const entry = await Bun.resolve(packageName, base);
      const module = (await import(pathToFileURL(entry).href)) as {
        default?: T;
      };
      if (module.default) return module.default;
    } catch {
      // Optional site-owned toolchain.
    }
  }
  try {
    const module = (await import(packageName)) as { default?: T };
    if (module.default) return module.default;
  } catch {
    // Optional site-owned toolchain.
  }
  return null;
}
