import { defineSite } from "diitey";

export default defineSite({
  theme: {
    use: "./themes/minimal/theme.ts",
    config: {
      siteName: "Diitey Minimal Site",
      articlePageSize: 2,
      homeIntro: "Welcome to the Diitey minimal site.",
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
