import { defineSite } from "diitey";

export default defineSite({
  theme: {
    use: "./themes/minimal/theme.ts",
    config: {
      siteName: "Diitey Minimal Site",
      articlePageSize: 2,
    },
  },
  plugins: [
    {
      use: "./plugins/todo-list/plugin.ts",
      config: {
        maxTitleLength: 100,
      },
    },
  ],
});
