export interface SiteDefinition {
  theme: string;
}

export interface ContentRecord {
  readonly id: string;
  readonly created: string;
  readonly sourcePath: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly html: string;
}

export interface CollectionDefinition {
  readonly from: string;
  readonly schema: Readonly<Record<string, "string">>;
}

interface ItemBinding {
  readonly collection: string;
  readonly match: string;
}

interface PageDefinition {
  readonly name: string;
  readonly data: { readonly item: ItemBinding };
}

interface RouteDefinition {
  readonly path: string;
  readonly page: PageDefinition;
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

export function route(path: string, page: PageDefinition): RouteDefinition {
  return { path, page };
}
