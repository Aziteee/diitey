import {
  collection,
  defineTheme,
  page,
  route,
} from "../../../../../src/index.ts";

export default defineTheme({
  collections: {
    writing: collection({
      from: "hello.md",
      schema: {
        title: "string",
        tags: "string[]?",
        draft: "boolean?",
        rating: "number?",
      },
    }),
    articles: collection({
      from: "articles/*/*.md",
      where: { draft: { not: true } },
      orderBy: [{ field: "created", direction: "desc" }],
      schema: {
        title: "string",
        tags: "string[]?",
        draft: "boolean?",
      },
    }),
  },
  routes: [
    route(
      "/writing/hello",
      page("article", {
        item: { collection: "writing", match: "hello.md" },
      }),
    ),
    route(
      "/writing",
      page("article-list", {
        items: { collection: "articles", paginate: 2 },
      }),
    ),
    route(
      "/writing/:year/:slug",
      page("article", {
        item: {
          collection: "articles",
          match: "articles/:year/:slug.md",
        },
      }),
    ),
    route(
      "/island-demo",
      page("island-demo", {
        items: { collection: "writing", limit: 1 },
      }),
    ),
  ],
});
