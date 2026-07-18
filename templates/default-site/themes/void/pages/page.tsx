import { Island, type ContentRecord, useThemeConfig } from "diitey";
import type { VoidThemeConfig } from "../theme.ts";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import Comments from "../islands/comments.tsx";
import ImageGallery from "../islands/image-gallery.tsx";
import { SiteFooter } from "../shared/footer.tsx";

interface PageProps {
  readonly page: ContentRecord;
}

export default function Page({ page }: PageProps) {
  const config = useThemeConfig<VoidThemeConfig>();
  const showComments = page.attributes.comments === true;

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

      <article class="mt-14">
        <div
          class="content page-content"
          dangerouslySetInnerHTML={{ __html: page.html }}
        />
      </article>

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
