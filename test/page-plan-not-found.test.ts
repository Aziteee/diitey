import { describe, expect, test } from "bun:test";
import {
  compilePageBindings,
  publishPageEntries,
} from "../src/publication/page-plan.ts";
import type { ContentSnapshot } from "../src/publication/content-snapshot.ts";

const emptySnapshot: ContentSnapshot = Object.freeze({
  version: "v1",
  publishedAt: "2026-01-01T00:00:00.000Z",
  records: Object.freeze([]),
  resources: Object.freeze([]),
  byId: Object.freeze(new Map()),
  byCollection: Object.freeze({}),
});

describe("not-found page plan", () => {
  test("not-found route * allows empty data bindings", () => {
    const stages = compilePageBindings({
      pathPattern: "*",
      pageName: "not-found",
      data: {},
    });
    expect(stages.bindings).toEqual([]);
    expect(stages.hasServices).toBe(false);
  });

  test("ordinary routes still require data bindings", () => {
    expect(() =>
      compilePageBindings({
        pathPattern: "/",
        pageName: "home",
        data: {},
      }),
    ).toThrow("must declare data");
  });

  test("not-found route does not publish a path entry", () => {
    const stages = compilePageBindings({
      pathPattern: "*",
      pageName: "not-found",
      data: {},
    });
    const entries = publishPageEntries({
      planId: "not-found:0:*",
      pathPattern: "*",
      stages,
      snapshot: emptySnapshot,
    });
    expect(entries).toEqual([]);
  });
});
