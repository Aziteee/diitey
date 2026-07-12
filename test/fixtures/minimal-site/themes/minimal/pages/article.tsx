import type { ContentRecord } from "../../../../../../src/index.ts";

interface ArticleProps {
  item: ContentRecord;
}

export default function Article({ item }: ArticleProps) {
  const title = String(item.attributes.title);

  return (
    <main>
      <h1>{title}</h1>
      <div dangerouslySetInnerHTML={{ __html: item.html }} />
    </main>
  );
}
