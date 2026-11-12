"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleCheck, Fingerprint as FingerprintIcon, Images, ListChecks, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { QualityFlags } from "@/components/st/quality-flags";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { UploadDropzone } from "@/components/st/upload-dropzone";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteReference, useFingerprint, useMeta, useReferences } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { ReferenceImage, Sensor } from "@/lib/api/types";
import { formatBytes, formatNumber, pluralize } from "@/lib/format";
import { toastSuccess } from "@/lib/toast";

import { diagnosticsOf, metric } from "./fingerprint-types";
import { Notice, Panel, useSensorBuild } from "./shared";

/** The API serves at most 500 references per request; a sensor holds at most `max_reference_images`. */
export const ALL_REFERENCES = { limit: 500 } as const;
const PAGE = 24;

/** Groups references by pixel dimensions, largest group first. */
export function dimensionGroups(refs: ReferenceImage[]): { key: string; width: number; height: number; count: number }[] {
  const groups = new Map<string, { key: string; width: number; height: number; count: number }>();
  for (const r of refs) {
    const key = `${r.width}x${r.height}`;
    const g = groups.get(key) ?? { key, width: r.width, height: r.height, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].toSorted((a, b) => b.count - a.count);
}

function Guidance() {
  const meta = useMeta();
  return (
    <Panel title="How to take reference images" icon={ListChecks} flush>
      {meta.isPending ? (
        <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading guidance">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : meta.isError ? (
        <div className="p-4">
          <ErrorState variant="inline" title="Could not load the guidance" error={meta.error} onRetry={() => void meta.refetch()} retrying={meta.isFetching} />
        </div>
      ) : (
        <Accordion type="multiple" className="px-4">
          {meta.data.reference_guidance.map((item, i) => (
            <AccordionItem key={item.title} value={item.title}>
              <AccordionTrigger className="text-left text-sm">
                <span className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[0.6875rem] text-muted-foreground">
                    {i + 1}
                  </span>
                  {item.title}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pl-[1.875rem] text-sm leading-relaxed text-muted-foreground">{item.body}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </Panel>
  );
}

function CollectionProgress({ count }: { count: number }) {
  const meta = useMeta();
  const recommended = meta.data?.limits.recommended_reference_images;
  const min = meta.data?.limits.min_reference_images;
  const max = meta.data?.limits.max_reference_images;
  if (!recommended || min === undefined) return <Skeleton className="h-16 w-full rounded-lg" />;
  const percent = Math.min(100, (count / recommended) * 100);
  const reached = count >= recommended;
  return (
    <div className="rounded-lg bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium">
          <span className="font-mono text-lg">{formatNumber(count)}</span>
          <span className="text-muted-foreground"> of {recommended} recommended reference images</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {reached ? (
            <>
              <CircleCheck aria-hidden="true" className="size-3.5 text-success" /> Recommended amount reached
            </>
          ) : count >= min ? (
            `Enough to build a fingerprint. ${recommended - count} more to reach the recommended amount.`
          ) : (
            `At least ${min} are required. ${min - count} more needed.`
          )}
        </p>
      </div>
      <Progress value={percent} aria-label={`${count} of ${recommended} recommended reference images`} className="mt-3 h-1.5" />
      {max ? <p className="mt-2 text-xs text-muted-foreground">Up to {formatNumber(max)} reference images per sensor. JPEG and PNG originals only.</p> : null}
    </div>
  );
}

function ReferenceCard({ reference, onExpired, onDelete }: { reference: ReferenceImage; onExpired: () => void; onDelete: () => void }) {
  const intensity = metric(reference.quality, "mean_intensity");
  const saturated = metric(reference.quality, "saturated_fraction");
  const texture = metric(reference.quality, "texture_index");
  return (
    <li className="group flex min-w-0 flex-col overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      <SignedImage
        src={reference.preview_url}
        alt={`Preview of reference image ${reference.filename}`}
        onExpired={onExpired}
        className="aspect-[4/3] w-full rounded-none"
        imgClassName="object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={reference.filename}>
              {reference.filename}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {reference.width} × {reference.height} · {formatBytes(reference.size_bytes)}
            </p>
          </div>
          <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete reference image ${reference.filename}`} onClick={onDelete}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
        <dl className="grid grid-cols-3 gap-2 border-t pt-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Brightness</dt>
            <dd className="font-mono">{intensity === null ? "-" : formatNumber(intensity, 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Clipped</dt>
            <dd className="font-mono">{saturated === null ? "-" : `${formatNumber(saturated * 100, 1)}%`}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Texture</dt>
            <dd className="font-mono">{texture === null ? "-" : formatNumber(texture, 1)}</dd>
          </div>
        </dl>
        <QualityFlags quality={reference.quality} variant="summary" />
      </div>
    </li>
  );
}

export function ReferencesTab({ sensor, onTab }: { sensor: Sensor; onTab: (tab: string) => void }) {
  const queryClient = useQueryClient();
  const meta = useMeta();
  const references = useReferences(sensor.id, ALL_REFERENCES);
  const remove = useDeleteReference();
  const { building } = useSensorBuild(sensor.id);
  const [page, setPage] = useState(0);
  const [toDelete, setToDelete] = useState<ReferenceImage | null>(null);

  const items = references.data?.items ?? [];
  const total = references.data?.total ?? sensor.reference_count ?? 0;
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = items.slice(current * PAGE, current * PAGE + PAGE);
  const groups = dimensionGroups(items);
  const min = meta.data?.limits.min_reference_images ?? 2;
  const max = meta.data?.limits.max_reference_images;
  const full = max !== undefined && total >= max;
  const active = sensor.active_fingerprint;
  // How many references existed when the active fingerprint was built (accepted or not).
  const activeDetail = useFingerprint(sensor.active_fingerprint_id);
  const submitted = diagnosticsOf(activeDetail.data).screening?.submitted;

  return (
    <div className="flex flex-col gap-6">
      <CollectionProgress count={total} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-3">
          <UploadDropzone
            url={`/api/v1/sensors/${sensor.id}/references`}
            title="Drop reference images here or choose files"
            description="Original JPEG or PNG files from this sensor only: same lens, resolution and capture mode."
            disabled={full}
            maxFiles={max !== undefined ? Math.max(0, max - total) : undefined}
            onBatch={() => void queryClient.invalidateQueries({ queryKey: qk.sensors.all })}
            onComplete={() => {
              void queryClient.invalidateQueries({ queryKey: qk.sensors.all });
              void queryClient.invalidateQueries({ queryKey: qk.devices.all });
              void queryClient.invalidateQueries({ queryKey: qk.usage });
              void queryClient.invalidateQueries({ queryKey: qk.dashboard });
            }}
          />
          {full ? (
            <Notice tone="warning" title="Reference limit reached">
              This sensor holds the maximum of {formatNumber(max)} reference images. Delete some before uploading more.
            </Notice>
          ) : null}
        </div>
        <Guidance />
      </div>

      {groups.length > 1 ? (
        <Notice tone="warning" title="These reference images have different dimensions" role="note">
          <p>
            A fingerprint is tied to one pixel grid. Images of different sizes are never merged: they are split into
            separate groups and only one group is used, so the others are wasted. Different sizes usually mean a
            different lens, resolution or capture mode, which belongs in its own sensor entry.
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-foreground">
            {groups.map((g) => (
              <li key={g.key}>
                {g.width} × {g.height}: {pluralize(g.count, "image")}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {active && total > 0 && !building && submitted !== undefined && total !== submitted ? (
        <Notice tone="info" title="The reference set has changed since the active fingerprint was built">
          Fingerprint v{active.version} was built when this sensor had {pluralize(submitted, "reference image")}; there
          are now {formatNumber(total)}. Create a new version to bring the fingerprint up to date.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => onTab("fingerprint")}>
              <FingerprintIcon aria-hidden="true" /> Go to fingerprint
            </Button>
          </div>
        </Notice>
      ) : !active && !building && total >= min ? (
        <Notice tone="success" title="Ready to build a fingerprint">
          {pluralize(total, "reference image")} uploaded.
          <div className="mt-2">
            <Button size="sm" onClick={() => onTab("fingerprint")}>
              <FingerprintIcon aria-hidden="true" /> Go to fingerprint
            </Button>
          </div>
        </Notice>
      ) : null}

      <section aria-labelledby="reference-grid-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="reference-grid-title" className="flex items-center gap-2 text-sm font-medium">
            <Images aria-hidden="true" className="size-4 text-muted-foreground" />
            Reference images
            {references.data ? <span className="font-mono text-xs text-muted-foreground">{formatNumber(total)}</span> : null}
          </h2>
        </div>

        {references.isPending ? (
          <ul role="status" aria-label="Loading reference images" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>
                <Skeleton className="aspect-[4/5] w-full rounded-lg" />
              </li>
            ))}
          </ul>
        ) : references.isError ? (
          <ErrorState title="Could not load the reference images" error={references.error} onRetry={() => void references.refetch()} retrying={references.isFetching} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="No reference images yet"
            description="Upload photos of a bright, even, featureless scene taken with this sensor. The checklist explains what works best."
          />
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((r) => (
                <ReferenceCard key={r.id} reference={r} onExpired={() => void references.refetch()} onDelete={() => setToDelete(r)} />
              ))}
            </ul>
            {pages > 1 ? (
              <nav aria-label="Reference image pages" className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {current * PAGE + 1}-{Math.min(items.length, current * PAGE + PAGE)} of {formatNumber(items.length)} reference images
                </p>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                    <ChevronLeft aria-hidden="true" /> Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                    Next <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this reference image?"
        description={
          <>
            <span className="font-medium break-all text-foreground">{toDelete?.filename}</span> will be removed from
            this sensor. Fingerprints that were already built from it are not changed; create a new version to
            exclude it. This cannot be undone.
          </>
        }
        confirmLabel="Delete image"
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync(toDelete.id);
          await queryClient.invalidateQueries({ queryKey: qk.devices.all });
          toastSuccess("Reference image deleted");
        }}
      />
    </div>
  );
}
