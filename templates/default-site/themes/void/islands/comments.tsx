import { useState } from "preact/hooks";
import type {
  CommentNode,
  CommentTreeNode,
} from "../shared/comments.ts";
import { formatDate } from "../shared/date.ts";

interface CommentsProps {
  readonly contentId: string;
  readonly comments: readonly CommentTreeNode[];
}

interface ReplyTarget {
  readonly parentId: number;
  readonly replyToId: number | null;
  readonly label: string;
}

export default function Comments({ contentId, comments }: CommentsProps) {
  const [authorName, setAuthorName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      location.reload();
    } catch {
      setError("Could not post comment");
      setSubmitting(false);
    }
  };

  return (
    <section class="comment-section" aria-labelledby="comments-heading">
      <header class="mb-7 flex items-baseline justify-between gap-4">
        <h2 id="comments-heading" class="comment-heading">
          Comments
        </h2>
      </header>

      {comments.length > 0 ? (
        <ol class="list-reset">
          {comments.map((root, index) => (
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

      <form
        class="mt-5 border-neutral-200 pt-5 dark:border-neutral-800"
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
