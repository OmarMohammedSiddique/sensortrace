"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleCheck,
  Download,
  FileText,
  Fingerprint as FingerprintIcon,
  FlaskConical,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { diagnosticsOf } from "@/components/cameras/fingerprint-types";
import { Notice, triggerDownload, useSensorBuild } from "@/components/cameras/shared";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { Bytes, FormattedDate, Pce } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { PageHeader } from "@/components/st/page-header";
import { PolicyNotice } from "@/components/st/policy-notice";
import { SignedImage } from "@/components/st/signed-image";
import { ErrorState } from "@/components/st/states";
import { Stat } from "@/components/st/stat";
import { VerdictBadge } from "@/components/st/verdict-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  useAnalyses,
  useAnalysis,
  useCreateAnalysisReport,
  useCreateDemo,
  useDashboard,
  useDeleteDemo,
  useDevices,
  useEvidenceList,
  useFingerprint,
  useInvestigations,
  useMeta,
  useReports,
  useStartAnalyses,
  useStartFingerprint,
  useUpdateProfile,
} from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { Analysis, Evidence, Report, Sensor } from "@/lib/api/types";
import { useUser } from "@/lib/auth";
import { needsSameModelControl } from "@/lib/domain";
import { formatNumber, formatPce, pluralize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, title: "What it tells you" },
  { n: 2, title: "Demo cameras" },
  { n: 3, title: "A fingerprint" },
  { n: 4, title: "Compare images" },
  { n: 5, title: "Report" },
  { n: 6, title: "Finish" },
] as const;

/** How long a partial demo data set is treated as "still being generated" after its first object appeared. */
const SETUP_WINDOW_MS = 5 * 60_000;

const SYNTHETIC_SENTENCE =
  "Everything in this guide is synthetic: the simulated cameras follow a textbook noise model, so these results say nothing about real-world accuracy.";

/* ----------------------------------------------------------------- state */

/** Everything the guide needs, read from the API so the flow survives a reload. */
function useDemoState() {
  const dashboard = useDashboard();
  const devices = useDevices({ limit: 200 });
  const investigations = useInvestigations({ limit: 200 });
  const investigation = investigations.data?.items.find((i) => i.is_demo);
  const evidence = useEvidenceList({ investigation_id: investigation?.id, limit: 200 }, { enabled: Boolean(investigation) });
  const analyses = useAnalyses({ investigation_id: investigation?.id, limit: 200 }, { enabled: Boolean(investigation) });
  const reports = useReports({ investigation_id: investigation?.id, limit: 200 });

  const demoDevices = (devices.data?.items ?? []).filter((d) => d.is_demo);
  const sensors: Sensor[] = demoDevices.flatMap((d) => d.sensors ?? []).toSorted((a, b) => a.created_at.localeCompare(b.created_at));
  const questioned = (evidence.data?.items ?? [])
    .filter((e) => e.category === "questioned")
    .toSorted((a, b) => a.filename.localeCompare(b.filename));

  // Newest analysis for each questioned image (the API lists newest first).
  const latest = new Map<string, Analysis>();
  for (const a of analyses.data?.items ?? []) if (a.evidence_id && !latest.has(a.evidence_id)) latest.set(a.evidence_id, a);
  const current = questioned.flatMap((e) => latest.get(e.id) ?? []);
  const completed = current.filter((a) => a.status === "completed");
  const analysisIds = new Set((analyses.data?.items ?? []).map((a) => a.id));
  const demoReports = investigation ? (reports.data?.items ?? []).filter((r) => r.analysis_id && analysisIds.has(r.analysis_id)) : [];

  const hasDemo = Boolean(dashboard.data?.has_demo_data) || demoDevices.length > 0 || Boolean(investigation);
  const readySensors = sensors.filter((s) => s.active_fingerprint);
  const allReady = sensors.length > 0 && readySensors.length === sensors.length;
  const complete = sensors.length > 0 && questioned.length > 0;

  const queries = [dashboard, devices, investigations];
  const loading =
    queries.some((q) => q.isPending) || (Boolean(investigation) && (evidence.isPending || analyses.isPending || reports.isPending));
  const failed = [...queries, evidence, analyses].find((q) => q.isError && !q.data);

  // POST /demo builds the data set piece by piece and can take over a minute, so after a
  // reload a partial set is normal for a while. Only call it broken once that window passed.
  const firstCreated = Math.min(
    ...demoDevices.map((d) => new Date(d.created_at).getTime()),
    ...(investigation ? [new Date(investigation.created_at).getTime()] : []),
  );
  const partial = hasDemo && !complete;
  const settingUp = partial && Number.isFinite(firstCreated) && devices.dataUpdatedAt - firstCreated < SETUP_WINDOW_MS;

  const refetchSetup = () => {
    for (const q of [dashboard, devices, investigations, evidence]) void q.refetch();
  };

  return {
    loading,
    error: failed?.error ?? null,
    retry: () => {
      for (const q of [...queries, evidence, analyses, reports]) void q.refetch();
    },
    hasDemo,
    /** Demo data is partly there and recent: it is still being generated on the server. */
    settingUp,
    refetchSetup,
    /** Demo data exists on the server but parts of it were deleted by hand. */
    broken: partial && !settingUp && !devices.isFetching && !evidence.isFetching,
    investigation,
    sensors,
    readySensors,
    allReady,
    questioned,
    latest,
    current,
    completed,
    reports: demoReports,
  };
}
type DemoState = ReturnType<typeof useDemoState>;

