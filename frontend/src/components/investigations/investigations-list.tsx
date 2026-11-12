"use client";

import { FolderPlus, FolderSearch, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { type Column, DataTable, DataTablePagination, usePagination } from "@/components/st/data-table";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvestigations } from "@/lib/api/hooks";
import type { Investigation } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";

import { InvestigationFormDialog } from "./investigation-form-dialog";
import { daysUntil, INVESTIGATION_STATUSES, InvestigationStatusBadge, isInvestigationStatus, STATUS_META } from "./shared";

function Retention({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">Kept until deleted</span>;
  const days = daysUntil(value);
  return (
    <span className={days <= 14 ? "font-medium text-warning" : undefined}>
      <FormattedDate value={value} mode="date" />
      {days <= 14 ? <span className="block text-xs font-normal">{days <= 0 ? "deletion due" : `deleted in ${days} ${days === 1 ? "day" : "days"}`}</span> : null}
    </span>
  );
}

const COLUMNS: Column<Investigation>[] = [
  {
    id: "title",
    header: "Investigation",
    skeleton: "w-48",
    cell: (inv) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/investigations/${inv.id}`}
            className="max-w-[28ch] truncate font-medium underline-offset-4 hover:underline sm:max-w-[40ch]"
            onClick={(e) => e.stopPropagation()}
          >
            {inv.title}
          </Link>
          <DemoBadge when={inv.is_demo} />
        </div>
        {inv.reference ? <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{inv.reference}</div> : null}
      </div>
    ),
  },
  { id: "status", header: "Status", skeleton: "w-16", cell: (inv) => <InvestigationStatusBadge status={inv.status} /> },
  { id: "evidence", header: "Evidence", align: "right", skeleton: "w-8", className: "hidden sm:table-cell", cell: (inv) => formatNumber(inv.evidence_count ?? 0) },
  { id: "comparisons", header: "Comparisons", align: "right", skeleton: "w-8", className: "hidden sm:table-cell", cell: (inv) => formatNumber(inv.analysis_count ?? 0) },
  { id: "notes", header: "Notes", align: "right", skeleton: "w-8", className: "hidden md:table-cell", cell: (inv) => formatNumber(inv.note_count ?? 0) },
  { id: "retention", header: "Retention", skeleton: "w-24", className: "hidden lg:table-cell", cell: (inv) => <Retention value={inv.retention_until} /> },
  {
    id: "updated",
    header: "Updated",
    skeleton: "w-20",
    className: "hidden md:table-cell whitespace-nowrap text-muted-foreground",
    cell: (inv) => <FormattedDate value={inv.updated_at} mode="relative" />,
  },
];

export function InvestigationsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const createOpen = searchParams.get("new") === "1";
  const setCreateOpen = (open: boolean) => router.replace(open ? `${pathname}?new=1` : pathname, { scroll: false });

  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState<string>("all");
  const pagination = usePagination(25);
  const filtered = q !== "" || status !== "all";
  const query = useInvestigations({
    ...pagination.params,
    ...(q ? { q } : {}),
    ...(isInvestigationStatus(status) ? { status } : {}),
  });

  const newButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <FolderPlus aria-hidden="true" />
      New investigation
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Investigations"
        description="Each investigation keeps the evidence images, comparisons, notes and processing history for one question together."
        actions={newButton}
      />

      <div role="search" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search investigations by title or reference"
            placeholder="Search title or reference"
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              pagination.reset();
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            pagination.reset();
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVESTIGATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatus("all");
              pagination.reset();
            }}
          >
            <X aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataTable
        caption="Investigations"
        columns={COLUMNS}
        rows={query.data?.items}
        rowKey={(inv) => inv.id}
        loading={query.isPending}
        fetching={query.isFetching}
        onRowClick={(inv) => router.push(`/app/investigations/${inv.id}`)}
        error={query.isError ? <ErrorState error={query.error} title="Could not load investigations" onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
        empty={
          filtered ? (
            <EmptyState icon={Search} title="No investigations match" description="Try a different search term or status." />
          ) : (
            <EmptyState
              icon={FolderSearch}
              title="No investigations yet"
              description="Create an investigation to keep questioned images, the comparisons you run on them, your notes and the processing history in one place."
              action={newButton}
            />
          )
        }
      />
      <DataTablePagination pagination={pagination} total={query.data?.total} label="investigations" />

      <InvestigationFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(inv) => router.push(`/app/investigations/${inv.id}`)} />
    </>
  );
}
