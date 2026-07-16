import type { ContentRecord } from "diitey";
import { formatDate } from "./date.ts";

export function NoteList({
  notes,
}: {
  readonly notes: readonly ContentRecord[];
}) {
  if (notes.length === 0) {
    return <p class="text-neutral-500 dark:text-neutral-500">尚无笔记。</p>;
  }

  return (
    <ol class="m-0 list-none p-0">
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
        </li>
      ))}
    </ol>
  );
}
