import {
  Island,
  type ContentRecord,
  type Pagination,
  useThemeConfig,
} from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import type { CommentCounts } from "../shared/comments.ts";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import { SiteFooter } from "../shared/footer.tsx";
import { NoteList } from "../shared/note-list.tsx";

interface NotesProps {
  readonly notes: readonly ContentRecord[];
  readonly commentCounts: CommentCounts;
  readonly pagination: Pagination;
}

export default function Notes({
  notes,
  commentCounts,
  pagination,
}: NotesProps) {
  const config = useThemeConfig<VoidThemeConfig>();

  return (
    <main class="page-shell">
      <a
        href="/"
        aria-label={`返回 ${config.siteName} 首页`}
        class="group back-link"
      >
        <svg
          class="back-arrow"
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
        <h1 id="notes-heading" class="section-title mb-3">
          Notes
        </h1>
        <NoteList notes={notes} commentCounts={commentCounts.counts} />
      </section>

      {pagination.prevHref || pagination.nextHref ? (
        <nav aria-label="笔记分页" class="pagination">
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
