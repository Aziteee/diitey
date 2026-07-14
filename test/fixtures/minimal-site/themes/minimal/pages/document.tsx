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
    <html lang="en" class="scheme-light-dark font-sans">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body class="m-0 leading-normal">
        <header
          class="flex gap-4 border-b border-neutral-300 px-5 py-4"
          data-document-chrome="site-nav"
        >
          <strong>{config.siteName}</strong>
          <a class="text-inherit no-underline" href="/">
            Home
          </a>
          <a class="text-inherit no-underline" href="/writing">
            Writing
          </a>
          <a class="text-inherit no-underline" href="/todos">
            Todos
          </a>
          <a class="text-inherit no-underline" href="/island-demo">
            Islands
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
