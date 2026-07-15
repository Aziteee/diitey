import { useState } from "preact/hooks";

interface AdminComment {
  readonly id: number;
  readonly contentId: string;
  readonly parentId: number | null;
  readonly authorName: string;
  readonly email: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly contentUrl: string | null;
  readonly contentTitle: string | null;
}

interface AdminData {
  readonly comments: readonly AdminComment[];
  readonly total: number;
}

function readCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)diitey_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function deleteComment(id: number): Promise<void> {
  const csrf = readCsrfToken();
  if (!csrf) throw new Error("Missing CSRF token; reload the admin page");
  const response = await fetch("/_admin/action/comments/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Delete failed (${response.status})`);
  }
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CommentsAdmin(props: { data: AdminData | null }) {
  const initial = props.data ?? { comments: [], total: 0 };
  const [comments, setComments] = useState<AdminComment[]>([...initial.comments]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function onDelete(comment: AdminComment) {
    const label =
      comment.parentId === null
        ? `root #${comment.id} and its replies`
        : `comment #${comment.id}`;
    if (!window.confirm(`Delete ${label}?`)) return;
    setError(null);
    setPendingId(comment.id);
    try {
      await deleteComment(comment.id);
      setComments((current) =>
        current.filter(
          (row) =>
            row.id !== comment.id &&
            !(comment.parentId === null && row.parentId === comment.id),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <header class="mb-8">
        <p class="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Plugin
        </p>
        <h1 class="m-0 text-2xl font-semibold tracking-tight text-white">
          Comments
        </h1>
        <p class="mt-2 text-sm text-zinc-400">
          {comments.length} comment{comments.length === 1 ? "" : "s"}
          {initial.total !== comments.length
            ? ` (${initial.total} at load)`
            : ""}
        </p>
      </header>

      {error ? (
        <p
          class="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {comments.length === 0 ? (
        <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center">
          <p class="m-0 text-sm text-zinc-400">No comments yet.</p>
        </div>
      ) : (
        <div class="flex flex-col gap-3">
          {comments.map((comment) => (
            <article
              class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700 sm:p-5"
              key={comment.id}
            >
              <header class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="font-mono text-xs font-medium text-zinc-500">
                  #{comment.id}
                </span>
                <strong class="text-sm font-medium text-zinc-100">
                  {comment.authorName}
                </strong>
                {comment.email ? (
                  <span class="text-sm text-zinc-500">{comment.email}</span>
                ) : null}
                <time
                  dateTime={comment.createdAt}
                  class="text-xs text-zinc-500"
                >
                  {formatWhen(comment.createdAt)}
                </time>
                <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {comment.parentId === null
                    ? "root"
                    : `reply to #${comment.parentId}`}
                </span>
              </header>

              <p class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                {comment.body}
              </p>

              <footer class="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-800/80 pt-3">
                <span class="text-xs text-zinc-500">
                  content:{" "}
                  {comment.contentUrl ? (
                    <a
                      href={comment.contentUrl}
                      target="_blank"
                      rel="noreferrer"
                      class="text-sky-400 hover:text-sky-300"
                    >
                      {comment.contentTitle ?? comment.contentId}
                    </a>
                  ) : (
                    <span class="font-mono text-zinc-400">
                      {comment.contentId}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={pendingId === comment.id}
                  onClick={() => void onDelete(comment)}
                  class="ml-auto rounded-md border border-red-900/50 bg-red-950/40 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:border-red-800 hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingId === comment.id ? "Deleting…" : "Delete"}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
