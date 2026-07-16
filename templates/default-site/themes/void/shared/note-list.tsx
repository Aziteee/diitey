import type { ContentRecord } from "diitey";
import { formatDate } from "./date.ts";

export function NoteList({
  notes,
}: {
  readonly notes: readonly ContentRecord[];
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
        </li>
      ))}
    </ol>
  );
}
