import type { ComponentChildren } from "preact";
import { useThemeConfig, useThemeStylesheet } from "diitey";
import type { MinimalThemeConfig } from "../theme.ts";

export default function Document({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  const config = useThemeConfig<MinimalThemeConfig>();
  const stylesheet = useThemeStylesheet();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href={stylesheet} />
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
