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
        <li class="-mx-4 border-b border-neutral-200 px-4 py-5 last:border-b-0 dark:border-neutral-800">
          <time
            datetime={note.created}
            class="mb-2 block text-sm tabular-nums text-neutral-500 dark:text-neutral-500"
          >
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
