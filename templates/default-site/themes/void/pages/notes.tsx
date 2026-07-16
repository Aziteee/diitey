import {
  type ContentRecord,
  type Pagination,
  useThemeConfig,
} from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import { NoteList } from "../shared/note-list.tsx";

interface NotesProps {
  readonly notes: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function Notes({ notes, pagination }: NotesProps) {
  const config = useThemeConfig<VoidThemeConfig>();

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

      <section class="mt-14" aria-labelledby="notes-heading">
        <h1
          id="notes-heading"
          class="mb-3 text-xl font-medium tracking-[-0.02em] text-neutral-900 dark:text-neutral-100"
        >
          Notes
        </h1>
        <NoteList notes={notes} />
      </section>

      {pagination.prevHref || pagination.nextHref ? (
        <nav
          aria-label="笔记分页"
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
