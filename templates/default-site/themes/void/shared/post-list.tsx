import type { ContentRecord } from "diitey";
import { formatDate } from "./date.ts";

export function PostList({
  posts,
}: {
  readonly posts: readonly ContentRecord[];
}) {
  if (posts.length === 0) {
    return <p class="text-neutral-500 dark:text-neutral-500">尚无内容。</p>;
  }

  return (
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
            <span
              data-vt-title={post.id}
              class="text-lg font-normal leading-7 tracking-[-0.015em] text-neutral-700 transition-colors duration-300 group-hover:text-neutral-950 group-focus-visible:text-neutral-950 dark:text-neutral-300 dark:group-hover:text-white dark:group-focus-visible:text-white"
            >
              {String(post.attributes.title)}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
