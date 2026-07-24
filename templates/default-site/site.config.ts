import { defineSite } from "diitey";

export default defineSite({
  theme: {
    use: "./themes/void/theme.ts",
    config: {
      siteName: "void",
      siteDescription: "在空白处，写下一些东西。",
      language: "zh-CN",
      homePosts: 6,
      homeNotes: 3,
      postsPerPage: 10,
      notesPerPage: 10,
    },
  },
  plugins: [
    {
      use: "./plugins/meting/plugin.ts",
    },
    {
      use: "./plugins/shiki/plugin.ts",
      config: {
        lightTheme: "vitesse-light",
        darkTheme: "vitesse-dark",
      },
    },
    {
      use: "./plugins/pangu/plugin.ts",
    },
    {
      use: "./plugins/link-card/plugin.ts",
    },
    {
      use: "./plugins/comments/plugin.ts",
      config: {
        maxBodyLength: 2000,
        maxAuthorNameLength: 40,
      },
    },
  ],
});
