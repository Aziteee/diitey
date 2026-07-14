import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export interface ThemeStylesheetAsset {
  readonly path: string;
  readonly body: string;
}

export interface BuiltThemeStyles {
  readonly stylesheetPath: string | null;
  readonly assets: readonly ThemeStylesheetAsset[];
}

export const emptyThemeStyles: BuiltThemeStyles = Object.freeze({
  stylesheetPath: null,
  assets: Object.freeze([]),
});

const missingThemeStylesheet = Symbol("missing theme stylesheet");

export type ThemeStylesheetContextValue =
  | string
  | null
  | typeof missingThemeStylesheet;

export const ThemeStylesheetContext =
  createContext<ThemeStylesheetContextValue>(missingThemeStylesheet);

export function useThemeStylesheet(): string {
  const path = useContext(ThemeStylesheetContext);
  if (path === missingThemeStylesheet) {
    throw new Error(
      "Theme stylesheet is only available while rendering a theme page",
    );
  }
  if (path === null) {
    throw new Error(
      "Theme stylesheet was requested but this theme did not declare styles",
    );
  }
  return path;
}

export async function buildThemeStyles(
  themePath: string,
  stylesName: string | undefined,
): Promise<BuiltThemeStyles> {
  if (!stylesName) {
    return emptyThemeStyles;
  }

  const entryPath = resolve(dirname(themePath), `${stylesName}.css`);
  try {
    await access(entryPath);
  } catch {
    throw new Error(
      `Failed to build theme stylesheet: missing entry ${stylesName}.css`,
    );
  }

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      minify: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build theme stylesheet: ${message}`);
  }

  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(
      `Failed to build theme stylesheet${details ? `: ${details}` : ""}`,
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
      "Failed to build theme stylesheet: no CSS asset was emitted",
    );
  }

  const body = await cssOutput.text();
  const hash = new Bun.CryptoHasher("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 16);
  const path = `/assets/theme/styles-${hash}.css`;

  return Object.freeze({
    stylesheetPath: path,
    assets: Object.freeze([Object.freeze({ path, body })]),
  });
}
