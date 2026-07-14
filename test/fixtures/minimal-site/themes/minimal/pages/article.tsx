import { type ContentRecord, useThemeConfig } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

interface ArticleProps {
  item: ContentRecord;
}

export default function Article({ item }: ArticleProps) {
  const title = String(item.attributes.title);
  const config = useThemeConfig<MinimalThemeConfig>();

  return (
    <main class="max-w-2xl p-5">
      <p data-site-name>{config.siteName}</p>
      <h1>{title}</h1>
      <div dangerouslySetInnerHTML={{ __html: item.html }} />
    </main>
  );
}
