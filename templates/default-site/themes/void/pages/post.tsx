import { type ContentRecord, useThemeConfig } from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import { formatDate } from "../shared/date.ts";

interface PostProps {
  readonly post: ContentRecord;
}

export default function Post({ post }: PostProps) {
  const config = useThemeConfig<VoidThemeConfig>();
  const title = String(post.attributes.title);

  return (
    <main class="mx-auto w-full max-w-[45rem] px-6 py-12 font-serif sm:px-8 sm:py-16">
      <a
        href="/"
        aria-label={`返回 ${config.siteName} 首页`}
        class="back-link group inline-flex items-center gap-2 text-sm text-neutral-500 no-underline hover:text-neutral-950 focus-visible:text-neutral-950 focus-visible:outline-none dark:text-neutral-500 dark:hover:text-neutral-100 dark:focus-visible:text-neutral-100"
      >
        <svg
          class="back-arrow h-3.5 w-4 shrink-0"
          viewBox="0 0 20 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 2 2 7l5 5M2.25 7h15"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{config.siteName}</span>
      </a>

      <article class="mt-14">
        <header class="mb-7 border-b border-neutral-200 pb-6 dark:border-neutral-800">
          <h1 class="m-0 font-serif text-[2.375rem] font-medium leading-[1.1] tracking-[-0.01em] text-balance">
            {title}
          </h1>
          <time
            datetime={post.created}
            class="mt-4 block text-xs tracking-[0.04em] tabular-nums text-neutral-500"
          >
            {formatDate(post.created)}
          </time>
        </header>
        <div
          class="content"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </article>
    </main>
  );
}
