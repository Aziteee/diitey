import { collection, defineTheme, page, route } from "diitey";
import { z } from "zod";

const voidThemeConfig = z
  .object({
    siteName: z.string().trim().min(1),
    siteDescription: z.string().trim().min(1),
    language: z.string().trim().min(1),
    homePosts: z.number().int().positive().max(100),
    homeNotes: z.number().int().positive().max(100),
    postsPerPage: z.number().int().positive().max(100),
    notesPerPage: z.number().int().positive().max(100),
    beian: z.string().trim().optional(),
  })
  .strict()
  .default({
    siteName: "void",
    siteDescription: "在空白处，写下一些东西。",
    language: "zh-CN",
    homePosts: 6,
    homeNotes: 3,
    postsPerPage: 10,
    notesPerPage: 20,
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
            tags: "string[]?",
          },
        }),
        notes: collection({
          from: "notes/*.md",
          where: { draft: { not: true } },
          orderBy: [{ field: "created", direction: "desc" }],
          schema: {
            draft: "boolean?",
          },
        }),
        home: collection({
          from: "home.md",
          schema: {
            title: "string",
          },
        }),
        links: collection({
          from: "links.md",
          schema: {
            title: "string?",
          },
        }),
        pages: collection({
          from: "pages/*.md",
          where: { draft: { not: true } },
          schema: {
            title: "string?",
            draft: "boolean?",
            comments: "boolean?",
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
              paginate: config.homePosts,
            },
            notes: {
              collection: "notes",
            },
            links: {
              collection: "links",
              limit: 1,
            },
            commentCounts: {
              service: "comments.counts",
              input: {
                contentIds: { from: "notes" },
              },
            },
          }),
        ),
        route(
          "/archives",
          page("archives", {
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
        route(
          "/tags",
          page("tags", {
            posts: {
              collection: "posts",
            },
          }),
        ),
        route(
          "/notes",
          page("notes", {
            notes: {
              collection: "notes",
              paginate: config.notesPerPage,
            },
            commentCounts: {
              service: "comments.counts",
              input: {
                contentIds: { from: "notes" },
              },
            },
          }),
        ),
        route(
          "/:slug",
          page("page", {
            page: {
              collection: "pages",
              match: "pages/:slug.md",
            },
          }),
        ),
        route("*", page("not-found", {})),
      ],
    };
  },
});