function maxStepFor(s: DemoState): number {
  if (!s.hasDemo || s.readySensors.length === 0) return 2;
  if (!s.allReady) return 3;
  if (s.completed.length === 0) return 4;
  return 6;
}

function defaultStepFor(s: DemoState, onboardingCompleted: boolean): number {
  if (!s.hasDemo) return 1;
  if (!s.allReady) return 2;
  if (s.current.length === 0) return 3;
  if (s.completed.length === 0 || s.reports.length === 0) return 4;
  return onboardingCompleted ? 6 : 5;
}

/* --------------------------------------------------------------- stepper */

function Stepper({ step, maxStep, onStep }: { step: number; maxStep: number; onStep: (n: number) => void }) {
  return (
    <nav aria-label="Guide steps">
      <p className="mb-2 text-xs text-muted-foreground sm:hidden" aria-hidden="true">
        Step {step} of {STEPS.length}: <span className="font-medium text-foreground">{STEPS[step - 1].title}</span>
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((s) => {
          const state = s.n < step ? "done" : s.n === step ? "current" : "todo";
          const reachable = s.n <= maxStep || s.n === step;
          return (
            <li key={s.n} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                disabled={!reachable}
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => onStep(s.n)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-md py-1 pr-1 text-left text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:pr-2",
                  reachable ? "hover:text-foreground" : "cursor-not-allowed opacity-50",
                  state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[0.6875rem]",
                    state === "done" ? "bg-brand-subtle text-brand ring-1 ring-brand-border" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check className="size-3" /> : s.n}
                </span>
                <span className="hidden truncate lg:inline">{s.title}</span>
                <span className="sr-only lg:hidden">
                  Step {s.n}: {s.title}
                </span>
                <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : !reachable ? " (not available yet)" : ""}</span>
              </button>
              {s.n < STEPS.length ? <span aria-hidden="true" className={cn("h-px min-w-2 flex-1", s.n < step ? "bg-brand-border" : "bg-border")} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepShell({
  n,
  title,
  lead,
  children,
  footer,
}: {
  n: number;
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <section aria-labelledby="step-title" className="animate-fade-up overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      <header className="border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="eyebrow">
            Step {n} of {STEPS.length}
          </p>
          <DemoBadge />
        </div>
        <h2 id="step-title" className="mt-1.5 text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {lead ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{lead}</p> : null}
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">{SYNTHETIC_SENTENCE}</p>
      </header>
      <div className="flex flex-col gap-5 px-4 py-5 sm:px-6">{children}</div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 sm:px-6">{footer}</footer>
    </section>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" onClick={onClick}>
      <ArrowLeft aria-hidden="true" /> Back
    </Button>
  );
}

/* ---------------------------------------------------------------- step 1 */

function IntroStep({ onNext }: { onNext: () => void }) {
  const meta = useMeta();
  return (
    <StepShell
      n={1}
      title="What SensorTrace does, and what it does not"
      lead="Every camera sensor leaves a faint, stable noise pattern in its photos. SensorTrace estimates that pattern from reference images you take with a camera, then tests whether a questioned image is consistent with it."
      footer={
        <>
          <span />
          <Button onClick={onNext}>
            Continue <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <CircleCheck aria-hidden="true" className="size-4 text-success" /> What it can tell you
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>Whether a questioned image is consistent with the fingerprint of a specific sensor you have enrolled.</li>
            <li>How strong the statistic is, which decision policy was applied, and the reasons and caveats behind each outcome.</li>
            <li>When the image or the fingerprint is not good enough to say anything, instead of guessing.</li>
          </ul>
        </div>
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">What it cannot tell you</h3>
          {meta.isPending ? (
            <div className="mt-3 flex flex-col gap-2" role="status" aria-label="Loading limitations">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : meta.isError ? (
            <ErrorState variant="inline" className="mt-3" title="Could not load the limitations" error={meta.error} onRetry={() => void meta.refetch()} retrying={meta.isFetching} />
          ) : (
            <dl className="mt-2 flex flex-col gap-2.5 text-sm leading-relaxed">
              {meta.data.limitations.map((l) => (
                <div key={l.title}>
                  <dt className="font-medium">{l.title}</dt>
                  <dd className="text-muted-foreground">{l.body}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        The next steps run the real workflow on two simulated cameras and three simulated questioned images, so you
        can see every screen before using your own material.
      </p>
    </StepShell>
  );
}

/* ---------------------------------------------------------------- step 2 */

function DemoSensorRow({ sensor }: { sensor: Sensor }) {
  const { building, job } = useSensorBuild(sensor.id);
  const retry = useStartFingerprint(sensor.id);
  const name = `${sensor.device_name} / ${sensor.name}`;
  if (job) {
    return (
      <li>
        <JobProgress jobId={job.id} title={`Enrolling ${name}`} className="bg-background" />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-background p-4 ring-1 ring-foreground/10">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {sensor.active_fingerprint
            ? `Fingerprint v${sensor.active_fingerprint.version} built from ${pluralize(sensor.active_fingerprint.n_images, "reference image")}`
            : building
              ? "Waiting for the fingerprint job to start"
              : `${pluralize(sensor.reference_count ?? 0, "reference image")}, no fingerprint. The job did not complete.`}
        </p>
      </div>
      {sensor.active_fingerprint ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <CircleCheck aria-hidden="true" className="size-3.5" /> Ready
        </span>
      ) : building ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={retry.isPending}
          onClick={() => retry.mutate(undefined, { onError: (e) => toastError(e, "Could not start the fingerprint job") })}
        >
          <RotateCcw aria-hidden="true" /> {retry.isPending ? "Starting" : "Build fingerprint again"}
        </Button>
      )}
    </li>
  );
}

function DemoStep({ state, onBack, onNext }: { state: DemoState; onBack: () => void; onNext: () => void }) {
  const queryClient = useQueryClient();
  const create = useCreateDemo();
  const remove = useDeleteDemo();
  const [error, setError] = useState<string | null>(null);

  const createDemo = () => {
    setError(null);
    create.mutate(undefined, {
      onError: (e) => {
        // 409 demo_exists: the data is already there, so just load it.
        if (e instanceof ApiError && e.code === "demo_exists") void queryClient.invalidateQueries();
        else setError(e.message);
      },
    });
  };
  const reset = async () => {
    setError(null);
    try {
      await remove.mutateAsync();
      await create.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the demo data.");
    }
  };
  const working = create.isPending || remove.isPending;

  // After a reload during creation there is no pending request to wait for: poll instead.
  const { settingUp, refetchSetup } = state;
  const refetchRef = useRef(refetchSetup);
  useEffect(() => {
    refetchRef.current = refetchSetup;
  });
  const creating = create.isPending;
  useEffect(() => {
    if (!settingUp && !creating) return;
    const timer = setInterval(() => refetchRef.current(), 3_000);
    return () => clearInterval(timer);
  }, [settingUp, creating]);

  return (
    <StepShell
      n={2}
      title="Create two demo cameras and enrol them"
      lead="Enrolment is how a camera becomes testable: you give SensorTrace reference images taken with it, and it estimates the sensor's fingerprint from them."
      footer={
        <>
          <BackButton onClick={onBack} />
          <Button onClick={onNext} disabled={!state.allReady}>
            {state.allReady ? "Continue" : "Waiting for both fingerprints"} <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </>
      }
    >
      {error ? (
        <Notice tone="danger" title="That did not work" role="alert">
          <span className="text-foreground">{error}</span>
        </Notice>
      ) : null}

      {!state.hasDemo ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            This adds two simulated cameras of the same model, each with its own set of reference images, a demo
            investigation and three questioned images. All of it is labelled as synthetic and can be removed in one click at the
            end.
          </p>
          <Button className="shrink-0" onClick={createDemo} disabled={working}>
            <FlaskConical aria-hidden="true" /> {create.isPending ? "Creating demo cameras" : "Create demo cameras"}
          </Button>
        </div>
      ) : state.settingUp || (create.isPending && !state.allReady) ? null : state.broken ? (
        <Notice tone="warning" title="The demo data is incomplete">
          Some of the demo cameras or images were deleted, so the guide cannot continue with what is left. Resetting
          removes the remaining demo data and creates a fresh set. Your own data is not touched.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => void reset()} disabled={working}>
              <RotateCcw aria-hidden="true" /> {working ? "Resetting" : "Reset demo data"}
            </Button>
          </div>
        </Notice>
      ) : null}

      {create.isPending || state.settingUp ? (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-brand" />
          Generating the synthetic cameras and images. This can take a minute or two; enrolment of each camera starts
          as soon as its reference images exist.
        </p>
      ) : null}

      {state.sensors.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Demo sensor enrolment">
          {state.sensors.map((s) => (
            <DemoSensorRow key={s.id} sensor={s} />
          ))}
        </ul>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">What enrolment is doing</h3>
        <ol className="mt-2 grid gap-3 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <li className="rounded-md border p-3">
            <span className="font-medium text-foreground">Screening.</span> Each reference image is checked for
            resolution, exposure, clipping and texture.
          </li>
          <li className="rounded-md border p-3">
            <span className="font-medium text-foreground">Consistency.</span> Only images with the same dimensions
            and camera are kept in one group.
          </li>
          <li className="rounded-md border p-3">
            <span className="font-medium text-foreground">Estimating.</span> The noise left after denoising each image
            is combined, so the scene averages away and the sensor pattern remains.
          </li>
          <li className="rounded-md border p-3">
            <span className="font-medium text-foreground">Finalising.</span> Diagnostics are computed and the
            fingerprint is stored as a new version.
          </li>
        </ol>
      </div>
    </StepShell>
  );
}

/* ---------------------------------------------------------------- step 3 */

function FingerprintStep({ state, onBack, onNext }: { state: DemoState; onBack: () => void; onNext: () => void }) {
  const sensor = state.readySensors[0];
  const detail = useFingerprint(sensor?.active_fingerprint_id);
  const fp = detail.data;
  const diag = diagnosticsOf(fp);

  return (
    <StepShell
      n={3}
      title="Look at a fingerprint"
      lead="A fingerprint is not a picture of anything. It is an estimate of how each pixel of this sensor responds slightly differently to light, and it comes with diagnostics that say how trustworthy the estimate is."
      footer={
        <>
          <BackButton onClick={onBack} />
          <Button onClick={onNext} disabled={!state.allReady}>
            {state.allReady ? "Continue" : "Waiting for both fingerprints"} <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </>
      }
    >
      {!sensor ? (
        <p className="text-sm text-muted-foreground">No demo fingerprint is ready yet. Go back one step to follow the enrolment.</p>
      ) : detail.isPending ? (
        <div role="status" aria-label="Loading fingerprint" className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : detail.isError ? (
        <ErrorState title="Could not load the demo fingerprint" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
      ) : fp ? (
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <figure className="min-w-0">
            <SignedImage
              src={fp.visual_url}
              alt={`Contrast-enhanced rendering of the noise pattern of ${sensor.device_name}`}
              onExpired={() => void detail.refetch()}
              className="aspect-[4/3] w-full"
              imgClassName="object-contain"
            />
            <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">{fp.visualisation_notice}</figcaption>
          </figure>
          <div className="flex min-w-0 flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {sensor.device_name} / {sensor.name}
              <DemoBadge />
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Stat label="Version" value={`v${fp.version}`} mono />
              <Stat label="Images used" value={formatNumber(fp.n_images)} />
              <Stat label="Dimensions" value={fp.width && fp.height ? `${fp.width} × ${fp.height}` : "-"} unit="px" mono />
              <Stat label="Median leave-one-out PCE" value={formatPce(diag.screening?.loo_pce_median)} mono />
              <Stat
                className="col-span-2"
                label="Split-half PCE"
                value={formatPce(diag.split_half?.pce)}
                mono
                hint="Two fingerprints built from separate halves of the references, compared with each other. A large positive value means the pattern is reproducible. It is a statistic, not a percentage."
              />
            </dl>
            <div>
              <p className="eyebrow mb-1">Fingerprint digest</p>
              <Hash value={fp.digest} label="fingerprint digest" chars={12} />
            </div>
            {(diag.warnings ?? []).map((w) => (
              <Notice key={w} tone="warning">
                <span className="text-foreground">{w}</span>
              </Notice>
            ))}
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/sensors/${sensor.id}?tab=fingerprint`}>
                  <FingerprintIcon aria-hidden="true" /> Open the full sensor page
                </Link>
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">Use the browser back button or the Getting started link to return here; your place is kept.</p>
            </div>
          </div>
        </div>
      ) : null}
    </StepShell>
  );
}

/* ---------------------------------------------------------------- step 4 */

function Outcome({ analysis }: { analysis: Analysis }) {
  const detail = useAnalysis(analysis.id);
  if (detail.isPending) {
    return (
      <div role="status" aria-label="Loading result" className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return <ErrorState variant="inline" title="Could not load this result" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  }
  const a = detail.data;
  const candidates = a.candidates.toSorted((x, y) => x.rank - y.rank);
  const anyMatch = candidates.some((c) => c.verdict === "match_supported");
  const caveats = [...new Set(candidates.flatMap((c) => c.decision?.caveats ?? []))];

  return (
    <div className="flex flex-col gap-3">
      {a.summary?.text ? <p className="text-sm leading-relaxed">{a.summary.text}</p> : null}
      {!anyMatch ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No enrolled sensor is supported as the source, and nothing is forced to match. This is what an image from a
          camera that was never enrolled looks like; the tool does not pick the closest candidate.
        </p>
      ) : null}
      <ol className="flex flex-col gap-2" aria-label="Ranked candidates">
        {candidates.map((c) => (
          <li key={c.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[0.6875rem] text-muted-foreground">
                  {c.rank}
                </span>
                <span className="sr-only">Rank {c.rank}: </span>
                <span className="truncate">
                  {c.snapshot?.device_name} / {c.snapshot?.sensor_name}
                </span>
              </p>
              <VerdictBadge verdict={c.verdict} size="sm" wrap />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Statistic (effective PCE): <Pce value={c.decision?.effective_pce ?? c.effective_pce} className="font-mono text-foreground" />
            </p>
            {(c.decision?.reasons ?? []).length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                {(c.decision?.reasons ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            {needsSameModelControl(c.decision?.nua) ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                This device is not a conventional pipeline and has no passing same-model control, so a high statistic
                cannot be attributed to the individual sensor. Enrol a second device of the same make and model as a
                control.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {caveats.length > 0 ? (
        <div>
          <p className="eyebrow mb-1">Caveats</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PolicyNotice policy={a.policy} variant="compact" />
      <div>
        <Button asChild variant="ghost" size="xs" className="-ml-1.5 text-muted-foreground">
          <Link href={`/app/analyses/${a.id}`}>
            Open the full analysis <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ResultCard({ evidence, analysis, onExpired }: { evidence: Evidence; analysis: Analysis | undefined; onExpired: () => void }) {
  const source = typeof evidence.acquisition?.source === "string" ? evidence.acquisition.source : "";
  const active = analysis && (analysis.status === "pending" || analysis.status === "running");
  return (
    <li className="grid gap-4 rounded-lg bg-background p-4 ring-1 ring-foreground/10 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <SignedImage src={evidence.preview_url} alt={`Preview of ${evidence.filename}`} onExpired={onExpired} className="aspect-[4/3] w-full max-w-[14rem]" imgClassName="object-cover" />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="truncate">{evidence.filename}</span>
            <DemoBadge />
          </p>
          {source ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Known origin, because the data is synthetic: <span className="text-foreground">{source}</span>
            </p>
          ) : null}
        </div>
        {!analysis ? (
          <p className="text-sm text-muted-foreground">Not compared yet.</p>
        ) : active && analysis.job_id ? (
          <JobProgress jobId={analysis.job_id} title="Comparing against both demo sensors" compact />
        ) : active ? (
          <p className="text-sm text-muted-foreground">Waiting to start.</p>
        ) : analysis.status === "completed" ? (
          <Outcome analysis={analysis} />
        ) : (
          <Notice tone="danger" title="This comparison did not complete" role="note">
            <span className="break-words text-foreground">{analysis.error || "No further detail was recorded."}</span>
          </Notice>
        )}
      </div>
    </li>
  );
}

function CompareStep({ state, onBack, onNext, onExpired }: { state: DemoState; onBack: () => void; onNext: () => void; onExpired: () => void }) {
  const start = useStartAnalyses();
  const notStarted = state.questioned.filter((e) => !state.latest.has(e.id));
  const unfinished = state.questioned.filter((e) => {
    const a = state.latest.get(e.id);
    return a && a.status !== "completed" && a.status !== "pending" && a.status !== "running";
  });
  const running = state.current.some((a) => a.status === "pending" || a.status === "running");
  const toRun = [...notStarted, ...unfinished];

  const run = () =>
    start.mutate(
      {
        evidence_ids: toRun.map((e) => e.id),
        sensor_ids: state.sensors.map((s) => s.id),
        investigation_id: state.investigation?.id,
      },
      { onError: (e) => toastError(e, "Could not start the comparisons") },
    );

  return (
    <StepShell
      n={4}
      title="Compare the three questioned images"
      lead="Each questioned image is tested against both demo fingerprints. One image comes from each demo camera, and one comes from a third simulated camera that is not enrolled."
      footer={
        <>
          <BackButton onClick={onBack} />
          <Button onClick={onNext} disabled={state.completed.length === 0}>
            Continue <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </>
      }
    >
      {toRun.length > 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {notStarted.length === state.questioned.length
              ? `Runs ${pluralize(state.questioned.length, "comparison")}, one per image, each against ${pluralize(state.sensors.length, "sensor")}.`
              : `${pluralize(toRun.length, "image")} still ${toRun.length === 1 ? "needs" : "need"} a completed comparison.`}
          </p>
          <Button className="shrink-0" onClick={run} disabled={start.isPending || running || !state.allReady}>
            <ScanSearch aria-hidden="true" />
            {start.isPending ? "Starting" : notStarted.length === state.questioned.length ? "Compare the three questioned images" : "Run the remaining comparisons"}
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-3" aria-label="Questioned images and their results">
        {state.questioned.map((e) => (
          <ResultCard key={e.id} evidence={e} analysis={state.latest.get(e.id)} onExpired={onExpired} />
        ))}
      </ul>
      {state.completed.length > 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Notice the wording. An outcome either supports a match, supports a non-match, or is inconclusive. A low
          statistic alone is not treated as proof of a different camera, and no result is a probability.
        </p>
      ) : null}
    </StepShell>
  );
}

/* ---------------------------------------------------------------- step 5 */

function ReportDownload({ report }: { report: Report }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      // Signed links expire after five minutes: ask for a fresh one at the moment of the click.
      const fresh = await unwrap<Report>(api.GET("/api/v1/reports/{report_id}", { params: { path: { report_id: report.id } } }));
      if (!fresh.download_url) throw new Error("The report file is not available.");
      triggerDownload(fresh.download_url);
    } catch (err) {
      toastError(err, "Could not download the report");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void download()} disabled={busy}>
      <Download aria-hidden="true" /> {busy ? "Preparing" : "Download PDF"}
      <span className="sr-only"> {report.title}</span>
    </Button>
  );
}

function ReportStep({ state, onBack, onNext }: { state: DemoState; onBack: () => void; onNext: () => void }) {
  const create = useCreateAnalysisReport();
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = state.completed.find((a) => a.id === chosen)?.id ?? state.completed[0]?.id ?? null;

  return (
    <StepShell
      n={5}
      title="Generate a report"
      lead="A report is a PDF that records one analysis: the image and its hash, the fingerprints compared, every measurement, the decision policy, the reasons and the caveats. It is a record of what was measured, not a certificate."
      footer={
        <>
          <BackButton onClick={onBack} />
          <Button onClick={onNext}>
            {state.reports.length > 0 ? "Continue" : "Skip for now"} <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </>
      }
    >
      {state.completed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed comparison yet. Go back one step to run them.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Label id="report-analysis-label" className="text-sm font-medium">
            Which analysis should the report cover?
          </Label>
          <RadioGroup value={selected ?? ""} onValueChange={setChosen} aria-labelledby="report-analysis-label" className="grid gap-2">
            {state.completed.map((a) => {
              const id = `report-analysis-${a.id}`;
              return (
                <label
                  key={a.id}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border p-3 transition-colors hover:bg-accent/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                    selected === a.id && "border-brand-border bg-brand-subtle",
                  )}
                >
                  <RadioGroupItem id={id} value={a.id} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.evidence_filename}</span>
                  <VerdictBadge verdict={a.top_verdict} size="sm" short />
                </label>
              );
            })}
          </RadioGroup>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The labels show the top-ranked outcome only. The reasons, caveats and policy status behind each one are on
            the previous step and are written into the report.
          </p>
          <div>
            <Button
              disabled={!selected || create.isPending}
              onClick={() =>
                selected
                  ? create.mutate(selected, {
                      onSuccess: () => toastSuccess("Report generated", "It is also listed under Reports."),
                      onError: (e) => toastError(e, "Could not generate the report"),
                    })
                  : undefined
              }
            >
              <FileText aria-hidden="true" /> {create.isPending ? "Generating report" : "Generate report"}
            </Button>
          </div>
        </div>
      )}

      {state.reports.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium">Generated reports</h3>
          <ul className="mt-2 divide-y rounded-md border" aria-live="polite">
            {state.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="break-words">{r.title}</span>
                    <DemoBadge />
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <FormattedDate value={r.created_at} />
                    <span aria-hidden="true">·</span>
                    <Bytes value={r.size_bytes} />
                    <span aria-hidden="true">·</span>
                    <Hash value={r.sha256} chars={6} />
                  </p>
                </div>
                <ReportDownload report={r} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </StepShell>
  );
}

/* ---------------------------------------------------------------- step 6 */

function FinishStep({ state, onBack, onRestart }: { state: DemoState; onBack: () => void; onRestart: () => void }) {
  const user = useUser();
  const update = useUpdateProfile();
  const remove = useDeleteDemo();
  const [confirm, setConfirm] = useState(false);
  const meta = useMeta();
  const recommended = meta.data?.limits.recommended_reference_images;
  const done = user.onboarding_completed;

  const finish = (onDone?: () => void) => {
    if (done) return onDone?.();
    update.mutate({ onboarding_completed: true }, { onSuccess: () => onDone?.(), onError: (e) => toastError(e, "Could not save your progress") });
  };

  return (
    <StepShell
      n={6}
      title={done ? "You have finished the guide" : "Finish the guide"}
      lead="You have enrolled two sensors, inspected a fingerprint, compared three images and seen how outcomes, reasons and caveats are reported. The same steps apply to real cameras, with one difference: real results depend on the quality of your reference images and on the camera's processing."
      footer={
        <>
          <BackButton onClick={onBack} />
          {done ? (
            <Button asChild>
              <Link href="/app/cameras?new=1">
                <Camera aria-hidden="true" /> Register your own camera
              </Link>
            </Button>
          ) : (
            <Button onClick={() => finish(() => toastSuccess("Guide completed"))} disabled={update.isPending}>
              <Check aria-hidden="true" /> {update.isPending ? "Saving" : "Finish the guide"}
            </Button>
          )}
        </>
      }
    >
      {done ? (
        <Notice tone="success" title="Guide completed" role="status">
          The dashboard no longer shows the getting-started banner.
        </Notice>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Camera aria-hidden="true" className="size-4 text-muted-foreground" /> Next: your own camera
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Register the device, add a sensor for the lens and mode you care about, and upload{" "}
            {recommended ? `${recommended} or more` : "plenty of"} flat, bright reference images taken with it.
          </p>
          <div className="mt-auto">
            <Button asChild variant="outline" onClick={() => finish()}>
              <Link href="/app/cameras?new=1">Register your own camera</Link>
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical aria-hidden="true" className="size-4 text-muted-foreground" /> The demo data
          </h3>
          {state.hasDemo ? (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Keep it to explore the other screens, or remove it now. It stays labelled as synthetic wherever it
                appears and can also be removed later from the dashboard.
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setConfirm(true)}>
                  <Trash2 aria-hidden="true" /> Remove demo data
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/app">Keep it and go to the dashboard</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">The demo data has been removed. You can run the guide again whenever you like.</p>
              <div className="mt-auto">
                <Button variant="outline" onClick={onRestart}>
                  <RotateCcw aria-hidden="true" /> Start the guide again
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove synthetic demo data?"
        description="The demo cameras, their fingerprints, the demo investigation and every analysis and report made from them will be deleted. Your own data is not affected. This cannot be undone."
        confirmLabel="Remove demo data"
        onConfirm={async () => {
          // Removing the demo ends the guide, so record it as completed first.
          if (!done) await update.mutateAsync({ onboarding_completed: true });
          await remove.mutateAsync();
          toastSuccess("Demo data removed");
        }}
      />
    </StepShell>
  );
}

/* ------------------------------------------------------------------ page */

function GuideSkeleton() {
  return (
    <div role="status" aria-label="Loading the guide" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-full max-w-2xl" />
      <Skeleton className="h-96 rounded-lg" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function OnboardingInner() {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const state = useDemoState();

  const setStep = (n: number) => {
    router.replace(`${pathname}?step=${n}`, { scroll: false });
    window.scrollTo({ top: 0 });
  };

  let body: React.ReactNode;
  let step = 1;
  let maxStep = 2;
  if (state.loading) {
    body = <GuideSkeleton />;
  } else if (state.error) {
    body = <ErrorState title="Could not load the guide" error={state.error} onRetry={state.retry} />;
  } else {
    maxStep = maxStepFor(state);
    const requested = Number(search.get("step"));
    // Step 6 stays reachable after the demo data is removed there.
    const cap = requested === 6 && user.onboarding_completed ? 6 : maxStep;
    step = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, cap) : defaultStepFor(state, user.onboarding_completed);
    const back = () => setStep(Math.max(1, step - 1));
    const next = () => setStep(step + 1);
    body =
      step === 1 ? (
        <IntroStep onNext={next} />
      ) : step === 2 ? (
        <DemoStep state={state} onBack={back} onNext={next} />
      ) : step === 3 ? (
        <FingerprintStep state={state} onBack={back} onNext={next} />
      ) : step === 4 ? (
        <CompareStep state={state} onBack={back} onNext={next} onExpired={() => void queryClient.invalidateQueries({ queryKey: qk.evidence.all })} />
      ) : step === 5 ? (
        <ReportStep state={state} onBack={back} onNext={next} />
      ) : (
        <FinishStep state={state} onBack={back} onRestart={() => setStep(1)} />
      );
  }

  return (
    <>
      <PageHeader
        title="Getting started"
        badges={<DemoBadge />}
        description="A guided run through the real workflow on clearly labelled synthetic data. It takes a few minutes and you can leave and come back at any point."
      />
      <div className="flex flex-col gap-6">
        {state.loading || state.error ? null : <Stepper step={step} maxStep={maxStep} onStep={setStep} />}
        <div key={step}>{body}</div>
      </div>
    </>
  );
}

export function Onboarding() {
  return (
    <Suspense fallback={<GuideSkeleton />}>
      <OnboardingInner />
    </Suspense>
  );
}
