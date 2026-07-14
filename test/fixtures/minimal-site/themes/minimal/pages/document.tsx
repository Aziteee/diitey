import type { ComponentChildren } from "preact";
import { useThemeConfig } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

export default function Document({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  const config = useThemeConfig<MinimalThemeConfig>();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
          body { margin: 0; line-height: 1.5; }
          .site-chrome { display: flex; gap: 1rem; padding: 1rem 1.25rem; border-bottom: 1px solid #ccc; }
          .site-chrome a { color: inherit; }
          main { padding: 1.25rem; max-width: 42rem; }
        `}</style>
      </head>
      <body>
        <header class="site-chrome" data-document-chrome="site-nav">
          <strong>{config.siteName}</strong>
          <a href="/">Home</a>
          <a href="/writing">Writing</a>
          <a href="/todos">Todos</a>
          <a href="/island-demo">Islands</a>
        </header>
        {children}
      </body>
    </html>
  );
}
