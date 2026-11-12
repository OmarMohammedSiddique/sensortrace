import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import type { QualityFlag, QualityReport, QualitySeverity } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const SEVERITY: Record<QualitySeverity, { icon: LucideIcon; label: string; text: string; row: string }> = {
  severe: {
    icon: OctagonAlert,
    label: "Severe",
    text: "text-danger",
    row: "border-danger-border bg-danger-subtle",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    text: "text-warning",
    row: "border-warning-border bg-warning-subtle",
  },
  info: { icon: Info, label: "Note", text: "text-muted-foreground", row: "border-border bg-muted/50" },
};
const ORDER: QualitySeverity[] = ["severe", "warning", "info"];

function severityOf(flag: QualityFlag) {
  return SEVERITY[flag.severity] ?? SEVERITY.info;
}

export interface QualityFlagsProps {
  /** A `quality` object from evidence, reference images or analyses (or just its flags). */
  quality: QualityReport | QualityFlag[] | null | undefined;
  /** `list` (default): one row per flag. `summary`: a single compact count badge. */
  variant?: "list" | "summary";
  /** Hide `info` flags (list variant). */
  hideInfo?: boolean;
  /** Text when there are no flags. Pass `null` to render nothing. */
  emptyText?: string | null;
  className?: string;
}

/** Image-quality flags from the API, most severe first, each with icon, severity and message. */
export function QualityFlags({
  quality,
  variant = "list",
  hideInfo = false,
  emptyText = "No quality issues flagged.",
  className,
}: QualityFlagsProps) {
  const all = (Array.isArray(quality) ? quality : (quality?.flags ?? [])).toSorted(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );
  const flags = hideInfo ? all.filter((f) => f.severity !== "info") : all;

  if (variant === "summary") {
    const worst = all[0];
    if (!worst) {
      return emptyText === null ? null : (
        <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
          <CircleCheck aria-hidden="true" className="size-3.5" />
          No flags
        </span>
      );
    }
    const s = severityOf(worst);
    const Icon = s.icon;
    const counts = ORDER.map((sev) => [sev, all.filter((f) => f.severity === sev).length] as const).filter(([, n]) => n > 0);
    return (
      <span
        title={all.map((f) => `${severityOf(f).label}: ${f.message}`).join("\n")}
        className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", s.text, className)}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {counts.map(([sev, n]) => `${n} ${SEVERITY[sev].label.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ")}
      </span>
    );
  }

  if (flags.length === 0) {
    return emptyText === null ? null : (
      <p className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
        <CircleCheck aria-hidden="true" className="size-4" />
        {emptyText}
      </p>
    );
  }
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {flags.map((flag) => {
        const s = severityOf(flag);
        const Icon = s.icon;
        return (
          <li key={`${flag.code}-${flag.message}`} className={cn("flex gap-2 rounded-md border px-2.5 py-2 text-sm", s.row)}>
            <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", s.text)} />
            <p className="min-w-0 leading-relaxed">
              <span className={cn("font-medium", s.text)}>{s.label}: </span>
              {flag.message}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
