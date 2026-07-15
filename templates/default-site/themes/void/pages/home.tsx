import {
  type ContentRecord,
  type Pagination,
} from "diitey";
import { PostList } from "../shared/post-list.tsx";

const HOME_POSTS_LIMIT = 6;

interface HomeProps {
  readonly home: readonly ContentRecord[];
  readonly posts: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function Home({ home, posts, pagination }: HomeProps) {
  const homeRecord = home[0];
  const hasMore = pagination.totalItems > HOME_POSTS_LIMIT;

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
          {hasMore ? (
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
    </main>
  );
}
