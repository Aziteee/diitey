import type { ContentRecord } from "../../../../../../src/index.ts";

interface ArticleListProps {
  items: readonly ContentRecord[];
}

export default function ArticleList({ items }: ArticleListProps) {
  return (
    <main>
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
