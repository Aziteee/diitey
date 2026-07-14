import {
  type ContentRecord,
  type Pagination,
  useThemeConfig,
} from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import { formatDate } from "../shared/date.ts";

interface HomeProps {
  readonly posts: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function Home({ posts, pagination }: HomeProps) {
  const config = useThemeConfig<VoidThemeConfig>();

  return (
    <main class="mx-auto w-full max-w-[45rem] px-6 py-16 font-serif sm:px-8 sm:py-24">
      <header class="mb-20 sm:mb-28">
        <h1 class="m-0 text-5xl font-medium tracking-[-0.045em] sm:text-6xl">
          {config.siteName}
        </h1>
        <p class="mt-5 max-w-md text-base leading-7 text-neutral-600 dark:text-neutral-400">
          {config.siteDescription}
        </p>
      </header>

      <section aria-labelledby="writing-heading">
        <h2
          id="writing-heading"
          class="mb-8 text-xl font-medium tracking-[-0.02em] text-neutral-900 dark:text-neutral-100"
        >
          Writing
        </h2>
        {posts.length > 0 ? (
          <ol class="m-0 list-none p-0">
            {posts.map((post) => (
              <li class="-mx-4 border-b border-neutral-200 last:border-b-0 dark:border-neutral-800">
                <a
                  href={post.url}
                  class="group grid gap-2 px-4 py-5 no-underline outline-none transition-colors duration-300 hover:bg-white focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-neutral-300 sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-6 dark:hover:bg-neutral-900 dark:focus-visible:bg-neutral-900 dark:focus-visible:ring-neutral-700"
                >
                  <time
                    datetime={post.created}
                    class="text-sm tabular-nums text-neutral-500 transition-colors duration-300 group-hover:text-neutral-800 group-focus-visible:text-neutral-800 dark:text-neutral-500 dark:group-hover:text-neutral-200 dark:group-focus-visible:text-neutral-200"
                  >
                    {formatDate(post.created)}
                  </time>
                  <span class="text-lg font-normal leading-7 tracking-[-0.015em] text-neutral-700 transition-colors duration-300 group-hover:text-neutral-950 group-focus-visible:text-neutral-950 dark:text-neutral-300 dark:group-hover:text-white dark:group-focus-visible:text-white">
                    {String(post.attributes.title)}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p class="text-neutral-500 dark:text-neutral-500">尚无内容。</p>
        )}
      </section>

      {pagination.prevHref || pagination.nextHref ? (
        <nav
          aria-label="内容分页"
          class="mt-10 flex justify-between text-sm text-neutral-600 dark:text-neutral-400"
        >
          {pagination.prevHref ? (
            <a
              href={pagination.prevHref}
              rel="prev"
              class="animated-link focus-visible:outline-none"
            >
              ← Newer
            </a>
          ) : (
            <span />
          )}
          {pagination.nextHref ? (
            <a
              href={pagination.nextHref}
              rel="next"
              class="animated-link focus-visible:outline-none"
            >
              Older →
            </a>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
