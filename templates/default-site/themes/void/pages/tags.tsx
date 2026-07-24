import { Island, type ContentRecord } from "diitey";
import ArticleScrollNav from "../islands/article-scroll-nav.tsx";
import BackLink from "../islands/back-link.tsx";
import { SiteFooter } from "../shared/footer.tsx";
import { PostList } from "../shared/post-list.tsx";
import { groupPostsByTag, tagSectionId } from "../shared/tags.ts";

interface TagsProps {
  readonly posts: readonly ContentRecord[];
}

export default function Tags({ posts }: TagsProps) {
  const groups = groupPostsByTag(posts);

  return (
    <main class="page-shell">
      <Island name="back-link" component={BackLink} props={{}} />

      <section class="mt-14" aria-labelledby="tags-heading">
        <h1 id="tags-heading" class="section-title mb-10">
          Tags
        </h1>

        {groups.length === 0 ? (
          <p class="muted">尚无标签。</p>
        ) : (
          <div class="flex flex-col gap-10">
            {groups.map(({ tag, posts: tagPosts }) => (
              <section
                key={tag}
                id={tagSectionId(tag)}
                class="scroll-mt-8"
                aria-labelledby={`${tagSectionId(tag)}-heading`}
              >
                <h2
                  id={`${tagSectionId(tag)}-heading`}
                  class="mb-1 font-serif text-base font-medium tracking-[-0.01em] text-neutral-600 dark:text-neutral-400"
                >
                  {tag}
                  <span class="ml-2 font-sans text-sm font-normal tabular-nums tracking-[0.04em] text-neutral-400 dark:text-neutral-600">
                    {tagPosts.length}
                  </span>
                </h2>
                <PostList posts={tagPosts} />
              </section>
            ))}
          </div>
        )}
      </section>

      <SiteFooter />

      <Island
        name="article-scroll-nav"
        component={ArticleScrollNav}
        props={{ mode: "simple" as const }}
      />
    </main>
  );
}
