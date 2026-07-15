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

const textButtonClass =
  "m-0 border-0 bg-transparent p-0 font-sans text-xs tracking-[0.04em] text-neutral-500 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-neutral-950 focus-visible:text-neutral-950 focus-visible:outline-none dark:text-neutral-500 dark:hover:text-neutral-100 dark:focus-visible:text-neutral-100";

const fieldLabelClass =
  "font-sans text-xs tracking-[0.04em] text-neutral-500 dark:text-neutral-500";

const inputClass =
  "w-full rounded-none border border-neutral-200 bg-transparent px-3 py-2.5 font-sans text-sm leading-normal text-neutral-800 transition-[border-color,background-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] placeholder:text-neutral-500 hover:border-neutral-400 focus-visible:border-neutral-950 focus-visible:bg-neutral-50 focus-visible:outline-none dark:border-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-500 dark:hover:border-neutral-600 dark:focus-visible:border-neutral-100 dark:focus-visible:bg-neutral-900";

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

  const total = countComments(comments);

  return (
    <section
      class="mt-[4.5rem] border-t border-neutral-200 pt-9 dark:border-neutral-800"
      aria-labelledby="comments-heading"
    >
      <header class="mb-7 flex items-baseline justify-between gap-4">
        <h2
          id="comments-heading"
          class="m-0 font-sans text-lg font-medium tracking-[-0.02em] text-neutral-950 dark:text-neutral-100"
        >
          Comments
        </h2>
      </header>

      {comments.length > 0 ? (
        <ol class="m-0 list-none p-0">
          {comments.map((root, index) => (
            <li
              key={root.id}
              class={
                index === 0
                  ? ""
                  : "mt-7 border-t border-neutral-200 pt-7 dark:border-neutral-800"
              }
            >
              <CommentItem
                comment={root}
                onReply={() => replyToRoot(root)}
              />
              {root.replies.length > 0 ? (
                <ol class="ml-3 mt-5 list-none border-l border-neutral-200 p-0 pl-4 dark:border-neutral-800">
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
          <div class="mb-4 flex items-baseline justify-between gap-4 font-sans text-[0.8125rem] text-neutral-500 dark:text-neutral-500">
            <span>
              Replying to{" "}
              <strong class="font-medium text-neutral-950 dark:text-neutral-100">
                {reply.label}
              </strong>
            </span>
            <button
              type="button"
              class={textButtonClass}
              onClick={clearReply}
            >
              Cancel
            </button>
          </div>
        ) : null}

        <div class="grid gap-3.5 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5">
            <span class={fieldLabelClass}>Name</span>
            <input
              class={inputClass}
              name="authorName"
              type="text"
              required
              maxLength={40}
              autoComplete="nickname"
              value={authorName}
              onInput={(event) => setAuthorName(event.currentTarget.value)}
            />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class={fieldLabelClass}>Email</span>
            <input
              class={inputClass}
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

        <label class="mt-3.5 flex flex-col gap-1.5">
          <span class={fieldLabelClass}>Comment</span>
          <textarea
            class="min-h-28 w-full resize-y rounded-none border border-neutral-200 bg-transparent px-3 py-2.5 font-serif text-[0.96875rem] leading-[1.7] text-neutral-800 transition-[border-color,background-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] placeholder:text-neutral-500 hover:border-neutral-400 focus-visible:border-neutral-950 focus-visible:bg-neutral-50 focus-visible:outline-none dark:border-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-500 dark:hover:border-neutral-600 dark:focus-visible:border-neutral-100 dark:focus-visible:bg-neutral-900"
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
          <button
            type="submit"
            class="cursor-pointer rounded-none border border-neutral-200 bg-transparent px-4 py-2.5 font-sans text-[0.8125rem] tracking-[0.02em] text-neutral-950 transition-[color,border-color,background-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-neutral-950 hover:bg-neutral-950/5 focus-visible:border-neutral-950 focus-visible:bg-neutral-950/5 focus-visible:outline-none disabled:cursor-wait disabled:opacity-55 dark:border-neutral-800 dark:text-neutral-100 dark:hover:border-neutral-100 dark:hover:bg-white/5 dark:focus-visible:border-neutral-100 dark:focus-visible:bg-white/5"
            disabled={submitting}
          >
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
        <span class="font-sans text-sm font-medium tracking-[-0.01em] text-neutral-950 dark:text-neutral-100">
          {comment.authorName}
        </span>
        <time
          class="font-sans text-xs tracking-[0.04em] tabular-nums text-neutral-500 dark:text-neutral-500"
          datetime={comment.createdAt}
        >
          {formatDate(comment.createdAt)}
        </time>
      </header>
      {comment.replyTo ? (
        <p class="mb-2 mt-0 font-sans text-[0.8125rem] text-neutral-500 dark:text-neutral-500">
          Replying to{" "}
          <a
            class="animated-link focus-visible:outline-none"
            href={`#comment-${comment.replyTo.id}`}
          >
            {comment.replyTo.authorName}
          </a>
        </p>
      ) : null}
      <p class="mb-2.5 mt-0 whitespace-pre-wrap break-words font-serif text-[0.96875rem] leading-[1.75] tracking-[0.01em] text-neutral-800 dark:text-neutral-200">
        {comment.body}
      </p>
      <button type="button" class={textButtonClass} onClick={onReply}>
        Reply
      </button>
    </article>
  );
}

function countComments(comments: readonly CommentTreeNode[]): number {
  return comments.reduce(
    (total, root) => total + 1 + root.replies.length,
    0,
  );
}
