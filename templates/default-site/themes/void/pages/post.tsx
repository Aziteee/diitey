import { Island, type ContentRecord } from "diitey";
import { formatDate } from "../shared/date.ts";
import { SiteFooter } from "../shared/footer.tsx";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import Comments from "../islands/comments.tsx";
import ImageGallery from "../islands/image-gallery.tsx";

interface PostProps {
  readonly post: ContentRecord;
}

export default function Post({ post }: PostProps) {
  const title = String(post.attributes.title);

  return (
    <main class="page-shell post-page">
      <Island name="back-link" component={BackLink} props={{}} />

      <article class="mt-14">
        <header class="mb-7 border-b border-neutral-200 pb-6 dark:border-neutral-800">
          <h1
            id="post-title"
            data-scroll-heading
            data-vt-post-title={post.id}
            style="view-transition-name: post-title;"
            class="m-0 scroll-mt-8 font-serif text-[2.375rem] font-medium leading-[1.1] tracking-[-0.01em] text-balance text-[color:var(--heading)]"
          >
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
          id="post-content"
          class="content post-content"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </article>

      <Island
        name="comments"
        component={Comments}
        props={{ contentId: post.id, mode: "panel" as const }}
      />

      <Island name="image-gallery" component={ImageGallery} props={{}} />

      <SiteFooter />

      <Island
        name="article-scroll-nav"
        component={ArticleScrollNav}
        props={{ title, mode: "sections" as const }}
      />
    </main>
  );
}
