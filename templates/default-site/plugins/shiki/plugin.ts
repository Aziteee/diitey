import rehypeShiki from "@shikijs/rehype";
import { definePlugin } from "diitey";
import { z } from "zod";

const shikiPluginConfig = z
  .object({
    lightTheme: z.string().trim().min(1),
    darkTheme: z.string().trim().min(1),
  })
  .strict()
  .default({
    lightTheme: "vitesse-light",
    darkTheme: "vitesse-dark",
  });

export type ShikiPluginConfig = z.infer<typeof shikiPluginConfig>;

export default definePlugin({
  config: shikiPluginConfig,
  setup(config) {
    return {
      name: "shiki",
      markdown: {
        rehypePlugins: [
          [
            rehypeShiki,
            {
              themes: {
                light: config.lightTheme,
                dark: config.darkTheme,
              },
              // Default rehype-shiki preloads every bundled language (~300+).
              // Load only languages that appear in code fences.
              langs: [],
              lazy: true,
              // No default inline colors/bg — theme CSS owns surface + dual-theme switch.
              defaultColor: false,
            },
          ],
        ],
      },
    };
  },
});
