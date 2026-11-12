import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PanelProps {
  title: React.ReactNode;
  icon?: LucideIcon;
  /** Right side of the header: a button, a count, a badge. */
  action?: React.ReactNode;
  /** Supporting line under the header. */
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Children manage their own padding (tables, divided lists). */
  flush?: boolean;
  /** Heading level for the title; pages have one h1, panels are h2 by default. */
  as?: "h2" | "h3";
  id?: string;
}

/** Card with a hairline header, matching the dashboard panels. Do not nest. */
export function Panel({ title, icon: Icon, action, description, children, className, flush = false, as: Heading = "h2", id }: PanelProps) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10", className)}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-1.5">
        <Heading className="flex items-center gap-2 text-sm font-medium">
          {Icon ? <Icon aria-hidden="true" className="size-4 text-muted-foreground" /> : null}
          {title}
        </Heading>
        {action}
      </header>
      {description ? <p className="border-b bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Label / value row for definition lists inside panels and sheets. */
export function Field({ label, children, className, mono }: { label: React.ReactNode; children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[minmax(7rem,38%)_1fr] items-baseline gap-x-4 gap-y-0.5 py-2 text-sm", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-[0.8125rem]")}>{children}</dd>
    </div>
  );
}
