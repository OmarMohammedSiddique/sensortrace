"use client";

import { Check, CircleCheck, CircleX, Download, Eye, Fingerprint as FingerprintIcon, FlaskConical, History, ListChecks, Microscope, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DataTable, type Column } from "@/components/st/data-table";
import { FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  isJobActive,
  useActivateFingerprint,
  useDeleteFingerprint,
  useFingerprint,
  useJob,
  useMeta,
  useReferences,
  useStartFingerprint,
} from "@/lib/api/hooks";
import type { Fingerprint, FingerprintDetail, Sensor } from "@/lib/api/types";
import { formatBytes, formatNumber, formatPce, formatSmall, humanize, pluralize, truncateMiddle } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { diagnosticsOf, outcomesOf, type ScreeningOutcome } from "./fingerprint-types";
import { ReferenceBarChart } from "./reference-chart";
import { ALL_REFERENCES } from "./sensor-references";
import { FingerprintStatus, isFingerprintBuilding, Notice, Panel, useFingerprintVersions, useSensorBuild } from "./shared";

/* ---------------------------------------------------------------- stages */

const STAGES = [
  { id: "screening", title: "Screening", body: "Every reference image is opened and checked: format, size, exposure, clipping and texture." },
  { id: "consistency", title: "Consistency", body: "Dimensions and camera metadata are compared so that only one consistent group of images is used." },
  { id: "estimating", title: "Estimating", body: "The noise left after denoising each image is combined into the sensor pattern, and each image is checked against the rest." },
  { id: "finalising", title: "Finalising", body: "Diagnostics, the fingerprint file and its visualisations are stored." },
] as const;

