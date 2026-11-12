"use client";

import { Copy, Download, GitCompareArrows, Trash2 } from "lucide-react";
import Link from "next/link";
import { ApiError } from "@/lib/api/errors";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { QualityFlags } from "@/components/st/quality-flags";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import { useApiMutation, useEvidence, useUpdateEvidence } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { Evidence, EvidenceCategory } from "@/lib/api/types";
import { CATEGORY_LABELS } from "@/lib/domain";
import { formatDateTime, formatNumber, formatSmall, humanize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

import { AcquisitionFields, type AcquisitionValues, hasAcquisition, toAcquisitionValues } from "./acquisition-fields";
import { CATEGORIES, CATEGORY_HINTS } from "./evidence-tab";
import { Field } from "./panel";

/** "JpegQualityEstimate" / "jpeg_quality_estimate" -> "Jpeg quality estimate". */
export function labelFromKey(key: string): string {
  return humanize(key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()).replace(/\b(jpeg|exif|png|iso|gps|pce|ncc)\b/gi, (m) => m.toUpperCase());
}

/** Readable text for a free-form metadata value. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? formatNumber(value) : formatSmall(value, 4);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 0 ? "-" : value.map(displayValue).join(", ");
  return JSON.stringify(value);
}

const EXIF_ORIENTATIONS: Record<number, string> = {
  1: "1 (upright)",
  2: "2 (mirrored horizontally)",
  3: "3 (rotated 180°)",
  4: "4 (mirrored vertically)",
  5: "5 (mirrored, rotated 90° counter-clockwise)",
  6: "6 (rotated 90° clockwise)",
  7: "7 (mirrored, rotated 90° clockwise)",
  8: "8 (rotated 90° counter-clockwise)",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="eyebrow mb-1 border-b pb-2">{children}</h3>;
}

function AcquisitionEditor({ evidence }: { evidence: Evidence }) {
  const update = useUpdateEvidence();
  const saved = toAcquisitionValues(evidence.acquisition);
  const [draft, setDraft] = useState<AcquisitionValues | null>(null);

  if (draft === null) {
    return (
      <div>
        {hasAcquisition(saved) ? (
          <dl className="divide-y">
            {saved.source ? <Field label="Source">{saved.source}</Field> : null}
            {saved.acquired_at ? (
              <Field label="Acquired at">
                {Number.isNaN(new Date(saved.acquired_at).getTime()) ? saved.acquired_at : <span title={saved.acquired_at}>{formatDateTime(saved.acquired_at)}</span>}
              </Field>
            ) : null}
            {saved.acquired_by ? <Field label="Acquired by">{saved.acquired_by}</Field> : null}
            {saved.method ? <Field label="Method">{saved.method}</Field> : null}
            {saved.notes ? (
              <Field label="Notes">
                <span className="whitespace-pre-wrap">{saved.notes}</span>
              </Field>
            ) : null}
          </dl>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">No acquisition details recorded for this image.</p>
        )}
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setDraft(saved)}>
          {hasAcquisition(saved) ? "Edit acquisition details" : "Add acquisition details"}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          { id: evidence.id, acquisition: draft },
          {
            onSuccess: () => {
              setDraft(null);
              toastSuccess("Acquisition details saved");
            },
            onError: (err) => toastError(err, "Could not save acquisition details"),
          },
        );
      }}
    >
      <AcquisitionFields value={draft} onChange={setDraft} disabled={update.isPending} />
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={update.isPending} onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EvidenceBody({ evidence, onOpen, onDeleted, onExpired }: { evidence: Evidence; onOpen: (id: string) => void; onDeleted: () => void; onExpired: () => void }) {
  const update = useUpdateEvidence();
  const queryClient = useQueryClient();
  // Same request as `useDeleteEvidence`; the lists are refreshed after the sheet has closed so
  // the deleted item's own detail query is dropped instead of refetched (which would 404).
  const del = useApiMutation((evidenceId: string) => unwrap(api.DELETE("/api/v1/evidence/{evidence_id}", { params: { path: { evidence_id: evidenceId } } })));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const provenance = (evidence.provenance ?? {}) as Record<string, unknown>;
  const metadata = Object.entries((evidence.image_metadata ?? {}) as Record<string, unknown>);
  const metrics = Object.entries(evidence.quality?.metrics ?? {});
  const libraries = provenance.libraries && typeof provenance.libraries === "object" ? Object.entries(provenance.libraries as Record<string, unknown>) : [];
  const decodeNotes = Array.isArray(provenance.decode_notes) ? (provenance.decode_notes as unknown[]).map(String) : [];
  const orientation = typeof provenance.exif_orientation === "number" ? provenance.exif_orientation : null;
  const duplicates = evidence.duplicate_of ?? [];
  const compareHref = `/app/compare?evidence=${evidence.id}${evidence.investigation_id ? `&investigation=${evidence.investigation_id}` : ""}`;

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <SignedImage
        src={evidence.preview_url}
        alt={`Preview of ${evidence.filename}`}
        onExpired={onExpired}
        className="aspect-[4/3] w-full rounded-md bg-muted/40 ring-1 ring-foreground/10"
        imgClassName="object-contain"
      />

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={compareHref}>
            <GitCompareArrows aria-hidden="true" />
            Compare this image
          </Link>
        </Button>
        {evidence.download_url ? (
          <Button asChild variant="outline">
            <a href={evidence.download_url} download>
              <Download aria-hidden="true" />
              Download original
            </a>
          </Button>
        ) : null}
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        <p className="w-full text-xs text-muted-foreground">The download is the exact file that was received, byte for byte, so its SHA-256 matches the value below.</p>
      </div>

      {duplicates.length > 0 ? (
        <div className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Copy aria-hidden="true" className="size-4 text-warning" />
            Identical file content is stored {duplicates.length === 1 ? "in one other evidence item" : `in ${duplicates.length} other evidence items`}
          </p>
          <p className="mt-1 text-muted-foreground">The SHA-256 values are equal, so the bytes are the same. Open the other {duplicates.length === 1 ? "copy" : "copies"}:</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {duplicates.map((id, i) => (
              <li key={id}>
                <Button variant="outline" size="xs" onClick={() => onOpen(id)}>
                  Copy {i + 1}
                  <span className="font-mono text-muted-foreground">{id.slice(0, 8)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section>
        <SectionTitle>File</SectionTitle>
        <dl className="divide-y">
          <Field label="Category">
            <Select
              value={evidence.category}
              disabled={update.isPending}
              onValueChange={(v) =>
                update.mutate(
                  { id: evidence.id, category: v as EvidenceCategory },
                  { onSuccess: () => toastSuccess("Category updated"), onError: (err) => toastError(err, "Could not change the category") },
                )
              }
            >
              <SelectTrigger aria-label="Category" size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="mt-1 block text-xs text-muted-foreground">{CATEGORY_HINTS[evidence.category as EvidenceCategory] ?? ""}</span>
          </Field>
          <Field label="SHA-256">
            <Hash value={evidence.sha256} full />
          </Field>
          <Field label="Dimensions" mono>
            {formatNumber(evidence.width)} × {formatNumber(evidence.height)} px
          </Field>
          <Field label="Size">
            <Bytes value={evidence.size_bytes} /> <span className="text-muted-foreground">({formatNumber(evidence.size_bytes)} bytes)</span>
          </Field>
          <Field label="Format" mono>
            {evidence.mime_type}
          </Field>
          <Field label="Evidence id" mono>
            {evidence.id}
          </Field>
        </dl>
      </section>

      <section>
        <SectionTitle>Image quality</SectionTitle>
        <div className="pt-3">
          <QualityFlags quality={evidence.quality} />
        </div>
        {metrics.length > 0 ? (
          <dl className="mt-2 divide-y">
            {metrics.map(([key, value]) => (
              <Field key={key} label={labelFromKey(key)} mono>
                {displayValue(value)}
              </Field>
            ))}
          </dl>
        ) : null}
      </section>

      <section>
        <SectionTitle>Acquisition</SectionTitle>
        <AcquisitionEditor key={evidence.id} evidence={evidence} />
      </section>

      <section>
        <SectionTitle>Provenance</SectionTitle>
        <dl className="divide-y">
          <Field label="Received">
            <FormattedDate value={typeof provenance.received_at === "string" ? provenance.received_at : evidence.created_at} />
          </Field>
          <Field label="Original filename">{typeof provenance.original_filename === "string" && provenance.original_filename ? provenance.original_filename : evidence.filename}</Field>
          <Field label="EXIF orientation">
            {orientation === null ? "Not recorded" : (EXIF_ORIENTATIONS[orientation] ?? String(orientation))}
            <span className="mt-0.5 block text-xs text-muted-foreground">Recorded, not applied: pixels are analysed in their stored orientation.</span>
          </Field>
          <Field label="Decoder" mono>
            {displayValue(provenance.decoder)}
          </Field>
          {libraries.length > 0 ? (
            <Field label="Library versions" mono>
              <ul>
                {libraries.map(([name, version]) => (
                  <li key={name}>
                    {name} {String(version)}
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}
          <Field label="Decode notes">
            {decodeNotes.length > 0 ? (
              <ul className="list-disc pl-4">
                {decodeNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Field>
          {provenance.synthetic === true ? <Field label="Origin">Synthetic image generated by SensorTrace for the demo</Field> : null}
        </dl>
      </section>

      <section>
        <SectionTitle>Image metadata</SectionTitle>
        {metadata.length > 0 ? (
          <>
            <dl className="divide-y">
              {metadata.map(([key, value]) => (
                <Field key={key} label={labelFromKey(key)} mono>
                  {displayValue(value)}
                </Field>
              ))}
            </dl>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Read from the file as received. Metadata can be edited or stripped and is never used to decide an outcome.
            </p>
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">The file carries no readable metadata.</p>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this evidence image?"
        description={
          <>
            <span className="font-medium text-foreground">{evidence.filename}</span> and its stored file will be permanently deleted, together with every
            comparison of this image and the reports generated from those comparisons. This cannot be undone.
          </>
        }
        confirmLabel="Delete evidence"
        onConfirm={async () => {
          await del.mutateAsync(evidence.id);
          toastSuccess("Evidence deleted");
          onDeleted();
          // Drop the cached detail once the sheet has unmounted its query.
          window.setTimeout(() => queryClient.removeQueries({ queryKey: qk.evidence.detail(evidence.id) }), 1000);
          for (const queryKey of [qk.evidence.lists(), qk.investigations.all, qk.analyses.all, qk.reports.all, qk.dashboard, qk.usage]) {
            void queryClient.invalidateQueries({ queryKey });
          }
        }}
      />
    </div>
  );
}

export function EvidenceSheet({ evidenceId, onOpenChange }: { evidenceId: string | null; onOpenChange: (id: string | null) => void }) {
  const query = useEvidence(evidenceId);
  const evidence = query.data;
  return (
    <Sheet open={Boolean(evidenceId)} onOpenChange={(open) => (open ? null : onOpenChange(null))}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-2 break-all">
            {evidence ? evidence.filename : query.isError ? "Evidence" : <Skeleton className="h-5 w-48" />}
            <DemoBadge when={evidence?.is_demo} />
          </SheetTitle>
          <SheetDescription>
            {evidence ? (
              <>
                {CATEGORY_LABELS[evidence.category] ?? humanize(evidence.category)} image, received <FormattedDate value={evidence.created_at} />
              </>
            ) : (
              "Evidence image details"
            )}
          </SheetDescription>
        </SheetHeader>
        {query.isError ? (
          query.error instanceof ApiError && query.error.isNotFound ? (
            <EmptyState variant="plain" title="Evidence not found" description="This image no longer exists. It may have been deleted." />
          ) : (
            <div className="px-4">
              <ErrorState variant="plain" error={query.error} title="Could not load this image" onRetry={() => void query.refetch()} retrying={query.isFetching} />
            </div>
          )
        ) : evidence ? (
          <EvidenceBody evidence={evidence} onOpen={onOpenChange} onDeleted={() => onOpenChange(null)} onExpired={() => void query.refetch()} />
        ) : (
          <div className="flex flex-col gap-4 px-4" role="status" aria-label="Loading evidence">
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
