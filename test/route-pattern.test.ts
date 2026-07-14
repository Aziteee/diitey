import { describe, expect, test } from "bun:test";
import {
  buildRoutePath,
  compileCollectionMatchers,
  matchPathPattern,
  normalizeRoutePath,
  validateRoutePatterns,
} from "../src/publication/route-pattern.ts";

describe("route-pattern", () => {
  test("matchPathPattern extracts named parameters from a source path", () => {
    expect(
      matchPathPattern("articles/:year/:slug.md", "articles/2026/nested.md"),
    ).toEqual({ year: "2026", slug: "nested" });
  });

  test("matchPathPattern returns null when the source path does not match", () => {
    expect(
      matchPathPattern("articles/:year/:slug.md", "notes/hello.md"),
    ).toBeNull();
  });

  test("matchPathPattern supports a file extension after a parameter", () => {
    expect(matchPathPattern(":slug.md", "hello.md")).toEqual({ slug: "hello" });
    expect(matchPathPattern(":slug.md", "hello.mdx")).toBeNull();
  });

  test("matchPathPattern treats * as a single path segment wildcard", () => {
    expect(matchPathPattern("posts/*/index.md", "posts/a/index.md")).toEqual(
      {},
    );
    expect(
      matchPathPattern("posts/*/index.md", "posts/a/b/index.md"),
    ).toBeNull();
  });

  test("matchPathPattern normalizes Windows separators in patterns and paths", () => {
    expect(
      matchPathPattern("articles\\:year\\:slug.md", "articles\\2026\\x.md"),
    ).toEqual({ year: "2026", slug: "x" });
  });

  test("buildRoutePath substitutes parameters and normalizes trailing slashes", () => {
    expect(
      buildRoutePath("/writing/:year/:slug/", {
        year: "2026",
        slug: "nested",
      }),
    ).toBe("/writing/2026/nested");
  });

  test("buildRoutePath percent-encodes parameter values", () => {
    expect(
      buildRoutePath("/writing/:slug", { slug: "hello world" }),
    ).toBe("/writing/hello%20world");
  });

  test("buildRoutePath fails when a required parameter is missing", () => {
    expect(() => buildRoutePath("/writing/:slug", {})).toThrow(
      "Route parameter :slug cannot be generated",
    );
  });

  test("normalizeRoutePath keeps root and strips trailing slashes", () => {
    expect(normalizeRoutePath("/")).toBe("/");
    expect(normalizeRoutePath("/writing/")).toBe("/writing");
    expect(normalizeRoutePath("/writing//")).toBe("/writing");
  });

  test("compileCollectionMatchers matches collection globs against source paths", () => {
    const matchers = compileCollectionMatchers({
      writing: {
        from: "articles/*/*.md",
        schema: { title: "string" },
      },
    });
    expect(matchers.writing!("articles/2026/nested.md")).toBe(true);
    expect(matchers.writing!("notes/hello.md")).toBe(false);
  });

  test("compileCollectionMatchers rejects invalid globs", () => {
    expect(() =>
      compileCollectionMatchers({
        bad: { from: "articles/[", schema: {} },
      }),
    ).toThrow(/Invalid collection glob bad/);
  });

  test("validateRoutePatterns requires absolute non-reserved paths", () => {
    expect(() =>
      validateRoutePatterns([{ path: "writing/:slug" }]),
    ).toThrow("Route path must start with /");
    expect(() =>
      validateRoutePatterns([{ path: "/assets/logo.png" }]),
    ).toThrow("reserved path");
  });

  test("validateRoutePatterns rejects ambiguous parameter shapes", () => {
    expect(() =>
      validateRoutePatterns([
        { path: "/writing/:slug" },
        { path: "/writing/:id" },
      ]),
    ).toThrow(/Ambiguous route patterns/);
  });

  test("validateRoutePatterns accepts distinct shapes", () => {
    expect(() =>
      validateRoutePatterns([
        { path: "/writing/:slug" },
        { path: "/writing/:year/:slug" },
        { path: "/" },
      ]),
    ).not.toThrow();
  });
});
