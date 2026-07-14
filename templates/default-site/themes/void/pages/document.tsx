import type { ComponentChildren } from "preact";
import { useThemeConfig, useThemeStylesheet } from "diitey";
import type { VoidThemeConfig } from "../theme.ts";

export default function Document({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  const config = useThemeConfig<VoidThemeConfig>();
  const stylesheet = useThemeStylesheet();
  const documentTitle =
    title === "Diitey" ? config.siteName : `${title} — ${config.siteName}`;

  return (
    <html lang={config.language}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={config.siteDescription} />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          content="#fafafa"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0a0a0a"
          media="(prefers-color-scheme: dark)"
        />
        <title>{documentTitle}</title>
        <link rel="stylesheet" href={stylesheet} />
      </head>
      <body class="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
