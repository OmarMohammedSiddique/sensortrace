import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StatProps {
  label: string;
  /** Already-formatted value. Use `formatNumber`, `formatPce`, `<Bytes>` etc. */
  value: React.ReactNode;
  /** Unit or qualifier rendered small after the value ("images", "of 5 GB"). */
  unit?: React.ReactNode;
  /** Supporting line below the value. */
  hint?: React.ReactNode;
  /** Render the value in Geist Mono (statistics, ids). */
  mono?: boolean;
  loading?: boolean;
  className?: string;
}

/** Label-over-value pair with no chrome, for definition grids inside cards. */
export function Stat({ label, value, unit, hint, mono, loading, className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1">
        {loading ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className={cn("truncate text-lg font-medium tracking-tight", mono && "font-mono text-base")}>
              {value}
            </span>
            {unit ? <span className="shrink-0 text-xs text-muted-foreground">{unit}</span> : null}
          </span>
        )}
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

export interface MetricCardProps extends StatProps {
  icon?: LucideIcon;
  /** Makes the whole card a link. */
  href?: string;
}

/**
 * Bordered metric tile for dashboard rows. Wrap a group of them in a `<dl>`.
 * With `href` the label is the link and its hit area is stretched over the whole tile, so the
 * `<dt>`/`<dd>` pair stays a valid direct child group of the list (a wrapping `<a>` is not).
 */
export function MetricCard({ label, value, unit, hint, mono, loading, icon: Icon, href, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "relative block rounded-lg bg-card p-4 ring-1 ring-foreground/10",
        href && "transition-colors hover:bg-accent/60 has-focus-visible:outline-2",
        className,
      )}
    >
      <dt className="eyebrow flex items-center justify-between gap-2">
        {href ? (
          <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-lg">
            {label}
          </Link>
        ) : (
          label
        )}
        {Icon ? <Icon aria-hidden="true" className="size-3.5 text-muted-foreground/70" /> : null}
      </dt>
      <dd className="mt-2">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className={cn("text-2xl leading-8 font-medium tracking-tight", mono && "font-mono")}>{value}</span>
            {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
          </span>
        )}
        {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
