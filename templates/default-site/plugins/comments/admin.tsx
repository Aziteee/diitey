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
      <h1>Comments</h1>
      <p>
        {comments.length} comment{comments.length === 1 ? "" : "s"}
        {initial.total !== comments.length ? ` (${initial.total} at load)` : ""}
      </p>
      {error ? <p class="diitey-admin-error">{error}</p> : null}
      {comments.length === 0 ? (
        <p class="diitey-admin-card">No comments yet.</p>
      ) : (
        <div>
          {comments.map((comment) => (
            <article class="diitey-admin-card" key={comment.id}>
              <header
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  alignItems: "baseline",
                  marginBottom: "0.5rem",
                }}
              >
                <strong>#{comment.id}</strong>
                <span>{comment.authorName}</span>
                {comment.email ? (
                  <span style={{ opacity: 0.75 }}>{comment.email}</span>
                ) : null}
                <time dateTime={comment.createdAt} style={{ opacity: 0.75 }}>
                  {comment.createdAt}
                </time>
                <span style={{ opacity: 0.75 }}>
                  {comment.parentId === null
                    ? "root"
                    : `reply to #${comment.parentId}`}
                </span>
              </header>
              <p style={{ margin: "0.5rem 0", whiteSpace: "pre-wrap" }}>
                {comment.body}
              </p>
              <footer
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  alignItems: "center",
                }}
              >
                <span style={{ opacity: 0.85 }}>
                  content:{" "}
                  {comment.contentUrl ? (
                    <a href={comment.contentUrl} target="_blank" rel="noreferrer">
                      {comment.contentTitle ?? comment.contentId}
                    </a>
                  ) : (
                    comment.contentId
                  )}
                </span>
                <button
                  type="button"
                  disabled={pendingId === comment.id}
                  onClick={() => void onDelete(comment)}
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
