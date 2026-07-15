import { h, type ComponentChildren, type VNode } from "preact";

export interface AdminDocumentProps {
  readonly title: string;
  readonly stylesheetPath: string | null;
  readonly csrfToken?: string | null;
  readonly showNav?: boolean;
  readonly pages?: readonly { readonly pluginId: string; readonly title: string }[];
  readonly children?: ComponentChildren;
}

export function AdminDocument({
  title,
  stylesheetPath,
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
      </head>
      <body>
        <div class="diitey-admin">
          {showNav ? (
            <nav class="diitey-admin-nav">
              <a href="/_admin">Admin</a>
              {pages.map((page) => (
                <a href={`/_admin/${page.pluginId}`}>{page.title}</a>
              ))}
              {csrfToken ? (
                <form method="post" action="/_admin/logout">
                  <input type="hidden" name="csrf" value={csrfToken} />
                  <button type="submit">Log out</button>
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
