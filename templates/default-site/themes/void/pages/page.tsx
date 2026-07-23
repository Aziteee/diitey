import { Island, type ContentRecord } from "diitey";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import Comments from "../islands/comments.tsx";
import ImageGallery from "../islands/image-gallery.tsx";
import { hasMusicPlayer, MusicPlayerEnhancer } from "../shared/music-player.tsx";
import { SiteFooter } from "../shared/footer.tsx";

interface PageProps {
  readonly page: ContentRecord;
}

export default function Page({ page }: PageProps) {
  const showComments = page.attributes.comments === true;

  return (
    <main class="page-shell">
      <Island name="back-link" component={BackLink} props={{}} />

      <article class="mt-14">
        <div
          class="content page-content"
          dangerouslySetInnerHTML={{ __html: page.html }}
        />
      </article>

      {hasMusicPlayer(page.html) ? <MusicPlayerEnhancer /> : null}

      {showComments ? (
        <Island
          name="comments"
          component={Comments}
          props={{ contentId: page.id, mode: "panel" as const }}
        />
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
