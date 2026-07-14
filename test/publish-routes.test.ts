import { describe, expect, test } from "bun:test";
import type { ContentRecord } from "../src/index.ts";
import { assembleContentSnapshot } from "../src/publication/content-snapshot.ts";
import {
  buildEffectivePublication,
  materializePublication,
} from "../src/publication/effective-publication.ts";
import {
  publishRoutes,
  resolveItemRoutes,
} from "../src/publication/publish-routes.ts";
import type {
  CompiledPagePlan,
  PublishedRouteEntry,
} from "../src/publication/page-plan.ts";
import type { ContentSnapshot } from "../src/publication/content-snapshot.ts";
import type { ResolvedItemRoute } from "../src/publication/publish-routes.ts";
import type { SiteProgram } from "../src/publication/site-program.ts";
import { compileCollectionMatchers } from "../src/publication/route-pattern.ts";

function record(
  partial: Partial<ContentRecord> &
    Pick<ContentRecord, "id" | "sourcePath" | "attributes">,
): ContentRecord {
  return {
    id: partial.id,
    created: partial.created ?? "2026-07-01",
    sourcePath: partial.sourcePath,
    url: partial.url ?? "",
    attributes: partial.attributes,
    html: partial.html ?? "<p>body</p>",
  };
}

function emptyIslands() {
  return {
    manifest: Object.freeze({}),
    assets: Object.freeze([] as { path: string; body: string }[]),
    runtimePath: "/assets/islands/runtime.js",
  };
}

function makePlan(options: {
  id: string;
  pathPattern: string;
  publish: (
    snapshot: ContentSnapshot,
    resolvedItems?: readonly ResolvedItemRoute[],
  ) => readonly PublishedRouteEntry[];
}): CompiledPagePlan {
  return Object.freeze({
    id: options.id,
    pageName: options.id,
    pathPattern: options.pathPattern,
    publish: options.publish,
    render: async () => "",
  });
}

function makeProgram(options: {
  itemRoutes?: SiteProgram["itemRoutes"];
  pagePlans: readonly CompiledPagePlan[];
  collections?: SiteProgram["collections"];
  programRevision?: string;
}): SiteProgram {
  const collections = options.collections ?? {
    writing: { from: "*.md", schema: { title: "string" } },
  };
  return Object.freeze({
    root: "/tmp/site",
    contentRoot: "/tmp/site/content",
    programRevision: options.programRevision ?? "rev-1",
    collections,
    collectionMatchers: compileCollectionMatchers(collections),
    itemRoutes: Object.freeze(options.itemRoutes ?? []),
    pagePlans: Object.freeze(options.pagePlans),
    islands: emptyIslands(),
    usesDocument: false,
    markdown: Object.freeze({ remarkPlugins: [], rehypePlugins: [] }),
    plugins: Object.freeze({
      services: Object.freeze({}),
      actions: Object.freeze({}),
    }),
    pluginDefinitions: Object.freeze([]),
    reloadTimeoutMs: 30_000,
  });
}

describe("resolveItemRoutes", () => {
  test("matches content once and builds route paths per item route", () => {
    const writing = [
      record({
        id: "a",
        sourcePath: "hello.md",
        attributes: { title: "Hello" },
      }),
      record({
        id: "b",
        sourcePath: "notes/x.md",
        attributes: { title: "X" },
      }),
    ];
    const resolved = resolveItemRoutes(
      [
        {
          path: "/writing/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: true,
        },
      ],
      { writing },
    );

    expect(resolved.canonicalUrls.get("a")).toBe("/writing/hello");
    expect(resolved.canonicalUrls.get("b")).toBeUndefined();
    expect(resolved.byPathPattern.get("/writing/:slug")).toEqual([
      {
        path: "/writing/hello",
        item: writing[0]!,
      },
    ]);
  });

  test("picks the declared canonical URL when content matches multiple routes", () => {
    const writing = [
      record({
        id: "shared",
        sourcePath: "shared.md",
        attributes: { title: "Shared" },
      }),
    ];
    const resolved = resolveItemRoutes(
      [
        {
          path: "/a/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: false,
        },
        {
          path: "/b/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: true,
        },
      ],
      { writing },
    );

    expect(resolved.canonicalUrls.get("shared")).toBe("/b/shared");
    expect(resolved.byPathPattern.get("/a/:slug")?.[0]?.path).toBe("/a/shared");
    expect(resolved.byPathPattern.get("/b/:slug")?.[0]?.path).toBe("/b/shared");
  });

  test("rejects two content records at the same URL", () => {
    const writing = [
      record({
        id: "first",
        sourcePath: "articles/first/shared.md",
        attributes: { title: "First" },
      }),
      record({
        id: "second",
        sourcePath: "articles/second/shared.md",
        attributes: { title: "Second" },
      }),
    ];
    expect(() =>
      resolveItemRoutes(
        [
          {
            path: "/writing/:slug",
            collection: "writing",
            match: "articles/*/:slug.md",
            canonical: true,
          },
        ],
        { writing },
      ),
    ).toThrow(/Duplicate URL \/writing\/shared/);
  });

  test("requires exactly one canonical route when a content id has multiple URLs", () => {
    const writing = [
      record({
        id: "shared",
        sourcePath: "shared.md",
        attributes: { title: "Shared" },
      }),
    ];
    expect(() =>
      resolveItemRoutes(
        [
          {
            path: "/a/:slug",
            collection: "writing",
            match: ":slug.md",
            canonical: false,
          },
          {
            path: "/b/:slug",
            collection: "writing",
            match: ":slug.md",
            canonical: false,
          },
        ],
        { writing },
      ),
    ).toThrow(/must declare exactly one canonical route/);
  });
});

