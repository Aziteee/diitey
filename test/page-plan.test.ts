import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { ContentRecord } from "../src/index.ts";
import type { ContentSnapshot } from "../src/publication/content-snapshot.ts";
import {
  compilePageBindings,
  compilePagePlan,
  publishPageEntries,
} from "../src/publication/page-plan.ts";

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

function snapshot(
  records: readonly ContentRecord[],
  collectionName = "writing",
): ContentSnapshot {
  const frozen = Object.freeze(
    records.map((entry) =>
      Object.freeze({
        ...entry,
        attributes: Object.freeze({ ...entry.attributes }),
      }),
    ),
  );
  return Object.freeze({
    version: "v1",
    publishedAt: "2026-07-14T00:00:00.000Z",
    records: frozen,
    byId: Object.freeze(
      new Map(frozen.map((entry) => [entry.id, entry] as const)),
    ),
    byCollection: Object.freeze({
      [collectionName]: frozen,
    }),
  });
}

describe("Page Plan stages", () => {
  test("compilePageBindings rejects more than one item binding", () => {
    expect(() =>
      compilePageBindings({
        pathPattern: "/writing/:slug",
        pageName: "article",
        data: {
          primary: { collection: "writing", match: ":slug.md" },
          secondary: { collection: "writing", match: ":slug.md" },
        },
      }),
    ).toThrow(/only one item binding/);
  });

  test("compilePageBindings rejects parameterized routes without an item binding", () => {
    expect(() =>
      compilePageBindings({
        pathPattern: "/writing/:slug",
        pageName: "article",
        data: {
          items: { collection: "writing" },
        },
      }),
    ).toThrow(/has parameters but no item binding/);
  });

  test("compilePageBindings rejects more than one paginated list", () => {
    expect(() =>
      compilePageBindings({
        pathPattern: "/",
        pageName: "home",
        data: {
          a: { collection: "writing", paginate: 2 },
          b: { collection: "writing", paginate: 3 },
        },
      }),
    ).toThrow(/paginate only one binding/);
  });

  test("compilePageBindings rejects unknown plugin services", () => {
    expect(() =>
      compilePageBindings({
        pathPattern: "/",
        pageName: "home",
        data: {
          comments: { service: "missing.list", input: {} },
        },
      }),
    ).toThrow(/Unknown plugin service/);
  });

  test("compilePageBindings rejects cyclic service references", () => {
    const pluginRuntime = {
      services: Object.freeze({
        "a.run": {
          input: { parse: (value: unknown) => value },
          output: { parse: (value: unknown) => value },
          handler: async () => ({}),
        },
        "b.run": {
          input: { parse: (value: unknown) => value },
          output: { parse: (value: unknown) => value },
          handler: async () => ({}),
        },
      }),
      actions: Object.freeze({}),
    };
    expect(() =>
      compilePageBindings({
        pathPattern: "/",
        pageName: "home",
        pluginRuntime,
        data: {
          left: {
            service: "a.run",
            input: { other: { from: "right" } },
          },
          right: {
            service: "b.run",
            input: { other: { from: "left" } },
          },
        },
      }),
    ).toThrow(/cyclic service data references/);
  });

  test("publishPageEntries builds item routes from pre-resolved paths without Islands", () => {
    const item = record({
      id: "hello",
      sourcePath: "hello.md",
      attributes: { title: "Hello" },
      url: "/writing/hello",
    });
    const stages = compilePageBindings({
      pathPattern: "/writing/:slug",
      pageName: "article",
      data: {
        item: { collection: "writing", match: ":slug.md" },
      },
    });
    const entries = publishPageEntries({
      planId: "article:0:/writing/:slug",
      pathPattern: "/writing/:slug",
      stages,
      snapshot: snapshot([item]),
      resolvedItems: [{ path: "/writing/hello", item }],
      renderThemePage: (data) =>
        `<h1>${(data.item as ContentRecord).attributes.title}</h1>`,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("/writing/hello");
    expect(entries[0]?.title).toBe("Hello");
    expect(entries[0]?.body).toBe("<h1>Hello</h1>");
  });

  test("publishPageEntries paginates list bindings without Island build", () => {
    const items = [
      record({
        id: "a",
        sourcePath: "a.md",
        attributes: { title: "A" },
      }),
      record({
        id: "b",
        sourcePath: "b.md",
        attributes: { title: "B" },
      }),
      record({
        id: "c",
        sourcePath: "c.md",
        attributes: { title: "C" },
      }),
    ];
    const stages = compilePageBindings({
      pathPattern: "/",
      pageName: "home",
      data: {
        posts: { collection: "writing", paginate: 2 },
      },
    });
    const entries = publishPageEntries({
      planId: "home:0:/",
      pathPattern: "/",
      stages,
      snapshot: snapshot(items),
      renderThemePage: (data) => {
        const pageItems = data.posts as ContentRecord[];
        return pageItems.map((entry) => entry.attributes.title).join(",");
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.pagination?.pageSize).toBe(2);
    expect(entries[0]?.pagination?.items).toHaveLength(3);
    expect(entries[0]?.pagination?.bodies).toEqual(["A,B", "C"]);
    expect(entries[0]?.body).toBe("A,B");
  });

  test("compilePagePlan works from in-memory definitions without Island build", () => {
    const item = record({
      id: "hello",
      sourcePath: "hello.md",
      attributes: { title: "Hello" },
      url: "/writing/hello",
    });
    const plan = compilePagePlan({
      id: "article:0:/writing/:slug",
      pathPattern: "/writing/:slug",
      pageName: "article",
      Page: ({ item: pageItem }: Record<string, unknown>) =>
        h(
          "h1",
          null,
          String((pageItem as ContentRecord | undefined)?.attributes.title ?? ""),
        ),
      data: {
        item: { collection: "writing", match: ":slug.md" },
      },
      pluginRuntime: {
        services: Object.freeze({}),
        actions: Object.freeze({}),
      },
    });
    const entries = plan.publish(snapshot([item]), [
      { path: "/writing/hello", item },
    ]);

    expect(entries[0]?.path).toBe("/writing/hello");
    expect(entries[0]?.body).toContain("Hello");
  });
});
