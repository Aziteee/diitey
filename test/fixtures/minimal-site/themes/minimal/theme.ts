import {
  collection,
  defineTheme,
  page,
  route,
} from "diitey";
import { z } from "zod";

const minimalThemeConfig = z
  .object({
    siteName: z.string().trim().min(1),
    articlePageSize: z.number().int().positive().max(100),
    homeIntro: z.string().trim().min(1),
  })
  .strict()
  .default({
    siteName: "Diitey Minimal Site",
    articlePageSize: 2,
    homeIntro: "Welcome to the Diitey minimal site.",
  });

export type MinimalThemeConfig = z.infer<typeof minimalThemeConfig>;

export default defineTheme({
  config: minimalThemeConfig,
  setup(config) {
    return {
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
          "/",
          page("home", {
            items: {
              collection: "articles",
              paginate: config.articlePageSize,
            },
          }),
        ),
        route(
          "/writing/hello",
          page("article", {
            item: { collection: "writing", match: "hello.md" },
          }),
        ),
        route(
          "/writing",
          page("article-list", {
            items: {
              collection: "articles",
              paginate: config.articlePageSize,
            },
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
        route(
          "/todos",
          page("todo-list", {
            items: { service: "todo.list", input: {} },
          }),
        ),
      ],
    };
  },
});