describe("publishRoutes", () => {
  test("assigns canonical URLs and produces routes from one item-route resolve", () => {
    const item = record({
      id: "hello-content",
      sourcePath: "hello.md",
      attributes: { title: "Hello" },
    });
    const program = makeProgram({
      itemRoutes: [
        {
          path: "/writing/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: true,
        },
      ],
      pagePlans: [
        makePlan({
          id: "article:0:/writing/:slug",
          pathPattern: "/writing/:slug",
          publish(snapshot) {
            const published = snapshot.byId.get("hello-content");
            return [
              Object.freeze({
                path: published?.url ?? "",
                title: "Hello",
                planId: "article:0:/writing/:slug",
                publishData: Object.freeze({ item: published }),
              }),
            ];
          },
        }),
        makePlan({
          id: "home:1:/",
          pathPattern: "/",
          publish(snapshot) {
            const items = snapshot.byCollection.writing ?? [];
            return [
              Object.freeze({
                path: "/",
                title: "Diitey",
                planId: "home:1:/",
                publishData: Object.freeze({ items }),
              }),
            ];
          },
        }),
      ],
    });
    const content = assembleContentSnapshot(program, [item], "v1");
    expect(content.byId.get("hello-content")?.url).toBe("");

    const candidate = publishRoutes(program, content);

    expect(candidate.programRevision).toBe("rev-1");
    expect(candidate.version).toBe("v1");
    expect(candidate.content.byId.get("hello-content")?.url).toBe(
      "/writing/hello",
    );
    expect(
      (candidate.content.byCollection.writing?.[0] as ContentRecord).url,
    ).toBe("/writing/hello");
    expect(candidate.routes.map((entry) => entry.path).sort()).toEqual([
      "/",
      "/writing/hello",
    ]);
    const home = candidate.routes.find((entry) => entry.path === "/");
    const listed = home?.publishData.items as ContentRecord[];
    expect(listed[0]?.url).toBe("/writing/hello");
  });

  test("item page plans receive pre-resolved paths and do not need a second match walk", () => {
    const item = record({
      id: "hello-content",
      sourcePath: "hello.md",
      attributes: { title: "Hello" },
    });
    let received: readonly ResolvedItemRoute[] | undefined;
    const program = makeProgram({
      itemRoutes: [
        {
          path: "/writing/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: true,
        },
      ],
      pagePlans: [
        Object.freeze({
          id: "article:0:/writing/:slug",
          pageName: "article",
          pathPattern: "/writing/:slug",
          publish(
            _snapshot: ContentSnapshot,
            resolvedItems?: readonly ResolvedItemRoute[],
          ) {
            received = resolvedItems;
            return Object.freeze(
              (resolvedItems ?? []).map((entry) =>
                Object.freeze({
                  path: entry.path,
                  title: "Hello",
                  planId: "article:0:/writing/:slug",
                  publishData: Object.freeze({ item: entry.item }),
                }),
              ),
            );
          },
          render: async () => "",
        }),
      ],
    });
    const content = assembleContentSnapshot(program, [item], "v1");
    const candidate = publishRoutes(program, content);

    expect(received).toEqual([
      {
        path: "/writing/hello",
        item: expect.objectContaining({
          id: "hello-content",
          sourcePath: "hello.md",
        }),
      },
    ]);
    expect(candidate.routes).toHaveLength(1);
    expect(candidate.routes[0]?.path).toBe("/writing/hello");
  });

  test("startup path materializes through publishRoutes", () => {
    const item = record({
      id: "hello-content",
      sourcePath: "hello.md",
      attributes: { title: "Hello" },
    });
    const program = makeProgram({
      itemRoutes: [
        {
          path: "/writing/:slug",
          collection: "writing",
          match: ":slug.md",
          canonical: true,
        },
      ],
      pagePlans: [
        makePlan({
          id: "article:0:/writing/:slug",
          pathPattern: "/writing/:slug",
          publish(
            _snapshot: ContentSnapshot,
            resolvedItems?: readonly ResolvedItemRoute[],
          ) {
            return (resolvedItems ?? []).map((entry) =>
              Object.freeze({
                path: entry.path,
                title: "Hello",
                planId: "article:0:/writing/:slug",
                publishData: Object.freeze({ item: entry.item }),
              }),
            );
          },
        }),
      ],
      programRevision: "rev-startup",
    });
    const content = assembleContentSnapshot(program, [item], "v-startup");
    const publication = buildEffectivePublication(program, content);

    expect(publication.programRevision).toBe("rev-startup");
    expect(publication.routesByPath.get("/writing/hello")?.planId).toBe(
      "article:0:/writing/:slug",
    );
    expect(publication.contentIds.has("hello-content")).toBe(true);
    expect(publication.content.byId.get("hello-content")?.url).toBe(
      "/writing/hello",
    );
  });

  test("materializePublication rejects a mismatched programRevision", () => {
    const program = makeProgram({
      pagePlans: [
        makePlan({
          id: "home:0:/",
          pathPattern: "/",
          publish: () => [
            Object.freeze({
              path: "/",
              title: "Diitey",
              planId: "home:0:/",
              publishData: Object.freeze({}),
            }),
          ],
        }),
      ],
      programRevision: "rev-a",
    });
    const content = assembleContentSnapshot(program, [], "v1");
    const candidate = publishRoutes(program, content);
    const other = makeProgram({
      pagePlans: program.pagePlans,
      programRevision: "rev-b",
    });

    expect(() => materializePublication(other, candidate)).toThrow(
      /programRevision does not match/,
    );
  });
});
