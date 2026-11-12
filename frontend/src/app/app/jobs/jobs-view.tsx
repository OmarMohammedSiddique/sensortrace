"use client";

import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, DataTablePagination, usePagination, type Column } from "@/components/st/data-table";
import { FormattedDate } from "@/components/st/formatted";
import { JobStatusBadge } from "@/components/st/job-progress";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api/errors";
import { isJobActive, useCancelJob, useFingerprint, useJobs } from "@/lib/api/hooks";
import type { Job } from "@/lib/api/types";
import { jobKindLabel, jobStageLabel } from "@/lib/domain";
import { formatDuration } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Filter = "active" | "all";

/** A fingerprint job only knows its fingerprint id; the sensor comes from the fingerprint. */
function FingerprintTarget({ fingerprintId }: { fingerprintId: string }) {
  const fp = useFingerprint(fingerprintId);
  if (fp.isPending) return <span className="text-xs text-muted-foreground">Finding sensor</span>;
  if (fp.isError) {
    return (
      <span className="text-xs text-muted-foreground">
        {fp.error instanceof ApiError && fp.error.isNotFound ? "Fingerprint since deleted" : "Sensor unavailable"}
      </span>
    );
  }
  return (
    <Link href={`/app/sensors/${fp.data.sensor_id}?tab=fingerprint`} className="inline-flex items-center gap-1 text-xs text-brand underline-offset-4 hover:underline">
      Sensor fingerprint v{fp.data.version}
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </Link>
  );
}

function Target({ job }: { job: Job }) {
  if (!job.target_id) return null;
  if (job.target_type === "fingerprint") return <FingerprintTarget fingerprintId={job.target_id} />;
  const href =
    job.target_type === "analysis" ? `/app/analyses/${job.target_id}` : job.target_type === "export" ? "/app/settings?tab=data" : null;
  if (!href) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-brand underline-offset-4 hover:underline">
      {job.target_type === "analysis" ? "Open analysis" : "Data exports"}
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </Link>
  );
}

export function JobsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const pagination = usePagination(25);
  const jobs = useJobs({ ...pagination.params, ...(filter === "active" ? { active: true } : {}) });
  const cancel = useCancelJob();
  const anyActive = jobs.data?.items.some(isJobActive) ?? false;

  const columns: Column<Job>[] = [
    {
      id: "kind",
      header: "Job",
      skeleton: "w-36",
      cell: (job) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{jobKindLabel(job.kind)}</span>
          <Target job={job} />
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (job) => <JobStatusBadge status={job.status} /> },
    {
      id: "progress",
      header: "Stage and progress",
      className: "min-w-44",
      skeleton: "w-32",
      cell: (job) => {
        const active = isJobActive(job);
        const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
        return (
          <div className="flex flex-col gap-1.5">
            {active ? (
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate">
                  {jobStageLabel(job)}
                  {job.message ? <span className="text-muted-foreground"> - {job.message}</span> : null}
                </span>
                {job.status === "running" ? <span className="font-mono text-muted-foreground">{percent}%</span> : null}
              </span>
            ) : job.error ? null : (
              <span className="text-xs text-muted-foreground">{job.status === "succeeded" ? "All stages finished" : "-"}</span>
            )}
            {active ? <Progress value={job.status === "queued" ? 0 : percent} aria-label={`${jobKindLabel(job.kind)} progress`} className="h-1" /> : null}
            {job.error ? (
              <span role="note" className={cn("max-w-xs text-xs break-words whitespace-normal", job.status === "failed" ? "text-danger" : "text-muted-foreground")}>
                {job.error}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "times",
      header: "Created",
      className: "hidden md:table-cell",
      cell: (job) => (
        <div className="flex flex-col gap-0.5 text-xs">
          <FormattedDate value={job.created_at} />
          <span className="text-muted-foreground">
            {job.started_at ? (
              <>
                Started <FormattedDate value={job.started_at} mode="relative" />
              </>
            ) : (
              "Not started"
            )}
          </span>
        </div>
      ),
    },
    {
      id: "finished",
      header: "Finished",
      className: "hidden lg:table-cell",
      cell: (job) =>
        job.finished_at ? (
          <div className="flex flex-col gap-0.5 text-xs">
            <FormattedDate value={job.finished_at} />
            {job.started_at ? <span className="text-muted-foreground">Ran for {formatDuration(job.started_at, job.finished_at)}</span> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "attempts",
      header: "Attempts",
      align: "right",
      className: "hidden sm:table-cell",
      cell: (job) => <span className="font-mono text-xs">{job.attempts}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (job) =>
        isJobActive(job) ? (
          <Button
            variant="outline"
            size="xs"
            disabled={job.cancel_requested || (cancel.isPending && cancel.variables === job.id)}
            onClick={() =>
              cancel.mutate(job.id, {
                onSuccess: (updated) => toastSuccess(updated.status === "cancelled" ? "Job cancelled" : "Cancellation requested", updated.status === "cancelled" ? undefined : "It stops at the next safe point."),
                onError: (e) => toastError(e, "Could not cancel the job"),
              })
            }
          >
            {job.cancel_requested ? "Cancelling" : "Cancel"}
            <span className="sr-only"> {jobKindLabel(job.kind)}</span>
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Fingerprint estimation, comparisons and data exports run in the background. This list refreshes automatically while anything is running."
        actions={
          <Tabs
            value={filter}
            onValueChange={(v) => {
              setFilter(v as Filter);
              pagination.reset();
            }}
          >
            <TabsList aria-label="Filter jobs">
              <TabsTrigger value="all" className="px-3">
                All
              </TabsTrigger>
              <TabsTrigger value="active" className="px-3">
                Active
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <p className="sr-only" aria-live="polite">
        {anyActive ? "Jobs are running." : "No jobs are running."}
      </p>
      <DataTable
        caption={filter === "active" ? "Active background jobs" : "Background jobs"}
        columns={columns}
        rows={jobs.data?.items}
        rowKey={(job) => job.id}
        loading={jobs.isPending}
        error={jobs.isError && !jobs.data ? <ErrorState title="Could not load jobs" error={jobs.error} onRetry={() => void jobs.refetch()} retrying={jobs.isFetching} /> : null}
        empty={
          filter === "active" ? (
            <EmptyState
              icon={Activity}
              title="Nothing is running"
              description="Jobs appear here while a fingerprint is being estimated, a comparison is running or an export is being prepared."
              action={
                <Button variant="outline" onClick={() => setFilter("all")}>
                  Show all jobs
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Activity}
              title="No jobs yet"
              description="Background work starts when you create a fingerprint, compare an image or export your data."
              action={
                <Button asChild>
                  <Link href="/app/cameras">Go to cameras</Link>
                </Button>
              }
            />
          )
        }
      />
      <DataTablePagination pagination={pagination} total={jobs.data?.total} label="jobs" />
    </>
  );
}
