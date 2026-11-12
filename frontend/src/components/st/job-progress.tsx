"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, CircleDashed, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { invalidateAfterJob, isJobActive, isJobTerminal, useCancelJob, useJob } from "@/lib/api/hooks";
import type { Job } from "@/lib/api/types";
import { JOB_STATUS_LABELS, jobKindLabel, jobStageLabel } from "@/lib/domain";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, { icon: LucideIcon; className: string; spin?: boolean }> = {
  queued: { icon: CircleDashed, className: "text-muted-foreground" },
  running: { icon: LoaderCircle, className: "text-brand", spin: true },
  succeeded: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleX, className: "text-danger" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
};

/** Icon + label for a job status. Usable on its own in tables. */
export function JobStatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.queued;
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", style.className, className)}>
      <Icon aria-hidden="true" className={cn("size-3.5", style.spin && "animate-spin")} />
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export interface JobProgressViewProps {
  job: Job;
  /** Heading; defaults to the job kind ("Fingerprint estimation"). */
  title?: React.ReactNode;
  /** One-line layout for lists and popovers. */
  compact?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
  className?: string;
}

/** Presentational job row: give it a `Job` you already have (e.g. from a list). */
export function JobProgressView({ job, title, compact = false, onCancel, cancelling, className }: JobProgressViewProps) {
  const active = isJobActive(job);
  const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  const stage = jobStageLabel(job);
  const heading = title ?? jobKindLabel(job.kind);
  const cancelButton =
    active && onCancel ? (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onCancel}
        disabled={cancelling || job.cancel_requested}
        className="text-muted-foreground"
      >
        {job.cancel_requested ? "Cancelling" : "Cancel"}
        <span className="sr-only"> {typeof heading === "string" ? heading : "job"}</span>
      </Button>
    ) : null;

  return (
    <div className={cn("min-w-0", compact ? "py-1" : "rounded-lg bg-card p-4 ring-1 ring-foreground/10", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{heading}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {active ? (
              <>
                {stage}
                {job.message ? <span> - {job.message}</span> : null}
              </>
            ) : job.status === "failed" ? (
              "The job did not complete."
            ) : job.status === "cancelled" ? (
              "Cancelled before completion."
            ) : (
              "Finished."
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active && job.status === "running" ? (
            <span className="font-mono text-xs text-muted-foreground">{percent}%</span>
          ) : (
            <JobStatusBadge status={job.status} />
          )}
          {cancelButton}
        </div>
      </div>
      {active ? (
        <Progress
          value={job.status === "queued" ? 0 : percent}
          aria-label={`${typeof heading === "string" ? heading : "Job"} progress`}
          className={cn("mt-2.5", job.status === "queued" && "animate-pulse")}
        />
      ) : null}
      {job.status === "failed" && job.error ? (
        <p role="alert" className="mt-2 rounded-md border border-danger-border bg-danger-subtle px-2.5 py-1.5 text-xs break-words">
          {job.error}
        </p>
      ) : null}
      {/* Screen readers hear stage changes and the outcome, not every percent tick. */}
      <span aria-live="polite" className="sr-only">
        {active ? `${stage}.` : `${JOB_STATUS_LABELS[job.status] ?? job.status}.`}
      </span>
    </div>
  );
}

export interface JobProgressProps {
  /** Job to follow. Polls GET /jobs/{id} every 1.5 s until it reaches a terminal state. */
  jobId: string;
  title?: React.ReactNode;
  compact?: boolean;
  /** Hide the cancel button. */
  hideCancel?: boolean;
  /**
   * Called exactly once per job id when the job is first seen in a terminal state
   * (`succeeded`, `failed` or `cancelled`), including when it had already finished
   * before this component mounted. Check `job.status` to branch.
   */
  onDone?: (job: Job) => void;
  /** Invalidate the queries the job may have changed when it finishes (default true). */
  invalidate?: boolean;
  className?: string;
}

/** Live progress for one background job, with cancel and terminal states. */
export function JobProgress({ jobId, title, compact, hideCancel, onDone, invalidate = true, className }: JobProgressProps) {
  const queryClient = useQueryClient();
  const { data: job, isError, error, refetch } = useJob(jobId);
  const cancel = useCancelJob();

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!job || !isJobTerminal(job) || notified.current === job.id) return;
    notified.current = job.id;
    if (invalidate) invalidateAfterJob(queryClient, job);
    onDoneRef.current?.(job);
  }, [job, invalidate, queryClient]);

  if (!job) {
    if (isError) {
      return (
        <div role="alert" className={cn("flex items-center justify-between gap-3 text-sm", className)}>
          <span className="text-muted-foreground">Could not read job status: {error.message}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className={cn("flex flex-col gap-2", compact ? "py-1" : "rounded-lg bg-card p-4 ring-1 ring-foreground/10", className)}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-1 w-full" />
      </div>
    );
  }

  return (
    <JobProgressView
      job={job}
      title={title}
      compact={compact}
      className={className}
      cancelling={cancel.isPending}
      onCancel={hideCancel ? undefined : () => cancel.mutate(job.id, { onError: (e) => toastError(e, "Could not cancel the job") })}
    />
  );
}
