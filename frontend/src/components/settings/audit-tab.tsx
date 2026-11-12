"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, DataTablePagination, usePagination, type Column } from "@/components/st/data-table";
import { FormattedDate } from "@/components/st/formatted";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAudit } from "@/lib/api/hooks";
import type { AuditEntry } from "@/lib/api/types";
import { auditHref, auditText } from "@/lib/domain";
import { humanize } from "@/lib/format";

/** Action prefixes accepted by the API's `action` filter. */
const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "auth.", label: "Sign-ins and sessions" },
  { value: "account.", label: "Account changes" },
  { value: "token.", label: "API tokens" },
  { value: "device.", label: "Cameras" },
  { value: "sensor.", label: "Sensors" },
  { value: "reference.", label: "Reference images" },
  { value: "fingerprint.", label: "Fingerprints" },
  { value: "investigation.", label: "Investigations" },
  { value: "evidence.", label: "Evidence" },
  { value: "analysis.", label: "Comparisons" },
  { value: "report.", label: "Reports" },
  { value: "export.", label: "Data exports" },
  { value: "job.", label: "Background jobs" },
  { value: "demo.", label: "Demo data" },
];

const ENTITY_LABELS: Record<string, string> = {
  user: "Account",
  session: "Session",
  api_token: "API token",
  device: "Camera",
  sensor: "Sensor",
  reference: "Reference image",
  reference_image: "Reference image",
  fingerprint: "Fingerprint",
  investigation: "Investigation",
  evidence: "Evidence image",
  analysis: "Analysis",
  report: "Report",
  export: "Export",
  job: "Job",
  note: "Note",
};

export function AuditTab() {
  const [filter, setFilter] = useState("all");
  const pagination = usePagination(25);
  const audit = useAudit({ ...pagination.params, ...(filter === "all" ? {} : { action: filter }) });

  const columns: Column<AuditEntry>[] = [
    {
      id: "time",
      header: "Time",
      skeleton: "w-32",
      className: "align-top",
      cell: (e) => <FormattedDate value={e.created_at} className="text-xs whitespace-nowrap text-muted-foreground" />,
    },
    {
      id: "action",
      header: "What happened",
      skeleton: "w-56",
      className: "whitespace-normal",
      cell: (e) => {
        const href = auditHref(e);
        const text = auditText(e);
        return (
          <div className="min-w-40">
            {href ? (
              <Link href={href} className="font-medium underline-offset-4 hover:underline">
                {text}
              </Link>
            ) : (
              <span className="font-medium">{text}</span>
            )}
            <span className="mt-0.5 block font-mono text-[0.6875rem] text-muted-foreground">{e.action}</span>
          </div>
        );
      },
    },
    {
      id: "item",
      header: "Item",
      className: "hidden sm:table-cell",
      cell: (e) =>
        e.entity_type ? (
          <div className="text-xs">
            <span>{ENTITY_LABELS[e.entity_type] ?? humanize(e.entity_type)}</span>
            {e.entity_id ? (
              <span className="block font-mono text-[0.6875rem] text-muted-foreground" title={e.entity_id}>
                {e.entity_id.slice(0, 8)}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "ip",
      header: "Source address",
      className: "hidden md:table-cell",
      cell: (e) =>
        e.ip ? <span className="font-mono text-xs">{e.ip}</span> : <span className="text-xs text-muted-foreground">Not recorded</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A record of actions taken on your account, newest first. It is written by the server and cannot be edited.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-filter" className="text-xs text-muted-foreground">
            Show
          </Label>
          <Select
            value={filter}
            onValueChange={(v) => {
              setFilter(v);
              pagination.reset();
            }}
          >
            <SelectTrigger id="audit-filter" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <DataTable
          caption="Account activity log"
          columns={columns}
          rows={audit.data?.items}
          rowKey={(e) => String(e.id)}
          loading={audit.isPending}
          fetching={audit.isPlaceholderData}
          skeletonRows={8}
          error={audit.isError && !audit.data ? <ErrorState title="Could not load the activity log" error={audit.error} onRetry={() => void audit.refetch()} retrying={audit.isFetching} /> : null}
          empty={
            <EmptyState
              icon={History}
              title={filter === "all" ? "No activity recorded yet" : "No activity of this kind"}
              description={filter === "all" ? "Actions on your account will be listed here." : "Nothing in the log matches this filter."}
              action={
                filter === "all" ? undefined : (
                  <Button variant="outline" onClick={() => setFilter("all")}>
                    Show all activity
                  </Button>
                )
              }
            />
          }
        />
        <DataTablePagination pagination={pagination} total={audit.data?.total} label="entries" />
      </div>
    </div>
  );
}
