"use client";

import { History } from "lucide-react";
import Link from "next/link";

import { DataTablePagination, usePagination } from "@/components/st/data-table";
import { FormattedDate } from "@/components/st/formatted";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvestigationHistory } from "@/lib/api/hooks";
import type { AuditEntry } from "@/lib/api/types";
import { auditHref, auditText, CATEGORY_LABELS, isVerdict, VERDICT_SHORT_LABELS } from "@/lib/domain";
import { formatBytes, formatNumber, humanize, pluralize, truncateMiddle } from "@/lib/format";

/** Second line for a history entry: the recorded facts, in words. Only uses fields the API sent. */
function detailText(entry: AuditEntry): string | null {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.sha256 === "string") parts.push(`SHA-256 ${truncateMiddle(d.sha256, 10, 8)}`);
  if (typeof d.size_bytes === "number") parts.push(formatBytes(d.size_bytes));
  if (typeof d.candidates === "number") parts.push(`${pluralize(d.candidates, "candidate sensor")}`);
  if (typeof d.policy_id === "string") parts.push(`policy ${d.policy_id}`);
  if (d.verdicts && typeof d.verdicts === "object") {
    for (const [verdict, count] of Object.entries(d.verdicts as Record<string, unknown>)) {
      if (typeof count === "number" && count > 0) parts.push(`${formatNumber(count)} × ${isVerdict(verdict) ? VERDICT_SHORT_LABELS[verdict].toLowerCase() : humanize(verdict).toLowerCase()}`);
    }
  }
  if (Array.isArray(d.fields) && d.fields.length > 0) {
    parts.push(`changed: ${d.fields.map((f) => humanize(String(f)).toLowerCase()).join(", ")}`);
  }
  if (typeof d.category === "string") parts.push(CATEGORY_LABELS[d.category] ?? humanize(d.category));
  if (typeof d.status === "string") parts.push(`status ${humanize(d.status).toLowerCase()}`);
  if (typeof d.scope === "string") parts.push(`${humanize(d.scope).toLowerCase()} export`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function HistoryTab({ investigationId }: { investigationId: string }) {
  const pagination = usePagination(50);
  const query = useInvestigationHistory(investigationId, pagination.params);
  const items = query.data?.items;

  if (query.isError) return <ErrorState error={query.error} title="Could not load the history" onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  if (!items) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading history">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full max-w-xl" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <EmptyState icon={History} title="No recorded activity" description="Uploads, comparisons, notes, reports and changes to this investigation are recorded here as they happen." />;
  }

  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="sr-only">
        Processing history
      </h2>
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
        A record of what was done in this investigation and when, newest first. Entries are written by the server at the time of each action and
        cannot be edited.
      </p>
      <ol className={query.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {items.map((entry, i) => {
          const href = auditHref(entry);
          const detail = detailText(entry);
          return (
            <li key={entry.id} className="relative flex gap-4 pb-5 last:pb-0">
              {i < items.length - 1 ? <span aria-hidden="true" className="absolute top-3 bottom-0 left-[4.5px] w-px bg-border" /> : null}
              <span aria-hidden="true" className="relative mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-brand bg-background" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">
                  {href && href !== `/app/investigations/${investigationId}` ? (
                    <Link href={href} className="underline-offset-4 hover:underline">
                      {auditText(entry)}
                    </Link>
                  ) : (
                    auditText(entry)
                  )}
                </p>
                {detail ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{detail}</p> : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <FormattedDate value={entry.created_at} />
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <DataTablePagination pagination={pagination} total={query.data?.total} label="entries" className="mt-5" />
    </section>
  );
}
