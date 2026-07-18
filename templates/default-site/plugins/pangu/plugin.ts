import { definePlugin } from "diitey";
import pangu from "pangu";
import type { Root, Text } from "mdast";
import { visit } from "unist-util-visit";

function remarkPangu() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text) => {
      node.value = pangu.spacingText(node.value);
    });
  };
}

export default definePlugin({
  name: "pangu",
  markdown: {
    remarkPlugins: [remarkPangu],
  },
});
