import type { Pluggable } from "unified";
import type { Database } from "bun:sqlite";
export { Island, useThemeConfig } from "./islands.ts";
export { useThemeStylesheet } from "./styles.ts";
export { PluginNotFoundError } from "./plugins.ts";

export type SchemaType =
  | "string"
  | "string?"
  | "string[]"
  | "string[]?"
  | "boolean"
  | "boolean?"
  | "number"
  | "number?";

export interface ValueSchema<Value = unknown> {
  parse(value: unknown): Value;
}

export interface ConfiguredExtensionSelection {
  readonly use: string;
  readonly config?: unknown;
}

export type ExtensionSelection = string | ConfiguredExtensionSelection;

export interface ConfigurableDefinition<Config, Definition> {
  readonly config: ValueSchema<Config>;
  setup(config: Config): Definition;
}

export type WhereCondition =
  | string
  | number
  | boolean
  | null
  | { readonly not: unknown }
  | { readonly contains: unknown }
  | { readonly exists: boolean };

export interface SiteDefinition {
  theme: ExtensionSelection;
  plugins?: readonly ExtensionSelection[];
  contentDir?: string;
  reload?: {
    timeoutMs?: number;
  };
}

export interface PluginAdminPageDefinition {
  readonly component: string;
  readonly title?: string;
  readonly dataService?: string;
  /** CSS entry relative to the plugin entry (e.g. `"admin"` → `admin.css`). */
  readonly styles?: string;
}

export interface PluginDefinition {
  readonly id?: string;
  readonly name?: string;
  readonly version?: string;
  readonly schemaVersion?: number;
  readonly migrations?: readonly PluginMigration[];
  readonly services?: Readonly<Record<string, PluginServiceDefinition>>;
  readonly actions?: Readonly<Record<string, ActionDefinition>>;
  readonly adminPage?: PluginAdminPageDefinition;
  readonly publication?: PluginPublicationDefinition;
  readonly markdown?: {
    readonly remarkPlugins?: readonly Pluggable[];
    readonly rehypePlugins?: readonly Pluggable[];
    /** Applied to the markdown body only (after front matter), before remark-parse. */
    readonly bodyTransforms?: readonly MarkdownBodyTransform[];
  };
}

export interface MarkdownBodyTransformContext {
  readonly sourcePath: string;
  readonly filePath: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export type MarkdownBodyTransform = (
  body: string,
  context: MarkdownBodyTransformContext,
) => string | Promise<string>;

export interface PluginMigration {
  readonly id: string;
  readonly schemaVersion: number;
  readonly sql: string;
}

export interface ContentSummary {
  readonly id: string;
  readonly created: string;
  readonly sourcePath: string;
  readonly url: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PluginRequestMeta {
  readonly clientAddress?: string;
  readonly userAgent?: string;
}

export interface PluginServiceContext {
  readonly database: Database;
  readonly signal: AbortSignal;
  readonly log: PluginLogger;
  readonly content: {
    exists(contentId: string): boolean;
    get(contentId: string): ContentSummary | undefined;
  };
  /** Present only on public Action invocations. */
  readonly requestMeta?: PluginRequestMeta;
}

export interface PluginServiceDefinition {
  readonly input: ValueSchema;
  readonly output: ValueSchema;
  handler(
    input: any,
    context: PluginServiceContext,
  ): unknown | Promise<unknown>;
}

export interface ActionDefinition {
  readonly service: string;
  readonly access?: "public" | "admin";
  readonly bodyLimitBytes?: number;
  readonly rateLimit?: {
    readonly limit: number;
    readonly windowMs: number;
  };
  readonly timeoutMs?: number;
  readonly credentials?: "cookie";
}

export interface ContentRecord {
  readonly id: string;
  readonly created: string;
  readonly sourcePath: string;
  readonly url: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly html: string;
}

export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly prevHref: string | null;
  readonly nextHref: string | null;
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

export interface ServiceBinding {
  readonly service: string;
  readonly input: Readonly<
    Record<string, unknown | { readonly from: string }>
  >;
}

export interface PageDefinition {
  readonly name: string;
  readonly data: Readonly<
    Record<string, ItemBinding | ListBinding | ServiceBinding>
  >;
}

export interface RouteDefinition {
  readonly path: string;
  readonly page: PageDefinition;
  readonly canonical: boolean;
}

export interface ThemeDefinition {
  readonly collections: Readonly<Record<string, CollectionDefinition>>;
  readonly routes: readonly RouteDefinition[];
  readonly document?: string;
  readonly styles?: string;
}

export function defineSite(definition: SiteDefinition): SiteDefinition {
  return definition;
}

export function defineTheme(definition: ThemeDefinition): ThemeDefinition;
export function defineTheme<Config>(
  definition: ConfigurableDefinition<Config, ThemeDefinition>,
): ConfigurableDefinition<Config, ThemeDefinition>;
export function defineTheme<Config>(
  definition:
    | ThemeDefinition
    | ConfigurableDefinition<Config, ThemeDefinition>,
): ThemeDefinition | ConfigurableDefinition<Config, ThemeDefinition> {
  return definition;
}

export interface PluginPublicationAssetDefinition {
  readonly name: string;
  readonly file: string;
  readonly contentType?: string;
}

export interface PluginHeadContext {
  readonly assetUrl: (name: string) => string;
}

export type PluginHeadGenerator = (
  context: PluginHeadContext,
) => string;

export interface PluginPublicationDefinition {
  readonly assets?: readonly PluginPublicationAssetDefinition[];
  readonly head?: PluginHeadGenerator;
}

export function definePlugin(definition: PluginDefinition): PluginDefinition;
export function definePlugin<Config>(
  definition: ConfigurableDefinition<Config, PluginDefinition>,
): ConfigurableDefinition<Config, PluginDefinition>;
export function definePlugin<Config>(
  definition:
    | PluginDefinition
    | ConfigurableDefinition<Config, PluginDefinition>,
): PluginDefinition | ConfigurableDefinition<Config, PluginDefinition> {
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
