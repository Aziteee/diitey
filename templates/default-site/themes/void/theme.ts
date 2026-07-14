import { collection, defineTheme, page, route } from "diitey";
import { z } from "zod";

const voidThemeConfig = z
  .object({
    siteName: z.string().trim().min(1),
    siteDescription: z.string().trim().min(1),
    language: z.string().trim().min(1),
    postsPerPage: z.number().int().positive().max(100),
  })
  .strict()
  .default({
    siteName: "void",
    siteDescription: "在空白处，写下一些东西。",
    language: "zh-CN",
    postsPerPage: 10,
  });

export type VoidThemeConfig = z.infer<typeof voidThemeConfig>;

export default defineTheme({
  config: voidThemeConfig,
  setup(config) {
    return {
      document: "document",
      styles: "styles",
      collections: {
        posts: collection({
          from: "posts/*.md",
          where: { draft: { not: true } },
          orderBy: [{ field: "created", direction: "desc" }],
          schema: {
            title: "string",
            draft: "boolean?",
          },
        }),
        home: collection({
          from: "home.md",
          schema: {
            title: "string",
          },
        }),
      },
      routes: [
        route(
          "/",
          page("home", {
            home: {
              collection: "home",
              limit: 1,
            },
            posts: {
              collection: "posts",
              paginate: config.postsPerPage,
            },
          }),
        ),
        route(
          "/archives/:slug",
          page("post", {
            post: {
              collection: "posts",
              match: "posts/:slug.md",
            },
          }),
        ),
      ],
    };
  },
});
