import { Island, type ContentRecord } from "diitey";
import Comments from "../islands/comments.tsx";
import { formatDate } from "./date.ts";

export function NoteList({
  notes,
  commentCounts,
}: {
  readonly notes: readonly ContentRecord[];
  readonly commentCounts?: Readonly<Record<string, number>>;
}) {
  if (notes.length === 0) {
    return <p class="muted">尚无笔记。</p>;
  }

  return (
    <ol class="list-reset">
      {notes.map((note) => (
        <li class="note-list-item">
          <time datetime={note.created} class="note-list-date">
            {formatDate(note.created)}
          </time>
          <div
            class="content note-content text-neutral-700 dark:text-neutral-300"
            dangerouslySetInnerHTML={{ __html: note.html }}
          />
          <Island
            name="comments"
            component={Comments}
            props={{
              contentId: note.id,
              initialCount: commentCounts?.[note.id] ?? 0,
              mode: "toggle" as const,
              pageSize: 10,
            }}
          />
        </li>
      ))}
    </ol>
  );
}
