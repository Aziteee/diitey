import { Island, type ContentRecord, type Pagination } from "diitey";
import type { CommentCounts } from "../shared/comments.ts";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import ImageGallery from "../islands/image-gallery.tsx";
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
  return (
    <main class="page-shell">
      <Island name="back-link" component={BackLink} props={{}} />

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

      <Island name="image-gallery" component={ImageGallery} props={{}} />

      <Island
        name="article-scroll-nav"
        component={ArticleScrollNav}
        props={{ mode: "simple" as const }}
      />
    </main>
  );
}
