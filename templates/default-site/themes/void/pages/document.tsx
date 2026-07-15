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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                if (!CSS.supports("view-transition-name", "none")) return;

                var TITLE = "post-title";
                var STORE_KEY = "void-vt-path";

                function pathnameOf(url) {
                  try {
                    return new URL(url, location.origin).pathname.replace(/\\/+$/, "") || "/";
                  } catch (e) {
                    return null;
                  }
                }

                function clearHomeNames() {
                  document.querySelectorAll("[data-vt-title]").forEach(function (el) {
                    el.style.viewTransitionName = "";
                  });
                }

                function setHomeNamesForUrl(url) {
                  clearHomeNames();
                  var path = pathnameOf(url);
                  if (!path || path === "/") return false;
                  var links = document.querySelectorAll("a[href]");
                  for (var i = 0; i < links.length; i++) {
                    var link = links[i];
                    var href = link.getAttribute("href");
                    if (!href || pathnameOf(href) !== path) continue;
                    var titleEl = link.querySelector("[data-vt-title]");
                    if (!titleEl) continue;
                    titleEl.style.viewTransitionName = TITLE;
                    return true;
                  }
                  return false;
                }

                function isHomeList() {
                  return Boolean(document.querySelector("[data-vt-title]"));
                }

                function isPostPage() {
                  return Boolean(document.querySelector("[data-vt-post-title]"));
                }

                function rememberPath(url) {
                  var path = pathnameOf(url || location.href);
                  if (path) {
                    try { sessionStorage.setItem(STORE_KEY, path); } catch (e) {}
                  }
                }

                function rememberedPath() {
                  try { return sessionStorage.getItem(STORE_KEY); } catch (e) { return null; }
                }

                function activationFromUrl() {
                  try {
                    if (window.navigation && navigation.activation && navigation.activation.from) {
                      return navigation.activation.from.url;
                    }
                  } catch (e) {}
                  return null;
                }

                function activationToUrl(event) {
                  try {
                    if (event.activation && event.activation.entry) {
                      return event.activation.entry.url;
                    }
                  } catch (e) {}
                  return null;
                }

                document.addEventListener("click", function (event) {
                  var link = event.target instanceof Element
                    ? event.target.closest("a[href]")
                    : null;
                  if (!link) return;
                  if (link.querySelector("[data-vt-title]")) {
                    setHomeNamesForUrl(link.href);
                    rememberPath(link.href);
                    return;
                  }
                  if (isPostPage() && pathnameOf(link.href) === "/") {
                    rememberPath(location.href);
                  }
                }, true);

                window.addEventListener("pageswap", function (event) {
                  if (!event.viewTransition) return;
                  if (isHomeList()) {
                    var to = activationToUrl(event);
                    if (to) {
                      setHomeNamesForUrl(to);
                      rememberPath(to);
                    }
                    return;
                  }
                  if (isPostPage()) {
                    rememberPath(location.href);
                  }
                });

                window.addEventListener("pagereveal", function (event) {
                  if (!event.viewTransition) return;
                  if (isHomeList()) {
                    var from = activationFromUrl() || rememberedPath();
                    if (from) setHomeNamesForUrl(from);
                  }
                  event.viewTransition.finished.then(clearHomeNames, clearHomeNames);
                });
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
