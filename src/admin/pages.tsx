import { h, type ComponentType, type VNode } from "preact";
import { Island } from "../islands.ts";

export function AdminHomePage(props: Record<string, unknown>): VNode {
  const pages = (props.pages ?? []) as readonly {
    readonly pluginId: string;
    readonly title: string;
  }[];
  return (
    <main>
      <h1>Admin</h1>
      {pages.length === 0 ? (
        <p>No plugin admin pages are registered.</p>
      ) : (
        <ul>
          {pages.map((page) => (
            <li class="diitey-admin-card">
              <a href={`/_admin/${page.pluginId}`}>{page.title}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function AdminPluginIslandPage(props: Record<string, unknown>): VNode {
  const islandName = props.islandName as string;
  const Component = props.Component as ComponentType<Record<string, unknown>>;
  const data = props.data;
  return (
    <main>
      <Island
        name={islandName}
        component={Component}
        props={{ data }}
      />
    </main>
  );
}

export function AdminLoginPage(props: Record<string, unknown>): VNode {
  const error = (props.error as string | null | undefined) ?? null;
  return (
    <main class="diitey-admin-login">
      <h1>Admin login</h1>
      {error ? <p class="diitey-admin-error">{error}</p> : null}
      <form method="post" action="/_admin/login">
        <label for="token">Token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

export function AdminErrorPage(props: Record<string, unknown>): VNode {
  const title = String(props.title ?? "Error");
  const message = String(props.message ?? "");
  const requestId = props.requestId as string | undefined;
  return (
    <main>
      <h1>{title}</h1>
      <p>{message}</p>
      {requestId ? <p>Request ID: {requestId}</p> : null}
    </main>
  );
}
