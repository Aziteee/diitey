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
