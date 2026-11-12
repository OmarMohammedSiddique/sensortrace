"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { JobProgressView } from "@/components/st/job-progress";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { invalidateAfterJob, useCancelJob, useJobs } from "@/lib/api/hooks";
import type { Job } from "@/lib/api/types";
import { pluralize } from "@/lib/format";
import { toastError } from "@/lib/toast";

const ACTIVE_PARAMS = { active: true, limit: 20 } as const;

/**
 * Global indicator of running background jobs. Polls the active-jobs list and, whenever
 * a job leaves it (finished, failed or cancelled), invalidates the queries that job may
 * have changed, so every page stays current without its own polling.
 */
export function JobsIndicator() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useJobs(ACTIVE_PARAMS);
  const cancel = useCancelJob();
  const jobs = data?.items ?? [];
  const count = data?.total ?? 0;

  const previous = useRef<Map<string, Job>>(new Map());
  useEffect(() => {
    if (!data) return;
    const current = new Map(data.items.map((j) => [j.id, j]));
    for (const [id, job] of previous.current) {
      if (!current.has(id)) invalidateAfterJob(queryClient, job);
    }
    previous.current = current;
  }, [data, queryClient]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={count > 0 ? "default" : "icon"}
          aria-label={count > 0 ? `${pluralize(count, "active job")}. Show progress` : "No active jobs. Show jobs"}
          className="relative gap-1.5"
        >
          <Activity aria-hidden="true" className={count > 0 ? "text-brand" : undefined} />
          {count > 0 ? (
            <>
              <span className="font-mono text-xs">{count}</span>
              <span aria-hidden="true" className="absolute top-1 right-1 flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h2 className="text-sm font-medium">Background jobs</h2>
          <span className="text-xs text-muted-foreground">{count > 0 ? `${count} active` : "Idle"}</span>
        </div>
        {jobs.length > 0 ? (
          <ul className="max-h-80 divide-y overflow-y-auto px-3">
            {jobs.map((job) => (
              <li key={job.id} className="py-2">
                <JobProgressView
                  job={job}
                  compact
                  cancelling={cancel.isPending && cancel.variables === job.id}
                  onCancel={() => cancel.mutate(job.id, { onError: (e) => toastError(e, "Could not cancel the job") })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing is running. Fingerprint estimation, comparisons and exports appear here while they work.
          </p>
        )}
        <div className="border-t p-1.5">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center" onClick={() => setOpen(false)}>
            <Link href="/app/jobs">View all jobs</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
