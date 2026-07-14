import { type ContentRecord, type Pagination, useThemeConfig } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

interface ArticleListProps {
  readonly items: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function ArticleList({ items, pagination }: ArticleListProps) {
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
      <nav data-pagination>
        {pagination.prevHref ? (
          <a href={pagination.prevHref} rel="prev">
            Previous
          </a>
        ) : null}
        {pagination.nextHref ? (
          <a href={pagination.nextHref} rel="next">
            Next
          </a>
        ) : null}
      </nav>
    </main>
  );
}
