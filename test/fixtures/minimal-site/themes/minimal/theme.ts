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
      schema: { title: "string" },
    }),
  },
  routes: [
    route(
      "/writing/hello",
      page("article", {
        item: { collection: "writing", match: "hello.md" },
      }),
    ),
  ],
});
