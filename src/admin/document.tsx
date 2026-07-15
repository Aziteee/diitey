import { h, type ComponentChildren, type VNode } from "preact";

export interface AdminDocumentProps {
  readonly title: string;
  readonly stylesheetPath: string | null;
  readonly extraStylesheetPaths?: readonly string[];
  readonly csrfToken?: string | null;
  readonly showNav?: boolean;
  readonly pages?: readonly { readonly pluginId: string; readonly title: string }[];
  readonly children?: ComponentChildren;
}

export function AdminDocument({
  title,
  stylesheetPath,
  extraStylesheetPaths = [],
  csrfToken,
  showNav = false,
  pages = [],
  children,
}: AdminDocumentProps): VNode {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {stylesheetPath ? <link rel="stylesheet" href={stylesheetPath} /> : null}
        {extraStylesheetPaths.map((path) => (
          <link rel="stylesheet" href={path} />
        ))}
      </head>
      <body>
        <div class="mx-auto max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
          {showNav ? (
            <nav class="mb-8 flex flex-wrap items-center gap-1 border-b border-zinc-800 pb-4">
              <a
                href="/_admin"
                class="rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                Admin
              </a>
              {pages.map((page) => (
                <a
                  href={`/_admin/${page.pluginId}`}
                  class="rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  {page.title}
                </a>
              ))}
              {csrfToken ? (
                <form method="post" action="/_admin/logout" class="ml-auto">
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <button
                    type="submit"
                    class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
                  >
                    Log out
                  </button>
                </form>
              ) : null}
            </nav>
          ) : null}
          {children}
        </div>
      </body>
    </html>
  );
}
