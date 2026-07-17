import type { ContentRecord } from "../index.ts";
import type { ContentSnapshot } from "./content-snapshot.ts";
import type { PublicationCandidate } from "./effective-publication.ts";
import type { PublishedRouteEntry } from "./page-plan.ts";
import {
  buildRoutePath,
  matchPathPattern,
  type ItemRouteSpec,
} from "./route-pattern.ts";
import type { SiteProgram } from "./site-program.ts";

export interface ResolvedItemRoute {
  readonly path: string;
  readonly item: ContentRecord;
}

export interface ResolvedItemRoutes {
  readonly canonicalUrls: ReadonlyMap<string, string>;
  readonly byPathPattern: ReadonlyMap<string, readonly ResolvedItemRoute[]>;
}

export function resolveItemRoutes(
  itemRoutes: readonly ItemRouteSpec[],
  collections: Readonly<Record<string, readonly ContentRecord[]>>,
): ResolvedItemRoutes {
  const candidates = new Map<
    string,
    { readonly path: string; readonly canonical: boolean }[]
  >();
  const seenUrls = new Map<string, string>();
  const byPathPattern = new Map<string, ResolvedItemRoute[]>();

  for (const route of itemRoutes) {
    if (!byPathPattern.has(route.path)) {
      byPathPattern.set(route.path, []);
    }
    for (const record of collections[route.collection] ?? []) {
      const parameters = matchPathPattern(route.match, record.sourcePath);
      if (!parameters) {
        continue;
      }
      const path = buildRoutePath(route.path, parameters);
      const previousSource = seenUrls.get(path);
      if (previousSource) {
        throw new Error(
          `Duplicate URL ${path}: ${previousSource} and ${record.sourcePath}`,
        );
      }
      seenUrls.set(path, record.sourcePath);
      byPathPattern.get(route.path)!.push({ path, item: record });
      const recordCandidates = candidates.get(record.id) ?? [];
      recordCandidates.push({ path, canonical: route.canonical });
      candidates.set(record.id, recordCandidates);
    }
  }

  const canonicalUrls = new Map(
    [...candidates].map(([id, urls]) => {
      if (urls.length === 1) {
        return [id, urls[0]!.path] as const;
      }
      const canonical = urls.filter((candidate) => candidate.canonical);
      if (canonical.length !== 1) {
        throw new Error(
          `Content ID ${id} has multiple URLs and must declare exactly one canonical route`,
        );
      }
      return [id, canonical[0]!.path] as const;
    }),
  );

  return {
    canonicalUrls,
    byPathPattern: new Map(
      [...byPathPattern].map(([path, items]) => [
        path,
        Object.freeze(items) as readonly ResolvedItemRoute[],
      ]),
    ),
  };
}

export function publishRoutes(
  program: SiteProgram,
  content: ContentSnapshot,
): PublicationCandidate {
  const resolved = resolveItemRoutes(
    program.itemRoutes,
    content.byCollection,
  );
  const contentWithUrls = applyCanonicalUrls(content, resolved.canonicalUrls);
  const routes: PublishedRouteEntry[] = [];
  for (const plan of program.pagePlans) {
    const resolvedItems = resolved.byPathPattern.get(plan.pathPattern);
    const itemsWithUrls = resolvedItems
      ? resolvedItems.map((entry) => ({
          path: entry.path,
          item: contentWithUrls.byId.get(entry.item.id) ?? entry.item,
        }))
      : undefined;
    routes.push(...plan.publish(contentWithUrls, itemsWithUrls));
  }
  return Object.freeze({
    version: contentWithUrls.version,
    publishedAt: contentWithUrls.publishedAt,
    programRevision: program.programRevision,
    content: contentWithUrls,
    routes: Object.freeze(routes),
  });
}

function applyCanonicalUrls(
  content: ContentSnapshot,
  canonicalUrls: ReadonlyMap<string, string>,
): ContentSnapshot {
  const withUrl = (record: ContentRecord): ContentRecord =>
    Object.freeze({
      ...record,
      url: canonicalUrls.get(record.id) ?? "",
      attributes: Object.freeze({ ...record.attributes }),
    });

  const records = Object.freeze(content.records.map(withUrl));
  const byCollection = Object.freeze(
    Object.fromEntries(
      Object.entries(content.byCollection).map(([name, collection]) => [
        name,
        Object.freeze(collection.map(withUrl)),
      ]),
    ),
  ) as Readonly<Record<string, readonly ContentRecord[]>>;

  return Object.freeze({
    version: content.version,
    publishedAt: content.publishedAt,
    records,
    resources: content.resources,
    byId: Object.freeze(
      new Map(records.map((record) => [record.id, record] as const)),
    ),
    byCollection,
  });
}
