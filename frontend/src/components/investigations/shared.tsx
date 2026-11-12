import { Archive, CircleDot, Lock, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { InvestigationStatus } from "@/lib/api/types";
import { humanize } from "@/lib/format";

export const INVESTIGATION_STATUSES: InvestigationStatus[] = ["open", "closed", "archived"];

export const STATUS_META: Record<InvestigationStatus, { label: string; icon: LucideIcon; hint: string }> = {
  open: { label: "Open", icon: CircleDot, hint: "Work in progress." },
  closed: { label: "Closed", icon: Lock, hint: "Work finished. Everything is kept and can still be viewed." },
  archived: { label: "Archived", icon: Archive, hint: "Kept for the record and hidden from day-to-day lists." },
};

export function isInvestigationStatus(value: string | null | undefined): value is InvestigationStatus {
  return value === "open" || value === "closed" || value === "archived";
}

/** Investigation status with an icon and a text label (never colour alone). */
export function InvestigationStatusBadge({ status }: { status: string }) {
  const meta = isInvestigationStatus(status) ? STATUS_META[status] : null;
  const Icon = meta?.icon;
  return (
    <Badge variant={status === "open" ? "outline" : "secondary"}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {meta?.label ?? humanize(status)}
    </Badge>
  );
}

/** Whole days from now until an ISO date (negative when it is in the past). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export const RETENTION_EXPLANATION =
  "On the retention date the investigation and everything in it (evidence files, comparisons, notes and reports) are permanently deleted. Leave it empty to keep the investigation until you delete it yourself.";
