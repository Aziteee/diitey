import { defineSite } from "diitey";

export default defineSite({
  theme: {
    use: "./themes/void/theme.ts",
    config: {
      siteName: "void",
      siteDescription: "在空白处，写下一些东西。",
      language: "zh-CN",
      postsPerPage: 10,
    },
  },
});
