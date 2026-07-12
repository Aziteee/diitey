import remarkDirective from "remark-directive";
import { definePlugin } from "../../../../../src/index.ts";

interface MarkdownNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownNode[];
}

interface HtmlNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

function remarkCallout() {
  return function transform(node: MarkdownNode): void {
    if (node.type === "containerDirective" && node.name === "callout") {
      node.data = {
        hName: "aside",
        hProperties: {
          className: ["callout"],
          "data-callout-type": node.attributes?.type ?? "note",
        },
      };
    }
    for (const child of node.children ?? []) transform(child);
  };
}

function rehypeCallout() {
  return function transform(node: HtmlNode): void {
    const className = node.properties?.className;
    if (
      node.tagName === "aside" &&
      Array.isArray(className) &&
      className.includes("callout")
    ) {
      node.properties!["data-static"] = "true";
    }
    for (const child of node.children ?? []) transform(child);
  };
}

export default definePlugin({
  name: "callout",
  markdown: {
    remarkPlugins: [remarkDirective, remarkCallout],
    rehypePlugins: [rehypeCallout],
  },
});
