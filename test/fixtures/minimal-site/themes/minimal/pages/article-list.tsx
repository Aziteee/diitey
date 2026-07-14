import { type ContentRecord, useThemeConfig } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

interface ArticleListProps {
  items: readonly ContentRecord[];
}

export default function ArticleList({ items }: ArticleListProps) {
  const config = useThemeConfig<MinimalThemeConfig>();

  return (
    <main>
      <p data-site-name>{config.siteName}</p>
      <h1>Writing</h1>
      <ol>
        {items.map((item) => (
          <li>
            <a href={item.url}>{String(item.attributes.title)}</a>
          </li>
        ))}
      </ol>
    </main>
  );
}
