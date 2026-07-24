import { Island, type ContentRecord, type Pagination } from "diitey";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import { SiteFooter } from "../shared/footer.tsx";
import { groupPostsByYear, PostList } from "../shared/post-list.tsx";

interface ArchivesProps {
  readonly posts: readonly ContentRecord[];
  readonly pagination: Pagination;
}

export default function Archives({ posts, pagination }: ArchivesProps) {
  const years = groupPostsByYear(posts);

  return (
    <main class="page-shell">
      <Island name="back-link" component={BackLink} props={{}} />

      <section class="mt-14" aria-labelledby="archives-heading">
        <h1 id="archives-heading" class="section-title mb-10">
          Writing
        </h1>
        {years.length === 0 ? (
          <PostList posts={posts} />
        ) : (
          <div class="flex flex-col gap-10">
            {years.map(({ year, posts: yearPosts }) => (
              <section
                key={year}
                aria-labelledby={`archives-year-${year}`}
              >
                <h2
                  id={`archives-year-${year}`}
                  class="mb-1 font-serif text-base font-medium tabular-nums tracking-[-0.01em] text-neutral-600 dark:text-neutral-400"
                >
                  {year}
                </h2>
                <PostList posts={yearPosts} dateStyle="month-day" />
              </section>
            ))}
          </div>
        )}
      </section>

      {pagination.prevHref || pagination.nextHref ? (
        <nav aria-label="内容分页" class="pagination">
          {pagination.prevHref ? (
            <a href={pagination.prevHref} rel="prev" class="animated-link">
              ← Newer
            </a>
          ) : (
            <span />
          )}
          {pagination.nextHref ? (
            <a href={pagination.nextHref} rel="next" class="animated-link">
              Older →
            </a>
          ) : null}
        </nav>
      ) : null}

      <SiteFooter />

      <Island
        name="article-scroll-nav"
        component={ArticleScrollNav}
        props={{ mode: "simple" as const }}
      />
    </main>
  );
}
