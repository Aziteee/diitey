import { Island, type ContentRecord } from "diitey";
import { formatDate } from "../shared/date.ts";
import { SiteFooter } from "../shared/footer.tsx";
import { postTags, tagHref } from "../shared/tags.ts";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import Comments from "../islands/comments.tsx";
import ImageGallery from "../islands/image-gallery.tsx";
import { hasMusicPlayer, MusicPlayerEnhancer } from "../shared/music-player.tsx";

interface PostProps {
  readonly post: ContentRecord;
}

export default function Post({ post }: PostProps) {
  const title = String(post.attributes.title);
  const tags = postTags(post);

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
          <p class="mt-4 m-0 flex flex-wrap items-baseline gap-x-0 text-xs tracking-[0.04em] text-neutral-500">
            <time datetime={post.created} class="tabular-nums">
              {formatDate(post.created)}
            </time>
            {tags.map((tag) => (
              <>
                <span class="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <a
                  href={tagHref(tag)}
                  class="text-inherit no-underline transition-colors duration-300 hover:text-neutral-800 focus-visible:text-neutral-800 focus-visible:outline-none dark:hover:text-neutral-200 dark:focus-visible:text-neutral-200"
                >
                  {tag}
                </a>
              </>
            ))}
          </p>
        </header>
        <div
          id="post-content"
          class="content post-content"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      </article>

      {hasMusicPlayer(post.html) ? <MusicPlayerEnhancer /> : null}

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
