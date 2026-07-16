import type { ContentRecord } from "diitey";
import { formatDate } from "./date.ts";

export function PostList({
  posts,
}: {
  readonly posts: readonly ContentRecord[];
}) {
  if (posts.length === 0) {
    return <p class="muted">尚无内容。</p>;
  }

  return (
    <ol class="list-reset">
      {posts.map((post) => (
        <li class="list-row">
          <a href={post.url} class="group post-list-link">
            <time datetime={post.created} class="post-list-date">
              {formatDate(post.created)}
            </time>
            <span data-vt-title={post.id} class="post-list-title">
              {String(post.attributes.title)}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
