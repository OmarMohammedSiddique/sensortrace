"use client";

import { CircleAlert, CircleCheck, CircleDashed, Cpu, ImageOff, Images, LoaderCircle, type LucideIcon } from "lucide-react";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

import { ApiError, errorMessage } from "@/lib/api/errors";
import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isJobActive, useJobs } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { Fingerprint, Job, Sensor } from "@/lib/api/types";
import { PIPELINE_LABELS } from "@/lib/domain";
import { humanize, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ panel */

/** Card with a hairline header, matching the dashboard panels. */
export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className,
  flush = false,
  description,
}: {
  title: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Children manage their own padding (lists with dividers, tables). */
  flush?: boolean;
  description?: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10", className)}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-1.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </header>
      {description ? <p className="border-b bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Label / value row for definition lists inside panels. */
export function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-0.5 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4", className)}>
      <dt className="text-xs text-muted-foreground sm:pt-0.5 sm:text-sm">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------ notices */

const NOTICE = {
  info: { icon: CircleAlert, box: "border-brand-border bg-brand-subtle", iconClass: "text-brand" },
  warning: { icon: CircleAlert, box: "border-warning-border bg-warning-subtle", iconClass: "text-warning" },
  danger: { icon: CircleAlert, box: "border-danger-border bg-danger-subtle", iconClass: "text-danger" },
  success: { icon: CircleCheck, box: "border-success-border bg-success-subtle", iconClass: "text-success" },
} as const;

/** Inline tinted notice with an icon and optional title. Colour is never the only signal. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: keyof typeof NOTICE;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
}) {
  const style = NOTICE[tone];
  const Icon = style.icon;
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-relaxed", style.box, className)}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", style.iconClass)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pipeline */

/** Pipeline class as text with an icon. Unknown values are shown humanised. */
export function PipelineBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const label = (value && PIPELINE_LABELS[value]) || humanize(value) || "Unknown pipeline";
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <Cpu aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}

/** True when a high statistic for this pipeline class needs same-model control devices. */
export function needsControls(pipelineClass: string | null | undefined): boolean {
  return pipelineClass !== "conventional";
}

export const POSITION_OPTIONS = [
  { value: "main", label: "Main (wide)" },
  { value: "ultrawide", label: "Ultrawide" },
  { value: "telephoto", label: "Telephoto" },
  { value: "front", label: "Front" },
  { value: "other", label: "Other" },
] as const;

export function positionLabel(position: string | null | undefined): string {
  return POSITION_OPTIONS.find((p) => p.value === position)?.label ?? (humanize(position) || "Sensor");
}

/* -------------------------------------------------------- sensor status */

export type SensorState = "running" | "ready" | "references" | "empty";

/** Active fingerprint jobs for the account, keyed by fingerprint id. Shares one polled query. */
export function useActiveFingerprintJobs(): Map<string, Job> {
  const jobs = useJobs({ active: true, limit: 100 });
  const map = new Map<string, Job>();
  for (const job of jobs.data?.items ?? []) {
    if (job.target_type === "fingerprint" && job.target_id && isJobActive(job)) map.set(job.target_id, job);
  }
  return map;
}

export function isFingerprintBuilding(fp: Pick<Fingerprint, "status">): boolean {
  return fp.status === "pending" || fp.status === "running";
}

/**
 * Fingerprint versions of a sensor. Same cache entry as `useFingerprints`, but it also polls
 * while a version is being built, so the list settles even if a job-finished event is missed.
 */
export function useFingerprintVersions(sensorId: string | undefined) {
  return useQuery({
    queryKey: qk.sensors.fingerprints(sensorId ?? ""),
    queryFn: () =>
      unwrap<Fingerprint[]>(api.GET("/api/v1/sensors/{sensor_id}/fingerprints", { params: { path: { sensor_id: sensorId! } } })),
    enabled: Boolean(sensorId),
    refetchInterval: (q) => (q.state.data?.some(isFingerprintBuilding) ? 3_000 : false),
  });
}

/** The fingerprint version being built for a sensor (if any) and its background job. */
export function useSensorBuild(sensorId: string): { building: Fingerprint | undefined; job: Job | undefined } {
  const fingerprints = useFingerprintVersions(sensorId);
  const jobs = useActiveFingerprintJobs();
  const building = fingerprints.data?.find(isFingerprintBuilding);
  return { building, job: building ? jobs.get(building.id) : undefined };
}

export function sensorState(sensor: Pick<Sensor, "active_fingerprint" | "reference_count">, building = false): SensorState {
  if (building) return "running";
  if (sensor.active_fingerprint) return "ready";
  return (sensor.reference_count ?? 0) > 0 ? "references" : "empty";
}

const STATE_STYLE: Record<SensorState, { icon: LucideIcon; className: string; spin?: boolean }> = {
  running: { icon: LoaderCircle, className: "text-brand", spin: true },
  ready: { icon: CircleCheck, className: "text-success" },
  references: { icon: Images, className: "text-muted-foreground" },
  empty: { icon: ImageOff, className: "text-muted-foreground" },
};

/** "No references" / "N references" / "Fingerprint vN ready" / "Fingerprint job running". */
export function SensorStatus({
  sensor,
  building = false,
  className,
}: {
  sensor: Pick<Sensor, "active_fingerprint" | "reference_count">;
  building?: boolean;
  className?: string;
}) {
  const state = sensorState(sensor, building);
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  const refs = sensor.reference_count ?? 0;
  const text =
    state === "running"
      ? "Fingerprint job running"
      : state === "ready"
        ? `Fingerprint v${sensor.active_fingerprint?.version} ready`
        : state === "references"
          ? pluralize(refs, "reference")
          : "No references";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", style.className, className)}>
      <Icon aria-hidden="true" className={cn("size-3.5", style.spin && "animate-spin")} />
      {text}
    </span>
  );
}

