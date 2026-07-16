import { useEffect, useState } from "preact/hooks";
import type {
  CommentListPage,
  CommentNode,
  CommentTreeNode,
} from "../shared/comments.ts";
import { formatDate } from "../shared/date.ts";

interface CommentsProps {
  readonly contentId: string;
  readonly pageSize?: number;
  readonly initialCount?: number;
  readonly mode?: "panel" | "toggle";
}

interface ReplyTarget {
  readonly parentId: number;
  readonly replyToId: number | null;
  readonly label: string;
}

type CountSetter = (value: number | ((prev: number) => number)) => void;

const DEFAULT_PAGE_SIZE = 20;

export default function Comments({
  contentId,
  pageSize = DEFAULT_PAGE_SIZE,
  initialCount = 0,
  mode = "panel",
}: CommentsProps) {
  const [expanded, setExpanded] = useState(mode === "panel");
  const [activated, setActivated] = useState(mode === "panel");
  const [count, setCount] = useState(initialCount);

  const toggle = () => {
    setExpanded((value) => {
      const next = !value;
      if (next) setActivated(true);
      return next;
    });
  };

  return (
    <div class={mode === "toggle" ? "note-comments" : undefined}>
      {mode === "toggle" ? (
        <button
          type="button"
          class="comment-toggle"
          aria-expanded={expanded}
          aria-label={
            expanded ? `收起评论，共 ${count} 条` : `展开评论，共 ${count} 条`
          }
          onClick={toggle}
        >
          <CommentIcon />
          <span class="comment-toggle-count">{count}</span>
        </button>
      ) : null}
      {activated ? (
        <div hidden={mode === "toggle" && !expanded}>
          <CommentPanel
            contentId={contentId}
            pageSize={pageSize}
            showHeading={mode === "panel"}
            onCountChange={setCount}
          />
        </div>
      ) : null}
    </div>
  );
}

