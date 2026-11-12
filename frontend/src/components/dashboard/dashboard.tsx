"use client";

import {
  Activity,
  ArrowRight,
  Camera,
  ChevronRight,
  FlaskConical,
  FolderPlus,
  FolderSearch,
  GitCompareArrows,
  HardDrive,
  History,
  Rocket,
  ScanSearch,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { JobProgressView } from "@/components/st/job-progress";
import { PageHeader } from "@/components/st/page-header";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { MetricCard } from "@/components/st/stat";
import { VerdictBadge } from "@/components/st/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useCancelJob, useCreateDemo, useDashboard, useDeleteDemo, useUpdateProfile } from "@/lib/api/hooks";
import type { Analysis, AuditEntry, Dashboard as DashboardData, Investigation, Job, StorageBreakdown } from "@/lib/api/types";
import { useAuth } from "@/lib/auth";
import { auditHref, auditText } from "@/lib/domain";
import { formatBytes, formatNumber, humanize, pluralize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ panel */

function Panel({
  title,
  icon: Icon,
  action,
  children,
  className,
  flush = false,
}: {
  title: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Children manage their own horizontal padding (lists with dividers). */
  flush?: boolean;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10", className)}>
      <header className="flex h-11 items-center justify-between gap-3 border-b px-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {Icon ? <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
          {title}
        </h2>
        {action}
      </header>
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground">
      <Link href={href}>
        View all<span className="sr-only"> {label}</span>
        <ChevronRight aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------- onboarding */

function OnboardingBanner({ hasDemo }: { hasDemo: boolean }) {
  const update = useUpdateProfile();
  const demo = useCreateDemo();
  return (
    <section
      aria-labelledby="onboarding-title"
      className="relative mb-6 overflow-hidden rounded-lg border border-brand-border bg-brand-subtle"
    >
      <div aria-hidden="true" className="bg-dot-grid absolute inset-y-0 right-0 w-1/2 opacity-70 [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-4">
          <span className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-background text-brand ring-1 ring-brand-border sm:flex">
            <Rocket aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 id="onboarding-title" className="text-base font-medium">
              Set up your first comparison
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              A short guide takes you through registering a camera, building its sensor fingerprint and testing a
              photograph against it.
              {hasDemo ? null : " You can also load synthetic demo data to explore the workflow first."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild>
            <Link href="/app/onboarding">
              Start the guide <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
          {hasDemo ? null : (
            <Button
              variant="outline"
              disabled={demo.isPending}
              onClick={() =>
                demo.mutate(undefined, {
                  onSuccess: () => toastSuccess("Synthetic demo data added", "Two demo fingerprints are being estimated in the background."),
                  onError: (e) => toastError(e, "Could not add demo data"),
                })
              }
            >
              <FlaskConical aria-hidden="true" />
              {demo.isPending ? "Adding demo data" : "Load demo data"}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate({ onboarding_completed: true }, { onError: (e) => toastError(e, "Could not dismiss the guide") })}
          >
            <X aria-hidden="true" />
            Dismiss
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ quick actions */

const QUICK_ACTIONS: { href: string; icon: LucideIcon; title: string; body: string }[] = [
  { href: "/app/cameras?new=1", icon: Camera, title: "Register a camera", body: "Add a device and enrol its sensors." },
  { href: "/app/investigations?new=1", icon: FolderPlus, title: "New investigation", body: "Group evidence, notes and results." },
  { href: "/app/compare", icon: GitCompareArrows, title: "Compare an image", body: "Test a photograph against enrolled sensors." },
];

function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
      {QUICK_ACTIONS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex items-center gap-3 rounded-lg bg-card p-3.5 ring-1 ring-foreground/10 transition-colors hover:bg-accent/60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand ring-1 ring-brand-border">
            <a.icon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{a.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{a.body}</span>
          </span>
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ panels */

function ActiveJobs({ jobs }: { jobs: Job[] }) {
  const cancel = useCancelJob();
  if (jobs.length === 0) return null;
  return (
    <Panel
      title="Running now"
      icon={Activity}
      flush
      action={<ViewAll href="/app/jobs" label="jobs" />}
    >
      <ul className="divide-y">
        {jobs.map((job) => (
          <li key={job.id} className="px-4 py-2.5">
            <JobProgressView
              job={job}
              compact
              cancelling={cancel.isPending && cancel.variables === job.id}
              onCancel={() => cancel.mutate(job.id, { onError: (e) => toastError(e, "Could not cancel the job") })}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RecentAnalyses({ analyses, sensorsReady, onExpired }: { analyses: Analysis[]; sensorsReady: number; onExpired: () => void }) {
  return (
    <Panel
      title="Recent analyses"
      icon={ScanSearch}
      flush
      action={analyses.length > 0 ? <ViewAll href="/app/compare" label="analyses" /> : null}
    >
      {analyses.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={ScanSearch}
          title="No comparisons yet"
          description={
            sensorsReady > 0
              ? "Test a questioned photograph against your enrolled sensors."
              : "A comparison needs at least one sensor with a fingerprint. Register a camera to begin."
          }
          action={
            sensorsReady > 0 ? (
              <Button asChild>
                <Link href="/app/compare">Compare an image</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/app/cameras?new=1">Register a camera</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y">
          {analyses.map((a) => {
            const name = a.evidence_filename || "Untitled image";
            return (
              <li key={a.id}>
                <Link href={`/app/analyses/${a.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
                  <SignedImage
                    src={a.evidence_preview_url}
                    alt={`Preview of ${name}`}
                    onExpired={onExpired}
                    className="size-10 shrink-0"
                    imgClassName="object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <DemoBadge when={a.is_demo} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {a.top_label ? <>Top-ranked candidate: {a.top_label}</> : pluralize(a.candidate_count ?? 0, "candidate")}
                      <span aria-hidden="true"> · </span>
                      <FormattedDate value={a.completed_at ?? a.created_at} mode="relative" />
                    </span>
                  </span>
                  {a.top_verdict ? (
                    <VerdictBadge verdict={a.top_verdict} size="sm" short className="hidden sm:inline-flex" />
                  ) : (
                    <Badge variant={a.status === "failed" ? "destructive" : "secondary"}>{humanize(a.status)}</Badge>
                  )}
                </Link>
                {a.top_verdict ? (
                  <div className="px-4 pb-3 sm:hidden">
                    <VerdictBadge verdict={a.top_verdict} size="sm" />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RecentInvestigations({ investigations }: { investigations: Investigation[] }) {
  return (
    <Panel
      title="Recent investigations"
      icon={FolderSearch}
      flush
      action={investigations.length > 0 ? <ViewAll href="/app/investigations" label="investigations" /> : null}
    >
      {investigations.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={FolderSearch}
          title="No investigations yet"
          description="An investigation keeps the evidence, comparisons, notes and history for one question together."
          action={
            <Button asChild variant="outline">
              <Link href="/app/investigations?new=1">New investigation</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {investigations.map((inv) => (
            <li key={inv.id}>
              <Link href={`/app/investigations/${inv.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{inv.title}</span>
                    <DemoBadge when={inv.is_demo} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {inv.reference ? <span className="font-mono">{inv.reference}</span> : null}
                    {inv.reference ? <span aria-hidden="true"> · </span> : null}
                    {pluralize(inv.evidence_count ?? 0, "image")}, {pluralize(inv.analysis_count ?? 0, "analysis", "analyses")}
                    <span aria-hidden="true"> · </span>
                    updated <FormattedDate value={inv.updated_at} mode="relative" />
                  </span>
                </span>
                <Badge variant={inv.status === "open" ? "outline" : "secondary"}>{humanize(inv.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const STORAGE_ROWS: { key: keyof StorageBreakdown; label: string }[] = [
  { key: "evidence", label: "Evidence images" },
  { key: "reference_images", label: "Reference images" },
  { key: "fingerprints", label: "Fingerprints" },
  { key: "reports", label: "Reports" },
  { key: "exports", label: "Exports" },
];

function StoragePanel({ storage, quota }: { storage: StorageBreakdown; quota: number }) {
  const used = storage.total ?? 0;
  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const near = percent >= 90;
  return (
    <Panel title="Storage" icon={HardDrive}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-medium tracking-tight">
          <Bytes value={used} />
          {quota > 0 ? <span className="text-sm font-normal text-muted-foreground"> of {formatBytes(quota, 0)}</span> : null}
        </p>
        {quota > 0 ? (
          <span className={cn("font-mono text-xs", near ? "text-danger" : "text-muted-foreground")}>
            {percent < 0.1 && used > 0 ? "<0.1" : formatNumber(percent, 1)}% used
          </span>
        ) : null}
      </div>
      {quota > 0 ? (
        <Progress
          value={percent}
          aria-label={`Storage used: ${formatBytes(used)} of ${formatBytes(quota, 0)}`}
          className={cn("mt-2.5 h-1.5", near && "[&>[data-slot=progress-indicator]]:bg-destructive")}
        />
      ) : null}
      {near ? (
        <p className="mt-2 text-xs text-danger">Storage is almost full. Delete unused items or exports to free space.</p>
      ) : null}
      <dl className="mt-4 flex flex-col gap-1.5 border-t pt-3 text-sm">
        {STORAGE_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-mono text-xs">
              <Bytes value={storage[row.key] ?? 0} />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function ActivityPanel({ entries }: { entries: AuditEntry[] }) {
  return (
    <Panel title="Recent activity" icon={History} flush action={entries.length > 0 ? <ViewAll href="/app/settings" label="activity" /> : null}>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Actions on your account will be listed here.</p>
      ) : (
        <ol className="flex flex-col px-4 py-3">
          {entries.map((entry, i) => {
            const href = auditHref(entry);
            const text = auditText(entry);
            return (
              <li key={entry.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                {i < entries.length - 1 ? <span aria-hidden="true" className="absolute top-3.5 bottom-0 left-[3px] w-px bg-border" /> : null}
                <span aria-hidden="true" className="relative mt-1.5 size-[7px] shrink-0 rounded-full bg-border ring-2 ring-card" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    {href ? (
                      <Link href={href} className="underline-offset-4 hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <FormattedDate value={entry.created_at} mode="relative" />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function DemoNotice() {
  const remove = useDeleteDemo();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-brand-border bg-brand-subtle/60 px-4 py-3">
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>
          <span className="font-medium">Synthetic demo data is loaded.</span>{" "}
          <span className="text-muted-foreground">
            Demo cameras and images are simulated and say nothing about real-world accuracy.
          </span>
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Remove demo data
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove synthetic demo data?"
        description="The demo cameras, their fingerprints, the demo investigation and every analysis and report made from them will be deleted. Your own data is not affected. This cannot be undone."
        confirmLabel="Remove demo data"
        onConfirm={async () => {
          await remove.mutateAsync();
          toastSuccess("Demo data removed");
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- skeleton */

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

/* -------------------------------------------------------------- dashboard */

function DashboardBody({ data, onExpired }: { data: DashboardData; onExpired: () => void }) {
  const { counts } = data;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Cameras"
          icon={Camera}
          href="/app/cameras"
          value={formatNumber(counts.devices)}
          hint={`${pluralize(counts.sensors, "sensor")} enrolled`}
        />
        <MetricCard
          label="Sensors ready"
          icon={ScanSearch}
          href="/app/cameras"
          value={formatNumber(data.sensors_ready)}
          unit={`of ${formatNumber(counts.sensors)}`}
          hint="With an active fingerprint"
        />
        <MetricCard
          label="Investigations"
          icon={FolderSearch}
          href="/app/investigations"
          value={formatNumber(counts.investigations)}
          hint={`${pluralize(counts.evidence, "evidence image")}`}
        />
        <MetricCard
          label="Analyses"
          icon={GitCompareArrows}
          href="/app/compare"
          value={formatNumber(counts.analyses)}
          hint={`${pluralize(counts.reports, "report")} generated`}
        />
      </dl>

      <QuickActions />

      {data.has_demo_data ? <DemoNotice /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ActiveJobs jobs={data.active_jobs} />
          <RecentAnalyses analyses={data.recent_analyses} sensorsReady={data.sensors_ready} onExpired={onExpired} />
          <RecentInvestigations investigations={data.recent_investigations} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <StoragePanel storage={data.storage} quota={data.quota_bytes} />
          <ActivityPanel entries={data.recent_activity} />
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const dashboard = useDashboard();
  const firstName = user?.display_name?.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="Your cameras, investigations and recent results at a glance."
      />
      {dashboard.data && !dashboard.data.onboarding_completed ? (
        <OnboardingBanner hasDemo={dashboard.data.has_demo_data} />
      ) : null}
      {dashboard.isPending ? (
        <DashboardSkeleton />
      ) : dashboard.isError ? (
        <ErrorState
          title="Could not load the dashboard"
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
          retrying={dashboard.isFetching}
        />
      ) : (
        <DashboardBody data={dashboard.data} onExpired={() => void dashboard.refetch()} />
      )}
    </>
  );
}
