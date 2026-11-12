import { Ban, CircleCheck, CircleHelp, CircleX, type LucideIcon } from "lucide-react";

import type { Verdict } from "@/lib/api/types";
import { isVerdict, VERDICT_LABELS, VERDICT_SHORT_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface VerdictStyle {
  icon: LucideIcon;
  /** Tinted pill: text + subtle background + hairline border. */
  badge: string;
  /** Text colour only. */
  text: string;
  /** Solid swatch (legends, bars). */
  swatch: string;
}

/** Visual treatment for each verdict. Colour is never used without the icon and label. */
export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  match_supported: {
    icon: CircleCheck,
    badge: "text-match bg-match-subtle border-match-border",
    text: "text-match",
    swatch: "bg-match",
  },
  non_match_supported: {
    icon: CircleX,
    badge: "text-nonmatch bg-nonmatch-subtle border-nonmatch-border",
    text: "text-nonmatch",
    swatch: "bg-nonmatch",
  },
  inconclusive: {
    icon: CircleHelp,
    badge: "text-inconclusive bg-inconclusive-subtle border-inconclusive-border",
    text: "text-inconclusive",
    swatch: "bg-inconclusive",
  },
  insufficient_or_unsupported: {
    icon: Ban,
    badge: "text-unsuitable bg-unsuitable-subtle border-unsuitable-border",
    text: "text-unsuitable",
    swatch: "bg-unsuitable",
  },
};

export interface VerdictBadgeProps {
  /** API verdict code. Unknown or missing values render a neutral "No result" badge. */
  verdict: Verdict | string | null | undefined;
  /** `sm` for tables and lists, `md` (default) elsewhere, `lg` for the result headline. */
  size?: "sm" | "md" | "lg";
  /** Use the shorter label ("Supports match"). The full label stays available as a title. */
  short?: boolean;
  /** Let the full label wrap onto several lines instead of truncating (narrow columns). */
  wrap?: boolean;
  className?: string;
}

const SIZES = {
  sm: "h-5 gap-1 px-1.5 text-[0.6875rem] [&>svg]:size-3",
  md: "h-6 gap-1.5 px-2 text-xs [&>svg]:size-3.5",
  lg: "h-8 gap-2 px-3 text-sm [&>svg]:size-4",
} as const;

/** Icon + mandated label + colour for one of the four verdicts. */
export function VerdictBadge({ verdict, size = "md", short = false, wrap = false, className }: VerdictBadgeProps) {
  const base = "inline-flex w-fit max-w-full shrink-0 items-center rounded-md border font-medium whitespace-nowrap";
  if (!isVerdict(verdict)) {
    return (
      <span className={cn(base, SIZES[size], "border-border bg-muted text-muted-foreground", className)}>
        No result
      </span>
    );
  }
  const style = VERDICT_STYLES[verdict];
  const Icon = style.icon;
  const full = VERDICT_LABELS[verdict];
  return (
    <span
      data-verdict={verdict}
      title={short ? full : undefined}
      className={cn(base, SIZES[size], style.badge, wrap && "h-auto items-start py-1 text-left whitespace-normal [&>svg]:mt-px", className)}
    >
      <Icon aria-hidden="true" className="shrink-0" />
      <span className={wrap ? undefined : "truncate"}>{short ? VERDICT_SHORT_LABELS[verdict] : full}</span>
      {short ? <span className="sr-only"> ({full})</span> : null}
    </span>
  );
}
