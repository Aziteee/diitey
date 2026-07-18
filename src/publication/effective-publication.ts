import type { ContentSnapshot } from "./content-snapshot.ts";
import type { ContentResource } from "./content-resources.ts";
import type { PluginAssetResource } from "./plugin-assets.ts";
import type {
  CompiledPagePlan,
  PublishedRouteEntry,
} from "./page-plan.ts";
import { publishRoutes } from "./publish-routes.ts";
import type { SiteProgram } from "./site-program.ts";

export interface EffectivePublication {
  readonly version: string;
  readonly publishedAt: string;
  readonly programRevision: string;
  readonly content: ContentSnapshot;
  readonly contentIds: ReadonlySet<string>;
  readonly contentResourcesByPath: ReadonlyMap<string, ContentResource>;
  readonly routesByPath: ReadonlyMap<string, PublishedRouteEntry>;
  readonly plansById: ReadonlyMap<string, CompiledPagePlan>;
  readonly islandAssetsByPath: ReadonlyMap<string, string>;
  readonly islandManifest: Readonly<Record<string, string>>;
  readonly themeAssetsByPath: ReadonlyMap<string, string>;
  readonly pluginAssetsByPath: ReadonlyMap<string, PluginAssetResource>;
  readonly pluginHeadFragments: readonly string[];
}

export interface PublicationCandidate {
  readonly version: string;
  readonly publishedAt: string;
  readonly programRevision: string;
  readonly content: ContentSnapshot;
  readonly routes: readonly PublishedRouteEntry[];
}

export function buildEffectivePublication(
  program: SiteProgram,
  content: ContentSnapshot,
): EffectivePublication {
  return materializePublication(program, publishRoutes(program, content));
}

export function materializePublication(
  program: SiteProgram,
  candidate: PublicationCandidate,
): EffectivePublication {
  if (candidate.programRevision !== program.programRevision) {
    throw new Error(
      "Publication candidate programRevision does not match the startup site program",
    );
  }

  const routesByPath = new Map<string, PublishedRouteEntry>();
  for (const entry of candidate.routes) {
    const previous = routesByPath.get(entry.path);
    if (previous) {
      throw new Error(
        `Duplicate URL ${entry.path}: plan ${previous.planId} and ${entry.planId}`,
      );
    }
    routesByPath.set(entry.path, entry);
  }

  const plansById = new Map(
    program.pagePlans.map((plan) => [plan.id, plan] as const),
  );
  const contentResourcesByPath = new Map<string, ContentResource>();
  for (const resource of candidate.content.resources) {
    if (contentResourcesByPath.has(resource.publicPath)) {
      throw new Error(`Duplicate content resource URL ${resource.publicPath}`);
    }
    contentResourcesByPath.set(resource.publicPath, resource);
  }
  for (const entry of candidate.routes) {
    if (!plansById.has(entry.planId)) {
      throw new Error(`Unknown page plan: ${entry.planId}`);
    }
  }

  const islandAssetsByPath = new Map(
    program.islands.assets.map((asset) => [asset.path, asset.body] as const),
  );
  const themeAssetsByPath = new Map(
    program.styles.assets.map((asset) => [asset.path, asset.body] as const),
  );

  return Object.freeze({
    version: candidate.version,
    publishedAt: candidate.publishedAt,
    programRevision: candidate.programRevision,
    content: freezeContentSnapshot(candidate.content),
    contentIds: Object.freeze(
      new Set(candidate.content.records.map((record) => record.id)),
    ),
    contentResourcesByPath: Object.freeze(contentResourcesByPath),
    routesByPath: Object.freeze(routesByPath),
    plansById,
    islandAssetsByPath: Object.freeze(islandAssetsByPath),
    islandManifest: program.islands.manifest,
    themeAssetsByPath: Object.freeze(themeAssetsByPath),
    pluginAssetsByPath: program.pluginAssets.assetsByPath,
    pluginHeadFragments: program.pluginAssets.headFragments,
  });
}

export function buildPublicationCandidate(
  program: SiteProgram,
  content: ContentSnapshot,
): PublicationCandidate {
  const candidate = publishRoutes(program, content);
  return Object.freeze({
    ...candidate,
    content: freezeContentSnapshot(candidate.content),
    routes: Object.freeze(candidate.routes.map(freezeRouteEntry)),
  });
}

function freezeContentSnapshot(content: ContentSnapshot): ContentSnapshot {
  const records = Object.freeze(
    content.records.map((record) =>
      Object.freeze({
        ...record,
        attributes: Object.freeze({ ...record.attributes }),
      }),
    ),
  );
  const resources = Object.freeze(
    content.resources.map((resource) => Object.freeze({ ...resource })),
  );
  return Object.freeze({
    version: content.version,
    publishedAt: content.publishedAt,
    records,
    resources,
    byId: Object.freeze(
      new Map(records.map((record) => [record.id, record] as const)),
    ),
    byCollection: Object.freeze(
      Object.fromEntries(
        Object.entries(content.byCollection).map(([name, collection]) => [
          name,
          Object.freeze(
            collection.map((record) =>
              Object.freeze({
                ...record,
                attributes: Object.freeze({ ...record.attributes }),
              }),
            ),
          ),
        ]),
      ),
    ),
  });
}

function freezeRouteEntry(entry: PublishedRouteEntry): PublishedRouteEntry {
  return Object.freeze({
    ...entry,
    publishData: Object.freeze({ ...entry.publishData }),
    ...(entry.pagination
      ? {
          pagination: Object.freeze({
            ...entry.pagination,
            items: Object.freeze(
              entry.pagination.items.map((item) =>
                Object.freeze({
                  ...item,
                  attributes: Object.freeze({ ...item.attributes }),
                }),
              ),
            ),
            ...(entry.pagination.bodies
              ? {
                  bodies: Object.freeze([...entry.pagination.bodies]),
                }
              : {}),
          }),
        }
      : {}),
  });
}
