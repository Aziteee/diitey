import { h, type ComponentType, type VNode } from "preact";
import { Island } from "../islands.ts";

export function AdminHomePage(props: Record<string, unknown>): VNode {
  const pages = (props.pages ?? []) as readonly {
    readonly pluginId: string;
    readonly title: string;
  }[];
  return (
    <main>
      <header class="mb-8">
        <p class="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Diitey
        </p>
        <h1 class="m-0 text-2xl font-semibold tracking-tight text-white">
          Admin
        </h1>
        <p class="mt-2 text-sm text-zinc-400">
          Manage plugin surfaces for this site.
        </p>
      </header>
      {pages.length === 0 ? (
        <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
          <p class="m-0 text-sm text-zinc-400">
            No plugin admin pages are registered.
          </p>
        </div>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          {pages.map((page) => (
            <li>
              <a
                href={`/_admin/${page.pluginId}`}
                class="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3.5 text-zinc-100 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <span class="font-medium">{page.title}</span>
                <span class="text-sm text-zinc-500 transition-colors group-hover:text-zinc-300">
                  Open →
                </span>
              </a>
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
    <main class="mx-auto mt-16 max-w-sm sm:mt-24">
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl shadow-black/20 sm:p-8">
        <header class="mb-6">
          <p class="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Diitey
          </p>
          <h1 class="m-0 text-xl font-semibold tracking-tight text-white">
            Admin login
          </h1>
          <p class="mt-2 text-sm text-zinc-400">
            Enter the admin token to continue.
          </p>
        </header>
        {error ? (
          <p
            class="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <form method="post" action="/_admin/login" class="flex flex-col gap-4">
          <div>
            <label
              for="token"
              class="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Token
            </label>
            <input
              id="token"
              name="token"
              type="password"
              autocomplete="current-password"
              required
              class="box-border w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          <button
            type="submit"
            class="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}

export function AdminErrorPage(props: Record<string, unknown>): VNode {
  const title = String(props.title ?? "Error");
  const message = String(props.message ?? "");
  const requestId = props.requestId as string | undefined;
  return (
    <main>
      <div class="rounded-xl border border-red-900/50 bg-red-950/30 px-5 py-6">
        <h1 class="m-0 text-xl font-semibold text-red-200">{title}</h1>
        <p class="mt-2 text-sm text-red-300/90">{message}</p>
        {requestId ? (
          <p class="mt-4 font-mono text-xs text-zinc-500">
            Request ID: {requestId}
          </p>
        ) : null}
      </div>
    </main>
  );
}
