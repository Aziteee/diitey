import { type ContentRecord, useThemeConfig } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

interface HomeProps {
  readonly items: readonly ContentRecord[];
}

export default function Home({ items }: HomeProps) {
  const config = useThemeConfig<MinimalThemeConfig>();

  return (
    <main class="max-w-2xl p-5">
      <p data-site-name>{config.siteName}</p>
      <p data-home-intro>{config.homeIntro}</p>
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
