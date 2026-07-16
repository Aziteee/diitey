import {
  type ContentRecord,
  type Pagination,
  useThemeConfig,
} from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import { NoteList } from "../shared/note-list.tsx";
import { PostList } from "../shared/post-list.tsx";

interface HomeProps {
  readonly home: readonly ContentRecord[];
  readonly posts: readonly ContentRecord[];
  readonly notes: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function Home({ home, posts, notes, pagination }: HomeProps) {
  const config = useThemeConfig<VoidThemeConfig>();
  const homeRecord = home[0];
  const hasMorePosts = pagination.totalItems > config.homePosts;
  const recentNotes = notes.slice(0, config.homeNotes);
  const hasMoreNotes = notes.length > config.homeNotes;

  return (
    <main class="mx-auto w-full max-w-[45rem] px-6 py-16 font-serif sm:px-8 sm:py-24">
      <div
        class="content home-content mb-20 sm:mb-28"
        dangerouslySetInnerHTML={{ __html: homeRecord?.html ?? "" }}
      />

      <section aria-labelledby="writing-heading">
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2
            id="writing-heading"
            class="m-0 text-xl font-medium tracking-[-0.02em] text-neutral-900 dark:text-neutral-100"
          >
            Writing
          </h2>
          {hasMorePosts ? (
            <a
              href="/archives"
              class="animated-link shrink-0 text-sm text-neutral-500 focus-visible:outline-none dark:text-neutral-500"
            >
              查看更多
            </a>
          ) : null}
        </div>
        <PostList posts={posts} />
      </section>

      <section class="mt-20 sm:mt-28" aria-labelledby="notes-heading">
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2
            id="notes-heading"
            class="m-0 text-xl font-medium tracking-[-0.02em] text-neutral-900 dark:text-neutral-100"
          >
            Notes
          </h2>
          {hasMoreNotes ? (
            <a
              href="/notes"
              class="animated-link shrink-0 text-sm text-neutral-500 focus-visible:outline-none dark:text-neutral-500"
            >
              查看更多
            </a>
          ) : null}
        </div>
        <NoteList notes={recentNotes} />
      </section>
    </main>
  );
}
