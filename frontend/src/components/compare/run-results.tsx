"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { JobProgress } from "@/components/st/job-progress";
import { PolicyNotice } from "@/components/st/policy-notice";
import { VerdictBadge } from "@/components/st/verdict-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/lib/api/hooks";
import { needsSameModelControl } from "@/lib/domain";

export interface StartedRun {
  analysisId: string;
  jobId: string | null;
  filename: string;
}

function RunRow({ run }: { run: StartedRun }) {
  const query = useAnalysis(run.analysisId);
  const analysis = query.data;
  const top = analysis?.candidates?.[0];
  const finished = analysis && analysis.status !== "pending" && analysis.status !== "running";

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 truncate text-sm font-medium">{run.filename}</p>
        <Button asChild variant={finished ? "outline" : "ghost"} size="sm">
          <Link href={`/app/analyses/${run.analysisId}`}>
            {finished ? "Open full result" : "Open"}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {analysis?.status === "completed" ? (
        <div className="mt-2 animate-fade-in">
          {top ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <VerdictBadge verdict={top.verdict} wrap />
                <span className="text-sm text-muted-foreground">
                  for the top-ranked candidate, {top.snapshot.device_name} / {top.snapshot.sensor_name}
                </span>
              </div>
              {analysis.summary?.text ? <p className="mt-2 text-sm leading-relaxed">{analysis.summary.text}</p> : null}
              {needsSameModelControl(top.decision.nua) ? (
                <p className="mt-2 text-sm leading-relaxed text-warning">
                  The statistic is high, but it cannot be attributed to this individual sensor without a same-model control. Enrol a second device of
                  the same make and model and compare again.
                </p>
              ) : null}
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">Reasons and limitations</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 leading-relaxed">
                  {(top.decision.reasons ?? []).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed text-muted-foreground">
                  {(top.decision.caveats ?? []).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
              <PolicyNotice policy={top.decision.policy ?? analysis.policy} variant="compact" className="mt-2" />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">The comparison finished without any candidate result.</p>
          )}
        </div>
      ) : run.jobId ? (
        <div className="mt-2">
          <JobProgress jobId={run.jobId} compact title="Comparison" />
        </div>
      ) : analysis ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {analysis.error ?? `The comparison is ${analysis.status}.`}
        </p>
      ) : (
        <Skeleton className="mt-2 h-5 w-48" />
      )}
    </li>
  );
}

/** One row per questioned image of the run just started: live progress, then the outcome. */
export function RunResults({ runs }: { runs: StartedRun[] }) {
  return (
    <ul className="divide-y" aria-live="polite">
      {runs.map((run) => (
        <RunRow key={run.analysisId} run={run} />
      ))}
    </ul>
  );
}
