import { defineSite } from "../../../src/index.ts";

export default defineSite({
  theme: "./themes/minimal/theme.ts",
  plugins: ["./plugins/todo-list/plugin.ts"],
});
