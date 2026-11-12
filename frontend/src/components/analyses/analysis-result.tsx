"use client";

import { BookOpen, FileText, FolderInput, GitCompareArrows, Images, ListOrdered, Microscope, ScanSearch, ShieldQuestion, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ReportRow } from "@/components/investigations/reports-tab";
import { Field, Panel } from "@/components/investigations/panel";
import { displayValue, labelFromKey } from "@/components/investigations/evidence-sheet";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-context";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { PageHeader } from "@/components/st/page-header";
import { PolicyNotice } from "@/components/st/policy-notice";
import { QualityFlags } from "@/components/st/quality-flags";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { VERDICT_STYLES, VerdictBadge } from "@/components/st/verdict-badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/errors";
import { useAnalysis, useCreateAnalysisReport, useDeleteAnalysis, useDeleteReport, useInvestigation, useInvestigations, useReports, useUpdateAnalysis } from "@/lib/api/hooks";
import { VERDICTS, type AnalysisDetail, type Candidate, type Report } from "@/lib/api/types";
import { needsSameModelControl, VERDICT_LABELS } from "@/lib/domain";
import { formatNumber, formatPce, formatSmall, humanize, pluralize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { CandidateChart } from "./candidate-chart";
import { CandidateDetail } from "./candidate-detail";
import { hasReferenceProfiles, ImageVsReference } from "./image-vs-reference";

/* ------------------------------------------------------------------ actions */

function SaveToInvestigation({ analysis }: { analysis: AnalysisDetail }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const investigations = useInvestigations({ limit: 200 });
  const update = useUpdateAnalysis();
  const options = investigations.data?.items.filter((i) => i.id !== analysis.investigation_id);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <FolderInput aria-hidden="true" />
          {analysis.investigation_id ? "Move to investigation" : "Save to investigation"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form method="post"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!choice) return;
            update.mutate(
              { id: analysis.id, investigation_id: choice },
              {
                onSuccess: () => {
                  toastSuccess("Comparison saved to the investigation");
                  setOpen(false);
                  setChoice("");
                },
              },
            );
          }}
        >
          <div>
            <h2 className="text-sm font-medium">{analysis.investigation_id ? "Move to another investigation" : "Save to an investigation"}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Files this comparison in the investigation. If the image is not in any investigation yet, it is filed there too.
            </p>
          </div>
          {investigations.isError ? (
            <ErrorState variant="inline" error={investigations.error} title="Could not load investigations" onRetry={() => void investigations.refetch()} />
          ) : !options ? (
            <Skeleton className="h-8 w-full" />
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There is no other investigation.{" "}
              <Link href="/app/investigations?new=1" className="font-medium text-foreground underline underline-offset-4">
                Create one
              </Link>
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="save-investigation">Investigation</Label>
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger id="save-investigation" className="w-full">
                  <SelectValue placeholder="Choose an investigation" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {update.isError ? (
            <p role="alert" className="text-xs text-danger">
              {update.error.message}
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={!choice || update.isPending} className="justify-self-start">
            {update.isPending ? "Saving" : "Save"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function DeleteAnalysis({ analysis }: { analysis: AnalysisDetail }) {
  const router = useRouter();
  const del = useDeleteAnalysis();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this comparison?"
        description="The result, its measurements and the reports generated from it are permanently deleted. The evidence image and the sensor fingerprints are not affected. This cannot be undone."
        confirmLabel="Delete comparison"
        onConfirm={async () => {
          await del.mutateAsync(analysis.id);
          toastSuccess("Comparison deleted");
          router.replace(analysis.investigation_id ? `/app/investigations/${analysis.investigation_id}?tab=comparisons` : "/app/compare");
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ header */

function ResultHeader({ analysis, onExpired, actions }: { analysis: AnalysisDetail; onExpired: () => void; actions: React.ReactNode }) {
  const name = analysis.evidence_filename || "Untitled image";
  const investigation = useInvestigation(analysis.investigation_id ?? undefined);
  const evidence = analysis.evidence;
  return (
    <>
      <PageHeader eyebrow="Comparison result" title={<span className="break-all">{name}</span>} badges={<DemoBadge when={analysis.is_demo} />} actions={actions} className="mb-4 sm:mb-5" />
      <div className="mb-6 flex items-start gap-4 text-muted-foreground sm:mb-8">
        <SignedImage src={analysis.evidence_preview_url} alt={`Preview of ${name}`} onExpired={onExpired} className="size-20 shrink-0 rounded-md ring-1 ring-foreground/10" imgClassName="object-cover" />
        <dl className="flex min-w-0 flex-col gap-1 text-sm">
          {analysis.evidence_sha256 ? (
            <div>
              <dt className="sr-only">SHA-256 of the questioned image</dt>
              <dd>
                <Hash value={analysis.evidence_sha256} />
              </dd>
            </div>
          ) : null}
          {evidence ? (
            <div>
              <dt className="sr-only">Dimensions</dt>
              <dd className="font-mono text-xs">
                {formatNumber(evidence.width)} × {formatNumber(evidence.height)} px
              </dd>
            </div>
          ) : null}
          <div className="flex gap-1 text-xs">
            <dt>{analysis.completed_at ? "Completed" : "Started"}</dt>
            <dd>
              <FormattedDate value={analysis.completed_at ?? analysis.created_at} />
            </dd>
          </div>
          <div className="text-xs">
            <dt className="sr-only">Investigation</dt>
            <dd>
              {analysis.investigation_id ? (
                <>
                  In{" "}
                  <Link href={`/app/investigations/${analysis.investigation_id}?tab=comparisons`} className="font-medium text-foreground underline underline-offset-4">
                    {investigation.data?.title ?? "its investigation"}
                  </Link>
                </>
              ) : (
                "Not filed in an investigation"
              )}
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- summary */

function Summary({ analysis }: { analysis: AnalysisDetail }) {
  const counts = analysis.summary?.counts ?? {};
  const anyNeedsControl = analysis.candidates.some((c) => needsSameModelControl(c.decision.nua));
  return (
    <section aria-labelledby="summary-heading" className="rounded-lg bg-card ring-1 ring-foreground/10">
      <div className="p-4 sm:p-5">
        <h2 id="summary-heading" className="eyebrow">
          Summary
        </h2>
        <p className="mt-2 max-w-3xl text-base leading-relaxed font-medium sm:text-lg">{analysis.summary?.text ?? "No summary was recorded for this comparison."}</p>
        {analysis.summary?.multiple_matches ? (
          <p className="mt-3 flex max-w-3xl items-start gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-sm leading-relaxed">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            More than one enrolled sensor reached the match line. One image comes from one sensor, so at least one of these is not a true match: look
            for a shared cause (fingerprints built from overlapping images, the same device enrolled twice, or model-wide artefacts) before relying on
            any of them.
          </p>
        ) : null}
        {anyNeedsControl ? (
          <p className="mt-3 flex max-w-3xl items-start gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-sm leading-relaxed">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            At least one candidate has a high statistic that cannot be attributed to an individual sensor, because the same-model alternative has not
            been ruled out. Enrol a second device of the same make and model as a control; details are with the candidate below.
          </p>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {VERDICTS.map((v) => {
            const style = VERDICT_STYLES[v];
            const n = counts[v] ?? 0;
            return (
              <div key={v} className={cn("flex items-center gap-3 rounded-md border px-3 py-2.5", n > 0 ? style.badge : "text-muted-foreground")}>
                <style.icon aria-hidden="true" className="size-4 shrink-0" />
                <dt className="min-w-0 flex-1 text-xs leading-snug font-medium">{VERDICT_LABELS[v]}</dt>
                <dd className="font-mono text-lg leading-none font-medium">{formatNumber(n)}</dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Number of candidate sensors per outcome, out of {pluralize(analysis.candidates.length, "sensor")} compared. Each sensor is judged on its own:
          nothing forces one of them to be selected.
        </p>
      </div>
      <div className="border-t p-4 sm:p-5">
        <PolicyNotice policy={analysis.policy} />
      </div>
      <details className="group border-t">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium select-none hover:bg-accent/50 sm:px-5">
          <BookOpen aria-hidden="true" className="size-4 text-muted-foreground" />
          How to read this result
        </summary>
        <div className="grid gap-x-8 gap-y-4 px-4 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-5 md:grid-cols-2">
          <div>
            <h3 className="font-medium text-foreground">What was measured</h3>
            <p className="mt-1">
              Every camera sensor leaves a faint, fixed noise pattern in its pictures. A fingerprint is an estimate of that pattern built from
              reference images of one physical sensor. The comparison extracts the noise from the questioned image and measures how strongly it
              lines up with each fingerprint. The result is a statistic called PCE: around 1 when there is no relationship, much larger when the
              pattern is present.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">How an outcome is reached</h3>
            <p className="mt-1">
              The statistic is first adjusted for the number of alignments and sensors tried, then compared with the policy&apos;s two lines. At or
              above the match line it supports a match; at or below the non-match line it supports a non-match, but only if nothing about the image
              or the fingerprint could be hiding the pattern. Everything else is inconclusive, and a test that could not be run validly is reported
              as insufficient or unsupported.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">What it does not tell you</h3>
            <p className="mt-1">
              No outcome is proof of origin, and no number on this page is the probability that the image came from a sensor. A low statistic does
              not exclude a sensor: zoom, stabilisation, editing, resizing, heavy compression and dark or saturated content can all hide the pattern.
              The method only tests the sensors you enrolled; it cannot name an unknown camera.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">Sensor, not model</h3>
            <p className="mt-1">
              The pattern belongs to one physical sensor, not to a camera model. On many recent phones, however, in-camera processing adds artefacts
              shared by every unit of a model, which can raise the statistic between different devices. For those devices a high value only supports
              a match when other units of the same model were compared as controls and stayed low.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

/* ----------------------------------------------------------------- ranking */

function candidateName(c: Candidate): string {
  return `${c.snapshot.device_name ?? "Device"} / ${c.snapshot.sensor_name ?? "sensor"}`;
}

function Ranking({ analysis, onOpen }: { analysis: AnalysisDetail; onOpen: (candidateId: string) => void }) {
  return (
    <Panel title="Candidate ranking" icon={ListOrdered} flush description="Candidates are ordered by the adjusted statistic, highest first. Rank says nothing by itself: the first candidate is only the closest of those enrolled.">
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Candidates ranked by adjusted statistic</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th scope="col" className="eyebrow h-9 w-10 px-4 font-medium">
                  Rank
                </th>
                <th scope="col" className="eyebrow h-9 px-2 font-medium">
                  Device / sensor
                </th>
                <th scope="col" className="eyebrow h-9 px-3 text-right font-medium">
                  Adjusted
                </th>
                <th scope="col" className="eyebrow hidden h-9 px-3 text-right font-medium sm:table-cell">
                  PCE
                </th>
                <th scope="col" className="eyebrow hidden h-9 px-3 text-right font-medium md:table-cell">
                  NCC
                </th>
                <th scope="col" className="eyebrow h-9 px-4 font-medium">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {analysis.candidates.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.rank}</td>
                  <td className="px-2 py-2.5">
                    <a
                      href={`#candidate-${c.id}`}
                      onClick={() => onOpen(c.id)}
                      className="font-medium break-words underline-offset-4 hover:underline"
                    >
                      {candidateName(c)}
                    </a>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {[c.snapshot.make, c.snapshot.model].filter(Boolean).join(" ")}
                      <DemoBadge when={c.snapshot.is_demo} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{formatPce(c.effective_pce)}</td>
                  <td className="hidden px-3 py-2.5 text-right font-mono whitespace-nowrap text-muted-foreground sm:table-cell">{formatPce(c.pce)}</td>
                  <td className="hidden px-3 py-2.5 text-right font-mono whitespace-nowrap text-muted-foreground md:table-cell">{formatSmall(c.ncc)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <VerdictBadge verdict={c.verdict} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Adjusted = PCE corrected for the number of alignments and candidates tried; this is the value compared with the policy lines. Reasons and
            limitations for each outcome are in the candidate details below.
          </p>
        </div>
        <div className="border-t p-4">
          <CandidateChart candidates={analysis.candidates} policy={analysis.policy} />
        </div>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- reports */

function AnalysisReports({ analysisId }: { analysisId: string }) {
  const query = useReports({ analysis_id: analysisId, limit: 100 });
  const del = useDeleteReport();
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const reports = query.data?.items;
  if (query.isError) {
    return (
      <Panel title="Reports" icon={FileText} id="reports">
        <ErrorState variant="inline" error={query.error} title="Could not load reports" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </Panel>
    );
  }
  if (!reports || reports.length === 0) return null;
  return (
    <Panel title="Reports" icon={FileText} flush id="reports">
      <ul className="divide-y" aria-live="polite">
        {reports.map((r) => (
          <ReportRow key={r.id} report={r} onDelete={setToDelete} />
        ))}
      </ul>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this report?"
        description="The PDF is permanently deleted. The comparison itself is not affected, and you can generate a new report at any time."
        confirmLabel="Delete report"
        onConfirm={async () => {
          if (!toDelete) return;
          await del.mutateAsync(toDelete.id);
          toastSuccess("Report deleted");
        }}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------- page */

function Completed({ analysis, onExpired }: { analysis: AnalysisDetail; onExpired: () => void }) {
  const createReport = useCreateAnalysisReport();
  const [open, setOpen] = useState<string[]>(() => (analysis.candidates[0] ? [analysis.candidates[0].id] : []));
  const metrics = Object.entries(analysis.quality?.metrics ?? {});
  const provenance = (analysis.provenance ?? {}) as Record<string, unknown>;
  const libraries = provenance.libraries && typeof provenance.libraries === "object" ? Object.entries(provenance.libraries as Record<string, unknown>) : [];

  return (
    <>
      <ResultHeader
        analysis={analysis}
        onExpired={onExpired}
        actions={
          <>
            <Button
              disabled={createReport.isPending}
              onClick={() =>
                createReport.mutate(analysis.id, {
                  onSuccess: () => {
                    toastSuccess("Report generated", "The PDF is listed under Reports on this page.");
                    requestAnimationFrame(() => document.getElementById("reports")?.scrollIntoView({ behavior: "smooth", block: "center" }));
                  },
                  onError: (err) => toastError(err, "Could not generate the report"),
                })
              }
            >
              <FileText aria-hidden="true" />
              {createReport.isPending ? "Generating" : "Generate PDF report"}
            </Button>
            <SaveToInvestigation analysis={analysis} />
            <Button asChild variant="outline">
              <Link href={`/app/compare?evidence=${analysis.evidence_id}${analysis.investigation_id ? `&investigation=${analysis.investigation_id}` : ""}`}>
                <GitCompareArrows aria-hidden="true" />
                Compare again
              </Link>
            </Button>
            <DeleteAnalysis analysis={analysis} />
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Summary analysis={analysis} />
        <AnalysisReports analysisId={analysis.id} />

        {analysis.candidates.length === 0 ? (
          <EmptyState icon={ScanSearch} title="No candidate results" description="The comparison completed without a result for any sensor. The fingerprints it was started with may have been deleted before it ran." />
        ) : (
          <>
            <Ranking analysis={analysis} onOpen={(cid) => setOpen((current) => (current.includes(cid) ? current : [...current, cid]))} />

            <section aria-labelledby="candidates-heading">
              <h2 id="candidates-heading" className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Microscope aria-hidden="true" className="size-4 text-muted-foreground" />
                Candidate details
              </h2>
              <Accordion type="multiple" value={open} onValueChange={setOpen} className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
                {analysis.candidates.map((c) => (
                  <AccordionItem key={c.id} value={c.id} id={`candidate-${c.id}`} className="scroll-mt-20 px-4">
                    <AccordionTrigger className="gap-3 hover:no-underline">
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="font-mono text-xs text-muted-foreground">#{c.rank}</span>
                        <span className="min-w-0 text-sm font-medium break-words">{candidateName(c)}</span>
                        <VerdictBadge verdict={c.verdict} size="sm" />
                        <span className="font-mono text-xs text-muted-foreground">{typeof c.effective_pce === "number" ? `adjusted statistic ${formatPce(c.effective_pce)}` : "no statistic"}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <CandidateDetail candidate={c} analysisPolicy={analysis.policy} candidateCount={analysis.candidates.length} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            {hasReferenceProfiles(analysis.candidates) ? (
              <Panel title="Image versus reference set" icon={Images} flush>
                <ImageVsReference analysis={analysis} />
              </Panel>
            ) : null}
          </>
        )}

        <Panel title="Questioned image quality" icon={ShieldQuestion}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div>
              <QualityFlags quality={analysis.quality} />
              {metrics.length > 0 ? (
                <dl className="mt-3 divide-y">
                  {metrics.map(([key, value]) => (
                    <Field key={key} label={labelFromKey(key)} mono>
                      {displayValue(value)}
                    </Field>
                  ))}
                </dl>
              ) : null}
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Poor image quality can hide a sensor pattern but cannot create one. Quality flags therefore block non-match conclusions, never match
                conclusions.
              </p>
            </div>
            {analysis.residual_visual_url ? (
              <figure>
                <SignedImage
                  src={analysis.residual_visual_url}
                  alt="Noise residual extracted from the questioned image, shown with enhanced contrast"
                  onExpired={onExpired}
                  className="aspect-[4/3] w-full rounded-md bg-muted/40 ring-1 ring-foreground/10"
                  imgClassName="object-contain"
                />
                <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Noise residual of the questioned image.</span> {analysis.visualisation_notice}
                </figcaption>
              </figure>
            ) : null}
          </div>
        </Panel>

        <Panel title="Reproducibility" icon={FileText}>
          <dl className="grid gap-x-8 md:grid-cols-2">
            <div className="divide-y">
              <Field label="Analysis id" mono>
                {analysis.id}
              </Field>
              <Field label="Algorithm version" mono>
                {displayValue(provenance.algorithm_version)}
              </Field>
              <Field label="Engine version" mono>
                {displayValue(provenance.engine_version)}
              </Field>
              <Field label="Noise parameter sigma0" mono>
                {displayValue(provenance.sigma0)}
              </Field>
              <Field label="Decision policy" mono>
                {analysis.policy.policy_id ?? "-"}
              </Field>
              <Field label="Policy version" mono>
                {analysis.policy.version ?? "-"}
              </Field>
            </div>
            <div className="divide-y border-t md:border-t-0">
              {libraries.map(([name, version]) => (
                <Field key={name} label={name} mono>
                  {String(version)}
                </Field>
              ))}
            </div>
          </dl>
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
            The same image bytes (see the SHA-256 above), the same fingerprint versions (digests are in each candidate&apos;s details) and the same
            software versions give the same numbers.
          </p>
        </Panel>
      </div>
    </>
  );
}

export function AnalysisResult() {
  const { id } = useParams<{ id: string }>();
  const query = useAnalysis(id);
  const analysis = query.data;
  useBreadcrumbLabel(analysis?.evidence_filename);

  if (query.isError) {
    return query.error instanceof ApiError && query.error.isNotFound ? (
      <EmptyState
        icon={ScanSearch}
        title="Comparison not found"
        description="It may have been deleted, together with its evidence image or investigation."
        action={
          <Button asChild>
            <Link href="/app/compare">Open the comparison laboratory</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={query.error} title="Could not load this comparison" onRetry={() => void query.refetch()} retrying={query.isFetching} />
    );
  }
  if (!analysis) {
    return (
      <div role="status" aria-label="Loading comparison result">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <div className="mt-4 flex gap-4">
          <Skeleton className="size-20" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
        <Skeleton className="mt-8 h-56 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (analysis.status === "completed") return <Completed analysis={analysis} onExpired={() => void query.refetch()} />;

  const active = analysis.status === "pending" || analysis.status === "running";
  return (
    <>
      <ResultHeader
        analysis={analysis}
        onExpired={() => void query.refetch()}
        actions={
          active ? null : (
            <>
              <Button asChild variant="outline">
                <Link href={`/app/compare?evidence=${analysis.evidence_id}${analysis.investigation_id ? `&investigation=${analysis.investigation_id}` : ""}`}>
                  <GitCompareArrows aria-hidden="true" />
                  Compare again
                </Link>
              </Button>
              <DeleteAnalysis analysis={analysis} />
            </>
          )
        }
      />
      <Panel title={active ? "Comparison in progress" : `Comparison ${humanize(analysis.status).toLowerCase()}`} icon={ScanSearch}>
        {analysis.job_id ? (
          <JobProgress jobId={analysis.job_id} title="Sensor comparison" onDone={() => void query.refetch()} />
        ) : active ? (
          <p className="text-sm text-muted-foreground">Waiting for the comparison to be picked up.</p>
        ) : null}
        {!active ? (
          <div role="alert" className="mt-3 rounded-md border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm leading-relaxed">
            <p className="font-medium">{analysis.status === "cancelled" ? "This comparison was cancelled before it finished." : "This comparison did not finish."}</p>
            {analysis.error ? <p className="mt-1 text-muted-foreground">{analysis.error}</p> : null}
            <p className="mt-1 text-muted-foreground">No result was produced. You can run it again from the comparison laboratory.</p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {pluralize(analysis.candidate_count ?? 0, "candidate sensor")} queued for this image. The result appears here as soon as the job finishes.
          </p>
        )}
      </Panel>
    </>
  );
}
