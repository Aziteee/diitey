import type { Pluggable } from "unified";

export type SchemaType =
  | "string"
  | "string?"
  | "string[]"
  | "string[]?"
  | "boolean"
  | "boolean?"
  | "number"
  | "number?";

export type WhereCondition =
  | string
  | number
  | boolean
  | null
  | { readonly not: unknown }
  | { readonly contains: unknown }
  | { readonly exists: boolean };

export interface SiteDefinition {
  theme: string;
  plugins?: readonly string[];
  reload?: {
    timeoutMs?: number;
  };
}

export interface PluginDefinition {
  readonly name: string;
  readonly markdown?: {
    readonly remarkPlugins?: readonly Pluggable[];
    readonly rehypePlugins?: readonly Pluggable[];
  };
}

export interface ContentRecord {
  readonly id: string;
  readonly created: string;
  readonly sourcePath: string;
  readonly url: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly html: string;
}

export interface CollectionDefinition {
  readonly from: string;
  readonly schema: Readonly<Record<string, SchemaType>>;
  readonly where?: Readonly<Record<string, WhereCondition>>;
  readonly orderBy?: readonly {
    readonly field: string;
    readonly direction: "asc" | "desc";
  }[];
}

export interface ItemBinding {
  readonly collection: string;
  readonly match: string;
}

export interface ListBinding {
  readonly collection: string;
  readonly limit?: number;
  readonly paginate?: number;
}

export interface PageDefinition {
  readonly name: string;
  readonly data: Readonly<Record<string, ItemBinding | ListBinding>>;
}

export interface RouteDefinition {
  readonly path: string;
  readonly page: PageDefinition;
  readonly canonical: boolean;
}

export interface ThemeDefinition {
  readonly collections: Readonly<Record<string, CollectionDefinition>>;
  readonly routes: readonly RouteDefinition[];
}

export function defineSite(definition: SiteDefinition): SiteDefinition {
  return definition;
}

export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  return definition;
}

export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}

export function collection(
  definition: CollectionDefinition,
): CollectionDefinition {
  return definition;
}

export function page(
  name: string,
  data: PageDefinition["data"],
): PageDefinition {
  return { name, data };
}

export function route(
  path: string,
  page: PageDefinition,
  options: { readonly canonical?: boolean } = {},
): RouteDefinition {
  return { path, page, canonical: options.canonical ?? false };
}