/** Status of one fingerprint version (pending, running, ready, failed, cancelled). */
export function FingerprintStatus({ status, className }: { status: string; className?: string }) {
  const style =
    status === "ready"
      ? { icon: CircleCheck, className: "text-success", label: "Ready" }
      : status === "running"
        ? { icon: LoaderCircle, className: "text-brand", label: "Estimating", spin: true }
        : status === "pending"
          ? { icon: CircleDashed, className: "text-muted-foreground", label: "Queued" }
          : status === "failed"
            ? { icon: CircleAlert, className: "text-danger", label: "Failed" }
            : { icon: CircleDashed, className: "text-muted-foreground", label: humanize(status) };
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", style.className, className)}>
      <Icon aria-hidden="true" className={cn("size-3.5", "spin" in style && style.spin && "animate-spin")} />
      {style.label}
    </span>
  );
}

/* ---------------------------------------------------------------- forms */

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

/**
 * Map API validation issues onto form fields. Returns the message to show at form level,
 * or null when every issue was attached to a field.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly FieldPath<T>[],
): string | null {
  if (err instanceof ApiError && err.fieldIssues.length > 0) {
    let mapped = 0;
    for (const issue of err.fieldIssues) {
      const name = fields.find((f) => f === issue.field);
      if (name) {
        setError(name, { type: "server", message: issue.message });
        mapped += 1;
      }
    }
    if (mapped === err.fieldIssues.length) return null;
  }
  return errorMessage(err);
}

/** Lower-cased "make|model" key for same-model comparisons; null when either part is missing. */
export function modelKey(make: string | null | undefined, model: string | null | undefined): string | null {
  const a = make?.trim().toLowerCase();
  const b = model?.trim().toLowerCase();
  return a && b ? `${a}|${b}` : null;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.isNotFound;
}

/** Starts a browser download of a same-origin signed file URL (served as an attachment). */
export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
