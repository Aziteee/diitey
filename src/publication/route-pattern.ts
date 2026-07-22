import picomatch from "picomatch";
import type { CollectionDefinition } from "../index.ts";

export interface ItemRouteSpec {
  readonly path: string;
  readonly collection: string;
  readonly match: string;
  readonly canonical: boolean;
}

export function compileCollectionMatchers(
  definitions: Readonly<Record<string, CollectionDefinition>>,
): Readonly<Record<string, (sourcePath: string) => boolean>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => {
        try {
          const matches = picomatch(normalizeSourcePath(definition.from), {
            strictBrackets: true,
          });
          return [
            name,
            (sourcePath: string) => matches(normalizeSourcePath(sourcePath)),
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Invalid collection glob ${name} (${definition.from}): ${message}`,
          );
        }
      }),
    ),
  );
}

export function matchPathPattern(
  pattern: string,
  sourcePath: string,
): Record<string, string> | null {
  const names: string[] = [];
  const expression = normalizeSourcePath(pattern)
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const suffixIndex = segment.indexOf(".");
        const name = segment.slice(1, suffixIndex < 0 ? undefined : suffixIndex);
        const suffix =
          suffixIndex < 0 ? "" : escapeRegExp(segment.slice(suffixIndex));
        names.push(name);
        return `([^/]+)${suffix}`;
      }
      return escapeRegExp(segment).replaceAll("\\*", "[^/]*");
    })
    .join("/");
  const match = new RegExp(`^${expression}$`).exec(
    normalizeSourcePath(sourcePath),
  );
  if (!match) {
    return null;
  }
  return Object.fromEntries(
    names.map((name, index) => [name, match[index + 1] ?? ""]),
  );
}

export function buildRoutePath(
  pattern: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const path = pattern.replace(/:([^/]+)/g, (_, name: string) => {
    const value = parameters[name];
    if (value === undefined) {
      throw new Error(`Route parameter :${name} cannot be generated`);
    }
    return encodeURIComponent(value);
  });
  return normalizeRoutePath(path);
}

export function normalizeRoutePath(path: string): string {
  return path === "/" ? path : path.replace(/\/+$/, "");
}

export function isNotFoundRoutePath(path: string): boolean {
  return path === "*";
}

export function validateRoutePatterns(
  routes: readonly { readonly path: string }[],
): void {
  const seen = new Map<string, string>();
  let notFoundPath: string | undefined;
  for (const route of routes) {
    if (isNotFoundRoutePath(route.path)) {
      if (notFoundPath !== undefined) {
        throw new Error(
          `Theme can declare only one not-found route (*); found ${notFoundPath} and ${route.path}`,
        );
      }
      notFoundPath = route.path;
      continue;
    }
    const normalized = normalizeRoutePath(route.path);
    if (!normalized.startsWith("/")) {
      throw new Error(`Route path must start with /: ${route.path}`);
    }
    if (normalized === "/assets" || normalized.startsWith("/assets/")) {
      throw new Error(`Theme route cannot use reserved path ${route.path}`);
    }
    const shape = normalized
      .split("/")
      .map((segment) => (segment.startsWith(":") ? ":" : segment))
      .join("/");
    const previous = seen.get(shape);
    if (previous) {
      throw new Error(`Ambiguous route patterns ${previous} and ${route.path}`);
    }
    seen.set(shape, route.path);
  }
}

function normalizeSourcePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
