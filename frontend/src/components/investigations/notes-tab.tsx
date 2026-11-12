"use client";

import { NotebookPen, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { FormattedDate } from "@/components/st/formatted";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAddNote, useDeleteNote, useInvestigationNotes } from "@/lib/api/hooks";
import type { Note } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import { toastSuccess } from "@/lib/toast";

const MAX_NOTE = 20_000;

export function NotesTab({ investigationId }: { investigationId: string }) {
  const query = useInvestigationNotes(investigationId);
  const add = useAddNote(investigationId);
  const del = useDeleteNote(investigationId);
  const [body, setBody] = useState("");
  const [toDelete, setToDelete] = useState<Note | null>(null);
  const notes = query.data?.toSorted((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <form method="post"
        className="flex flex-col gap-2 self-start rounded-lg bg-card p-4 ring-1 ring-foreground/10"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body.trim();
          if (!text) return;
          add.mutate(text, {
            onSuccess: () => {
              setBody("");
              toastSuccess("Note added");
            },
          });
        }}
      >
        <Label htmlFor="note-body">Add a note</Label>
        <Textarea
          id="note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={MAX_NOTE}
          placeholder="Observations, decisions, who was consulted, what was ruled out and why."
          aria-describedby="note-help"
        />
        <p id="note-help" className="text-xs text-muted-foreground">
          Notes are timestamped when saved and are included in the investigation report and export. They cannot be edited afterwards, only deleted.
        </p>
        {add.isError ? (
          <p role="alert" className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm">
            {add.error.message}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{body.length > MAX_NOTE * 0.9 ? `${formatNumber(body.length)} / ${formatNumber(MAX_NOTE)}` : null}</span>
          <Button type="submit" disabled={add.isPending || body.trim() === ""}>
            {add.isPending ? "Saving" : "Add note"}
          </Button>
        </div>
      </form>

      <section aria-labelledby="notes-heading" aria-live="polite">
        <h2 id="notes-heading" className="sr-only">
          Notes, newest first
        </h2>
        {query.isError ? (
          <ErrorState error={query.error} title="Could not load notes" onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : !notes ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading notes">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState icon={NotebookPen} title="No notes yet" description="Record what you observed and decided as you work, so the reasoning travels with the evidence." />
        ) : (
          <ol className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg bg-card p-4 ring-1 ring-foreground/10">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    <FormattedDate value={note.created_at} />
                  </p>
                  <Button variant="ghost" size="icon-xs" aria-label="Delete note" onClick={() => setToDelete(note)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this note?"
        description="The note is permanently removed from the investigation. The deletion itself is recorded in the history."
        confirmLabel="Delete note"
        onConfirm={async () => {
          if (!toDelete) return;
          await del.mutateAsync(toDelete.id);
          toastSuccess("Note deleted");
        }}
      >
        {toDelete ? <p className="line-clamp-4 rounded-md bg-muted/50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">{toDelete.body}</p> : null}
      </ConfirmDialog>
    </div>
  );
}
