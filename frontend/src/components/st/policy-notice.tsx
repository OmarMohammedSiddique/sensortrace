import { Scale, ShieldCheck } from "lucide-react";

import type { PolicySnapshot } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PolicyNoticeProps {
  /** `analysis.policy`, `candidate.decision.policy`, or an item from GET /policies. */
  policy: PolicySnapshot | null | undefined;
  /** `full` (default) shows thresholds and the policy basis; `compact` is a single line. */
  variant?: "full" | "compact";
  className?: string;
}

/**
 * States whether the decision policy is calibrated. An uncalibrated policy means the
 * thresholds are reference lines and no error rate is available: this must be visible
 * wherever a verdict is shown.
 */
export function PolicyNotice({ policy, variant = "full", className }: PolicyNoticeProps) {
  if (!policy) return null;
  const calibrated = policy.calibrated === true;
  const Icon = calibrated ? ShieldCheck : Scale;
  const headline = calibrated ? "Calibrated policy" : "Uncalibrated policy: reference lines, no error rate available";

  if (variant === "compact") {
    return (
      <p
        className={cn(
          "inline-flex items-start gap-1.5 text-xs leading-relaxed",
          calibrated ? "text-muted-foreground" : "text-warning",
          className,
        )}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>{headline}</span>
      </p>
    );
  }

  return (
    <section
      aria-label="Decision policy"
      className={cn(
        "rounded-lg border px-4 py-3.5 text-sm",
        calibrated ? "border-border bg-muted/40" : "border-warning-border bg-warning-subtle",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", calibrated ? "text-muted-foreground" : "text-warning")} />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{headline}</h3>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {calibrated
              ? "The thresholds below were calibrated on measured data for the stated conditions. The error rates in the calibration apply only within those conditions."
              : "The thresholds below are conventions from the research literature, not measurements for this camera model. They indicate where a statistic sits relative to published reference values; they do not give a false-match or missed-match rate."}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <PolicyValue label="Match line" value={policy.match_threshold} prefix="PCE ≥ " />
            <PolicyValue label="Non-match line" value={policy.non_match_threshold} prefix="PCE ≤ " />
            <PolicyValue label="Min. valid pixels" value={policy.min_valid_pixels} />
            <div className="min-w-0">
              <dt className="eyebrow">Policy</dt>
              <dd className="mt-0.5 truncate font-mono text-xs" title={policy.policy_id}>
                {policy.policy_id ?? "-"}
                {policy.version ? <span className="text-muted-foreground"> ({policy.version})</span> : null}
              </dd>
            </div>
          </dl>
          {policy.basis ? (
            <details className="group mt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                Basis for these thresholds
              </summary>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{policy.basis}</p>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PolicyValue({ label, value, prefix = "" }: { label: string; value: number | undefined; prefix?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs">
        {value === undefined || value === null ? "-" : `${prefix}${formatNumber(value, 2)}`}
      </dd>
    </div>
  );
}