function CommentPanel({
  contentId,
  pageSize,
  showHeading,
  onCountChange,
}: {
  readonly contentId: string;
  readonly pageSize: number;
  readonly showHeading: boolean;
  readonly onCountChange: CountSetter;
}) {
  const [items, setItems] = useState<CommentTreeNode[]>([]);
  const [serverFetched, setServerFetched] = useState(0);
  const [serverRootTotal, setServerRootTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasMore = serverFetched < serverRootTotal;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const page = await fetchCommentPage(contentId, 0, pageSize);
        if (cancelled) return;
        setItems(sortRoots([...page.items]));
        setServerFetched(page.items.length);
        setServerRootTotal(page.rootTotal);
        onCountChange(page.total);
      } catch {
        if (!cancelled) setLoadError("Could not load comments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [contentId, pageSize]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await fetchCommentPage(contentId, serverFetched, pageSize);
      setItems((prev) => sortRoots(mergeRoots(prev, page.items)));
      setServerFetched((prev) => prev + page.items.length);
      setServerRootTotal(page.rootTotal);
      onCountChange(page.total);
    } catch {
      setLoadError("Could not load more comments");
    } finally {
      setLoadingMore(false);
    }
  };

  const replyToRoot = (root: CommentTreeNode) => {
    setReply({
      parentId: root.id,
      replyToId: null,
      label: root.authorName,
    });
    setError(null);
  };

  const replyToComment = (root: CommentTreeNode, target: CommentNode) => {
    setReply({
      parentId: root.id,
      replyToId: target.id,
      label: target.authorName,
    });
    setError(null);
  };

  const clearReply = () => {
    setReply(null);
    setError(null);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      contentId,
      authorName: authorName.trim(),
      body: body.trim(),
      parentId: reply?.parentId ?? null,
      replyToId: reply?.replyToId ?? null,
    };
    const trimmedEmail = email.trim();
    if (trimmedEmail) payload.email = trimmedEmail;

    try {
      const response = await fetch("/_action/comments.create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Could not post comment");
        setSubmitting(false);
        return;
      }
      const created = (await response.json()) as CommentNode;
      setItems((prev) => {
        const next = insertComment(prev, created);
        if (
          created.parentId === null &&
          next.length > prev.length &&
          serverFetched >= serverRootTotal
        ) {
          setServerFetched((value) => value + 1);
        }
        return sortRoots(next);
      });
      if (created.parentId === null) {
        setServerRootTotal((value) => value + 1);
      }
      onCountChange((prev) => prev + 1);
      setBody("");
      setReply(null);
      setSubmitting(false);
    } catch {
      setError("Could not post comment");
      setSubmitting(false);
    }
  };

  return (
    <section
      class={showHeading ? "comment-section" : "comment-panel"}
      aria-labelledby={showHeading ? "comments-heading" : undefined}
    >
      {showHeading ? (
        <header class="mb-7 flex items-baseline justify-between gap-4">
          <h2 id="comments-heading" class="comment-heading">
            Comments
          </h2>
        </header>
      ) : null}

      {loading ? (
        <p class="comment-status">Loading comments…</p>
      ) : loadError ? (
        <p class="comment-status" role="alert">
          {loadError}
        </p>
      ) : items.length > 0 ? (
        <ol class="list-reset">
          {items.map((root, index) => (
            <li key={root.id} class={index === 0 ? "" : "comment-root"}>
              <CommentItem
                comment={root}
                onReply={() => replyToRoot(root)}
              />
              {root.replies.length > 0 ? (
                <ol class="comment-replies">
                  {root.replies.map((child, replyIndex) => (
                    <li
                      key={child.id}
                      class={replyIndex === 0 ? "" : "mt-5"}
                    >
                      <CommentItem
                        comment={child}
                        onReply={() => replyToComment(root, child)}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {!loading && hasMore ? (
        <div class="comment-load-more">
          <button
            type="button"
            class="btn-ghost"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "加载更多"}
          </button>
        </div>
      ) : null}

      <form
        class="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800"
        onSubmit={submit}
      >
        {reply ? (
          <div class="comment-form-reply">
            <span>
              Replying to{" "}
              <strong class="font-medium text-neutral-950 dark:text-neutral-100">
                {reply.label}
              </strong>
            </span>
            <button type="button" class="btn-ghost" onClick={clearReply}>
              Cancel
            </button>
          </div>
        ) : null}

        <div class="grid gap-3.5 sm:grid-cols-2">
          <label class="field">
            <span class="field-label">Name</span>
            <input
              class="input"
              name="authorName"
              type="text"
              required
              maxLength={40}
              autoComplete="nickname"
              value={authorName}
              onInput={(event) => setAuthorName(event.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span class="field-label">Email</span>
            <input
              class="input"
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              placeholder="optional"
              value={email}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
        </div>

        <label class="field mt-3.5">
          <span class="field-label">Comment</span>
          <textarea
            class="textarea"
            name="body"
            required
            rows={4}
            maxLength={2000}
            value={body}
            onInput={(event) => setBody(event.currentTarget.value)}
          />
        </label>

        {error ? (
          <p
            class="mt-3.5 m-0 font-sans text-[0.8125rem] text-neutral-950 dark:text-neutral-100"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div class="mt-4 flex justify-end">
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? "Posting…" : "Post comment"}
          </button>
        </div>
      </form>
    </section>
  );
}

function CommentItem({
  comment,
  onReply,
}: {
  readonly comment: CommentNode;
  readonly onReply: () => void;
}) {
  return (
    <article id={`comment-${comment.id}`}>
      <header class="mb-1.5 flex flex-wrap items-baseline gap-3">
        <span class="comment-author">{comment.authorName}</span>
        <time class="comment-time" datetime={comment.createdAt}>
          {formatDate(comment.createdAt)}
        </time>
      </header>
      {comment.replyTo ? (
        <p class="comment-reply-meta">
          Replying to{" "}
          <a
            class="animated-link"
            href={`#comment-${comment.replyTo.id}`}
          >
            {comment.replyTo.authorName}
          </a>
        </p>
      ) : null}
      <p class="comment-body">{comment.body}</p>
      <button type="button" class="btn-ghost" onClick={onReply}>
        Reply
      </button>
    </article>
  );
}

function CommentIcon() {
  return (
    <svg
      class="comment-toggle-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4.75A1.75 1.75 0 0 1 5.75 3h8.5A1.75 1.75 0 0 1 16 4.75v6.5A1.75 1.75 0 0 1 14.25 13H9.1l-3.35 2.79A.5.5 0 0 1 5 15.4V13H5.75A1.75 1.75 0 0 1 4 11.25v-6.5Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

async function fetchCommentPage(
  contentId: string,
  offset: number,
  limit: number,
): Promise<CommentListPage> {
  const response = await fetch("/_action/comments.list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentId, offset, limit }),
  });
  if (!response.ok) {
    throw new Error("list failed");
  }
  return (await response.json()) as CommentListPage;
}

function mergeRoots(
  existing: readonly CommentTreeNode[],
  incoming: readonly CommentTreeNode[],
): CommentTreeNode[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...item,
      replies: mergeReplies(current.replies, item.replies),
    });
  }
  return [...byId.values()];
}

function mergeReplies(
  existing: readonly CommentNode[],
  incoming: readonly CommentNode[],
): CommentNode[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function sortRoots(items: readonly CommentTreeNode[]): CommentTreeNode[] {
  return [...items]
    .sort((a, b) => a.id - b.id)
    .map((root) => ({
      ...root,
      replies: [...root.replies].sort((a, b) => a.id - b.id),
    }));
}

function insertComment(
  items: readonly CommentTreeNode[],
  created: CommentNode,
): CommentTreeNode[] {
  if (created.parentId === null) {
    if (items.some((item) => item.id === created.id)) {
      return [...items];
    }
    return [
      ...items,
      {
        ...created,
        replies: [],
      },
    ];
  }

  return items.map((root) => {
    if (root.id !== created.parentId) return root;
    if (root.replies.some((reply) => reply.id === created.id)) {
      return root;
    }
    return {
      ...root,
      replies: [...root.replies, created],
    };
  });
}