/** The four enrolment stages with the current one highlighted, driven by the job's `stage`. */
function StageSteps({ jobId }: { jobId: string }) {
  const { data: job } = useJob(jobId);
  if (!job) return null;
  const index = STAGES.findIndex((s) => s.id === job.stage);
  const done = job.status === "succeeded";
  const active = isJobActive(job);
  if (!active && !done) return null;
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Enrolment stages">
      {STAGES.map((stage, i) => {
        const state = done || (index > i && active) ? "done" : index === i && active ? "current" : "todo";
        return (
          <li
            key={stage.id}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "rounded-md border p-3 transition-colors",
              state === "current" && "border-brand-border bg-brand-subtle",
              state === "todo" && "opacity-70",
            )}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.6875rem]",
                  state === "done" ? "bg-success-subtle text-success" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
              {stage.title}
              <span className="sr-only">{state === "done" ? " (complete)" : state === "current" ? " (in progress)" : " (not started)"}</span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{stage.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- create */

function CreatePanel({ sensor, onTab, onFinished }: { sensor: Sensor; onTab: (tab: string) => void; onFinished: (fingerprintId: string | null) => void }) {
  const meta = useMeta();
  const start = useStartFingerprint(sensor.id);
  const { building, job } = useSensorBuild(sensor.id);
  // Remember the last job seen so its outcome stays on screen after it leaves the active list.
  const [jobId, setJobId] = useState<string | null>(null);
  if (job && job.id !== jobId) setJobId(job.id);

  const refs = sensor.reference_count ?? 0;
  const min = meta.data?.limits.min_reference_images ?? 2;
  const recommended = meta.data?.limits.recommended_reference_images;
  const hasAny = Boolean(sensor.active_fingerprint);
  const tooFew = refs < min;
  const busy = Boolean(building) || start.isPending;

  return (
    <Panel title={hasAny ? "Create a new version" : "Create the fingerprint"} icon={FlaskConical}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {tooFew ? (
              <>
                A fingerprint needs at least {min} reference images. This sensor has {formatNumber(refs)}.
              </>
            ) : (
              <>
                Estimates the sensor pattern from the {pluralize(refs, "reference image")} currently uploaded.
                {recommended && refs < recommended ? ` ${recommended} or more are recommended for a strong fingerprint.` : ""}
                {hasAny ? " The new version becomes the active one when it completes; earlier versions are kept." : ""}
              </>
            )}
          </p>
          {tooFew ? (
            <Button className="shrink-0" onClick={() => onTab("references")}>
              <Upload aria-hidden="true" /> Add reference images
            </Button>
          ) : (
            <Button
              className="shrink-0"
              disabled={busy}
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: ({ job: started }) => setJobId(started.id),
                  onError: (e) => toastError(e, "Could not start the fingerprint job"),
                })
              }
            >
              <Plus aria-hidden="true" />
              {start.isPending ? "Starting" : building ? "Estimation in progress" : hasAny ? "Create new version" : "Create fingerprint"}
            </Button>
          )}
        </div>
        {jobId ? (
          <>
            <JobProgress
              key={jobId}
              jobId={jobId}
              title="Fingerprint estimation"
              className="bg-background"
              onDone={(finished) => {
                if (finished.status === "succeeded") {
                  toastSuccess("Fingerprint ready", "It is now the active version for this sensor.");
                  onFinished(finished.target_id ?? null);
                }
              }}
            />
            <StageSteps jobId={jobId} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- metrics */

function Metric({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1">
        <span className="font-mono text-base font-medium">{value}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{children}</span>
      </dd>
    </div>
  );
}

function OutcomeCell({ outcome }: { outcome: ScreeningOutcome }) {
  return outcome.accepted ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-success">
      <CircleCheck aria-hidden="true" className="size-3.5" /> Accepted
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-danger">
      <CircleX aria-hidden="true" className="size-3.5" /> Rejected
    </span>
  );
}

/* ---------------------------------------------------------------- detail */

function VersionDetail({ sensor, fingerprintId }: { sensor: Sensor; fingerprintId: string }) {
  const detail = useFingerprint(fingerprintId);
  const references = useReferences(sensor.id, ALL_REFERENCES);

  if (detail.isPending) {
    return (
      <div role="status" aria-label="Loading fingerprint version" className="flex flex-col gap-4">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (detail.isError) {
    return <ErrorState title="Could not load this fingerprint version" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  }

  const fp: FingerprintDetail = detail.data;
  const heading = (
    <h2 className="flex flex-wrap items-center gap-2 text-base font-medium">
      Version {fp.version}
      {fp.is_active ? <Badge variant="secondary">Active</Badge> : null}
      <FingerprintStatus status={fp.status} />
    </h2>
  );

  if (fp.status !== "ready") {
    return (
      <section className="flex flex-col gap-3" aria-label={`Fingerprint version ${fp.version}`}>
        {heading}
        {isFingerprintBuilding(fp) ? (
          <p className="text-sm text-muted-foreground">This version is still being estimated. Its diagnostics appear here when the job completes.</p>
        ) : (
          <Notice tone={fp.status === "failed" ? "danger" : "warning"} title={fp.status === "failed" ? "This version failed" : `This version was ${humanize(fp.status).toLowerCase()}`} role="note">
            <span className="break-words text-foreground">{fp.error || "No further detail was recorded."}</span>
          </Notice>
        )}
      </section>
    );
  }

  const diag = diagnosticsOf(fp);
  const outcomes = outcomesOf(fp);
  const names = new Map((references.data?.items ?? []).map((r) => [r.id, r.filename]));
  const nameOf = (o: ScreeningOutcome, i: number) =>
    (o.ref_id && names.get(o.ref_id)) || (o.sha256 ? truncateMiddle(o.sha256, 6, 6) : `Reference ${i + 1}`);
  const accepted = outcomes.filter((o) => o.accepted);
  const rejected = outcomes.length - accepted.length;
  const chartData = outcomes
    .map((o, i) => ({ n: i + 1, name: nameOf(o, i), value: typeof o.loo_pce === "number" ? o.loo_pce : null, accepted: o.accepted }))
    .filter((p) => p.accepted && p.value !== null);
  const looValues = chartData.map((p) => p.value as number);
  const looMin = looValues.length ? Math.min(...looValues) : null;
  const looMax = looValues.length ? Math.max(...looValues) : null;
  const sat = diag.mean_saturated_fraction;

  return (
    <section className="flex flex-col gap-6" aria-label={`Fingerprint version ${fp.version}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        {fp.download_url ? (
          <Button asChild variant="outline" size="sm">
            <a href={fp.download_url} download>
              <Download aria-hidden="true" /> Download fingerprint file
              <span className="text-muted-foreground">({formatBytes(fp.size_bytes)})</span>
            </a>
          </Button>
        ) : null}
      </div>

      {(diag.warnings ?? []).length > 0 ? (
        <div className="flex flex-col gap-2" aria-label="Fingerprint warnings">
          {(diag.warnings ?? []).map((w) => (
            <Notice key={w} tone="warning">
              <span className="text-foreground">{w}</span>
            </Notice>
          ))}
        </div>
      ) : null}

      <Panel title="Diagnostics" icon={Microscope} description="These describe the fingerprint itself. They are measurements, not error rates, and say nothing about any particular questioned image.">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label="Split-half PCE" value={formatPce(diag.split_half?.pce)}>
            Two fingerprints are built from separate halves of the references
            {diag.split_half?.n_a && diag.split_half?.n_b ? ` (${diag.split_half.n_a} and ${diag.split_half.n_b} images)` : ""} and
            compared. A large positive value means both halves carry the same pattern; a value near zero means the
            references do not share a stable one.
          </Metric>
          <Metric label="Split-half correlation (NCC)" value={formatSmall(diag.split_half?.ncc)}>
            Correlation between the same two halves, from -1 to 1. Closer to 1 means the halves agree more closely;
            it rises as more and flatter reference images are used.
          </Metric>
          <Metric label="Median leave-one-out PCE" value={formatPce(diag.screening?.loo_pce_median)}>
            Each reference is compared with a fingerprint built from all the others. A high median means the typical
            reference clearly carries the pattern.
          </Metric>
          <Metric label="Spectrum peak-to-median" value={formatSmall(diag.spectrum?.peak_to_median)}>
            Strongest single frequency in the fingerprint relative to the typical level. Smaller is better: a flat
            spectrum is what sensor noise looks like, while tall peaks point to periodic artefacts shared by a camera
            model.
          </Metric>
          <Metric label="JPEG 8-pixel grid ratio" value={formatSmall(diag.spectrum?.block8_ratio)}>
            Energy at the 8-pixel JPEG block frequencies relative to the typical level. Values around or below 1 mean
            no excess blocking in the fingerprint; larger values mean compression structure has leaked in.
          </Metric>
          <Metric label="Mean intensity" value={diag.mean_intensity === undefined ? "-" : formatNumber(diag.mean_intensity, 1)}>
            Average brightness of the references on a 0 to 255 scale. Bright but unclipped images carry the most
            pattern; dark sets give a weak fingerprint.
          </Metric>
          <Metric label="Mean saturated fraction" value={sat === undefined ? "-" : `${formatNumber(sat * 100, 2)}%`}>
            Average share of each reference that is clipped to pure white. Clipped pixels carry no pattern, so this
            should be as close to zero as possible.
          </Metric>
          <Metric label="References used" value={`${formatNumber(diag.screening?.accepted ?? fp.n_images)} of ${formatNumber(diag.screening?.submitted ?? outcomes.length)}`}>
            Images that passed screening and went into this version. {rejected > 0 ? `${pluralize(rejected, "image")} were rejected; the table below gives the reasons.` : "None were rejected."}
          </Metric>
          <Metric label="Dimensions" value={fp.width && fp.height ? `${fp.width} × ${fp.height}` : "-"}>
            Pixel grid of the fingerprint. A questioned image is aligned to this grid before comparison.
          </Metric>
        </dl>
      </Panel>

      <Panel title="Visualisations" icon={Eye}>
        <div className="grid gap-4 md:grid-cols-2">
          <figure className="min-w-0">
            <SignedImage
              src={fp.visual_url}
              alt={`Contrast-enhanced rendering of the noise pattern of fingerprint version ${fp.version}`}
              onExpired={() => void detail.refetch()}
              className="aspect-[4/3] w-full"
              imgClassName="object-contain"
            />
            <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Noise pattern.</span> {fp.visualisation_notice}
            </figcaption>
          </figure>
          <figure className="min-w-0">
            <SignedImage
              src={fp.spectrum_url}
              alt={`Frequency spectrum of fingerprint version ${fp.version}`}
              onExpired={() => void detail.refetch()}
              className="aspect-[4/3] w-full"
              imgClassName="object-contain"
            />
            <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Frequency spectrum.</span> {fp.visualisation_notice}
            </figcaption>
          </figure>
        </div>
      </Panel>

      {chartData.length > 0 ? (
        <Panel title="Leave-one-out PCE per accepted reference" icon={FingerprintIcon}>
          <ReferenceBarChart
            data={chartData}
            label="Leave-one-out PCE"
            format={formatPce}
            summary={`Bar chart of leave-one-out PCE for ${chartData.length} accepted reference images, ranging from ${formatPce(looMin)} to ${formatPce(looMax)}. The values are listed in the screening table that follows.`}
          />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Each bar is one reference compared with a fingerprint built from the others. Bars of similar height mean
            the set is consistent. A bar far below the rest marks an image that carries less of the pattern (for
            example a darker, more textured or differently processed one). Every value is in the table below.
          </p>
        </Panel>
      ) : null}

      <Panel title="Screening outcomes" icon={ListChecks} flush>
        {outcomes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No per-image screening record was stored for this version.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <Table>
              <caption className="sr-only">Screening outcome and leave-one-out PCE for every reference image submitted to this version</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="eyebrow h-9 w-10 bg-muted/40">#</TableHead>
                  <TableHead scope="col" className="eyebrow h-9 bg-muted/40">Reference</TableHead>
                  <TableHead scope="col" className="eyebrow h-9 bg-muted/40">Outcome</TableHead>
                  <TableHead scope="col" className="eyebrow h-9 bg-muted/40 text-right">Leave-one-out PCE</TableHead>
                  <TableHead scope="col" className="eyebrow h-9 bg-muted/40">Reasons and warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o, i) => (
                  <TableRow key={o.ref_id ?? o.sha256 ?? i}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <span className="block max-w-[16rem] truncate text-sm" title={nameOf(o, i)}>
                        {nameOf(o, i)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {o.width && o.height ? `${o.width} × ${o.height}` : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <OutcomeCell outcome={o} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatPce(o.loo_pce)}</TableCell>
                    <TableCell className="min-w-[16rem] text-xs leading-relaxed whitespace-normal">
                      {(o.reasons ?? []).length === 0 && (o.warnings ?? []).length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {(o.reasons ?? []).map((r) => (
                            <li key={`r-${r}`} className="text-foreground">
                              {r}
                            </li>
                          ))}
                          {(o.warnings ?? []).map((w) => (
                            <li key={`w-${w}`} className="text-muted-foreground">
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title="Reproducibility" icon={History} description="What is needed to re-create this exact fingerprint from the same reference files.">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <dt className="eyebrow mb-1">Fingerprint digest</dt>
            <dd>
              <Hash value={fp.digest} label="fingerprint digest" full className="break-all" />
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Algorithm version</dt>
            <dd className="mt-1 font-mono text-sm">{fp.algorithm_version || "-"}</dd>
          </div>
          <div>
            <dt className="eyebrow">Denoising strength (sigma0)</dt>
            <dd className="mt-1 font-mono text-sm">{diag.sigma0 === undefined ? "-" : formatSmall(diag.sigma0)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Reference files recorded</dt>
            <dd className="mt-1 text-sm">
              <span className="font-mono">{formatNumber(diag.reference_sha256?.length ?? 0)}</span>{" "}
              <span className="text-muted-foreground">SHA-256 hashes, one per image used</span>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Created</dt>
            <dd className="mt-1 text-sm">
              <FormattedDate value={fp.created_at} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="eyebrow">Library versions</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(diag.libraries ?? {}).length === 0 ? (
                <span className="text-sm text-muted-foreground">Not recorded</span>
              ) : (
                Object.entries(diag.libraries ?? {}).map(([name, version]) => (
                  <span key={name} className="rounded-md border px-1.5 py-0.5 font-mono text-xs">
                    {name} <span className="text-muted-foreground">{version}</span>
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </Panel>
    </section>
  );
}

/* ------------------------------------------------------------------- tab */

export function FingerprintTab({ sensor, onTab }: { sensor: Sensor; onTab: (tab: string) => void }) {
  const versions = useFingerprintVersions(sensor.id);
  const activate = useActivateFingerprint();
  const remove = useDeleteFingerprint();
  const [selected, setSelected] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Fingerprint | null>(null);

  const list = versions.data ?? [];
  const selectedId =
    (selected && list.some((f) => f.id === selected) ? selected : null) ??
    list.find((f) => f.is_active)?.id ??
    list.find((f) => f.status === "ready")?.id ??
    list[0]?.id ??
    null;

  const columns: Column<Fingerprint>[] = [
    {
      id: "version",
      header: "Version",
      skeleton: "w-16",
      cell: (f) => (
        <span className="flex items-center gap-2">
          <span className="font-mono font-medium">v{f.version}</span>
          {f.is_active ? (
            <Badge variant="secondary">
              <Check aria-hidden="true" /> Active
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (f) => <FingerprintStatus status={f.status} /> },
    {
      id: "images",
      header: "Images",
      align: "right",
      className: "hidden sm:table-cell",
      cell: (f) => <span className="font-mono text-xs">{f.status === "ready" ? formatNumber(f.n_images) : "-"}</span>,
    },
    {
      id: "digest",
      header: "Digest",
      className: "hidden lg:table-cell",
      cell: (f) => (f.digest ? <Hash value={f.digest} label="fingerprint digest" chars={6} /> : <span className="text-muted-foreground">-</span>),
    },
    {
      id: "created",
      header: "Created",
      className: "hidden md:table-cell",
      cell: (f) => <FormattedDate value={f.created_at} className="text-muted-foreground" />,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (f) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant={f.id === selectedId ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={f.id === selectedId}
            onClick={() => setSelected(f.id)}
          >
            <Eye aria-hidden="true" />
            View<span className="sr-only"> version {f.version}</span>
          </Button>
          {f.status === "ready" && !f.is_active ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={activate.isPending}
              onClick={() =>
                activate.mutate(f.id, {
                  onSuccess: () => toastSuccess(`Version ${f.version} is now active`, "New comparisons use this fingerprint."),
                  onError: (e) => toastError(e, "Could not activate this version"),
                })
              }
            >
              Activate<span className="sr-only"> version {f.version}</span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Delete version ${f.version}`}
            onClick={() => setToDelete(f)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <CreatePanel sensor={sensor} onTab={onTab} onFinished={(id) => setSelected(id)} />

      <section aria-labelledby="versions-title" className="flex flex-col gap-3">
        <h2 id="versions-title" className="flex items-center gap-2 text-sm font-medium">
          <History aria-hidden="true" className="size-4 text-muted-foreground" /> Versions
        </h2>
        <DataTable
          caption="Fingerprint versions for this sensor"
          columns={columns}
          rows={versions.data}
          rowKey={(f) => f.id}
          loading={versions.isPending}
          skeletonRows={2}
          error={versions.isError ? <ErrorState title="Could not load fingerprint versions" error={versions.error} onRetry={() => void versions.refetch()} retrying={versions.isFetching} /> : null}
          empty={
            <EmptyState
              icon={FingerprintIcon}
              title="No fingerprint versions yet"
              description="Each time you create a fingerprint a new version is stored, so earlier results stay reproducible."
            />
          }
        />
      </section>

      {selectedId ? <VersionDetail key={selectedId} sensor={sensor} fingerprintId={selectedId} /> : null}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title={`Delete fingerprint version ${toDelete?.version ?? ""}?`}
        description={
          toDelete?.is_active ? (
            <>
              This is the <span className="font-medium text-foreground">active</span> version. After deleting it the
              sensor has no active fingerprint and cannot be compared against until you activate another version or
              create a new one. Completed analyses keep their recorded results. This cannot be undone.
            </>
          ) : (
            <>The fingerprint file, its diagnostics and its visualisations are removed. Completed analyses keep their recorded results. This cannot be undone.</>
          )
        }
        confirmLabel="Delete version"
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync(toDelete.id);
          toastSuccess(`Version ${toDelete.version} deleted`);
        }}
      />
    </div>
  );
}
