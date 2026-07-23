import {
  Island,
  type ContentRecord,
  type Pagination,
  useThemeConfig,
} from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import type { CommentCounts } from "../shared/comments.ts";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import ImageGallery from "../islands/image-gallery.tsx";
import { SiteFooter } from "../shared/footer.tsx";
import { NoteList } from "../shared/note-list.tsx";
import { hasMusicPlayer, MusicPlayerEnhancer } from "../shared/music-player.tsx";
import { PostList } from "../shared/post-list.tsx";

interface HomeProps {
  readonly home: readonly ContentRecord[];
  readonly posts: readonly ContentRecord[];
  readonly notes: readonly ContentRecord[];
  readonly links: readonly ContentRecord[];
  readonly commentCounts: CommentCounts;
  readonly pagination: Pagination;
}

export default function Home({
  home,
  posts,
  notes,
  links,
  commentCounts,
  pagination,
}: HomeProps) {
  const config = useThemeConfig<VoidThemeConfig>();
  const homeRecord = home[0];
  const hasMorePosts = pagination.totalItems > config.homePosts;
  const recentNotes = notes.slice(0, config.homeNotes);
  const hasMoreNotes = notes.length > config.homeNotes;
  const linksHtml = links[0]?.html?.trim() ?? "";
  const hasLinks = linksHtml.length > 0;
  const hasMusic = [homeRecord, ...recentNotes, links[0]].some((record) =>
    hasMusicPlayer(record?.html),
  );

  return (
    <main class="page-shell page-shell--home">
      <div
        class="content home-content mb-20 sm:mb-28"
        dangerouslySetInnerHTML={{ __html: homeRecord?.html ?? "" }}
      />

      <section aria-labelledby="writing-heading">
        <div class="section-header">
          <h2 id="writing-heading" class="section-title m-0">
            Writing
          </h2>
          {hasMorePosts ? (
            <a href="/archives" class="animated-link section-more">
              查看更多
            </a>
          ) : null}
        </div>
        <PostList posts={posts} />
      </section>

      <section class="mt-20 sm:mt-28" aria-labelledby="notes-heading">
        <div class="section-header">
          <h2 id="notes-heading" class="section-title m-0">
            Notes
          </h2>
          {hasMoreNotes ? (
            <a href="/notes" class="animated-link section-more">
              查看更多
            </a>
          ) : null}
        </div>
        <NoteList notes={recentNotes} commentCounts={commentCounts.counts} />
      </section>

      {hasLinks ? (
        <section class="mt-20 sm:mt-28" aria-labelledby="links-heading">
          <div class="section-header">
            <h2 id="links-heading" class="section-title m-0">
              Links
            </h2>
          </div>
          <div
            class="content links-content mt-4"
            dangerouslySetInnerHTML={{ __html: linksHtml }}
          />
        </section>
      ) : null}

      {hasMusic ? <MusicPlayerEnhancer /> : null}

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
