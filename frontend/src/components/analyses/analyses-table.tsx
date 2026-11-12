"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { type Column, DataTable, DataTablePagination, usePagination } from "@/components/st/data-table";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { JobStatusBadge } from "@/components/st/job-progress";
import { PolicyNotice } from "@/components/st/policy-notice";
import { SignedImage } from "@/components/st/signed-image";
import { ErrorState } from "@/components/st/states";
import { VerdictBadge } from "@/components/st/verdict-badge";
import { type AnalysisListParams, useAnalyses, usePolicies } from "@/lib/api/hooks";
import type { Analysis } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";

/** Analysis status in the vocabulary of the job badge (pending = queued, completed = succeeded). */
export function analysisStatusForBadge(status: string): string {
  if (status === "pending") return "queued";
  if (status === "completed") return "succeeded";
  return status;
}

export interface AnalysesTableProps {
  params?: Omit<AnalysisListParams, "limit" | "offset">;
  pageSize?: number;
  caption: string;
  empty: React.ReactNode;
}

/**
 * Paginated list of comparisons with the outcome for the top-ranked candidate. The outcome
 * is always labelled as belonging to the top-ranked candidate; reasons and caveats are one
 * click away on the result page, and the policy status is stated under the table.
 */
export function AnalysesTable({ params, pageSize = 10, caption, empty }: AnalysesTableProps) {
  const router = useRouter();
  const pagination = usePagination(pageSize);
  const query = useAnalyses({ ...params, ...pagination.params });
  const policies = usePolicies();
  const rows = query.data?.items;
  const hasVerdicts = rows?.some((a) => a.top_verdict);
  const anyUncalibrated = policies.data?.find((p) => !p.calibrated);

  const columns: Column<Analysis>[] = [
    {
      id: "image",
      header: "Questioned image",
      skeleton: "w-44",
      cell: (a) => {
        const name = a.evidence_filename || "Untitled image";
        return (
          <div className="flex min-w-0 items-center gap-3">
            <SignedImage src={a.evidence_preview_url} alt={`Preview of ${name}`} onExpired={() => void query.refetch()} className="size-10 shrink-0" imgClassName="object-cover" />
            <div className="min-w-0">
              <Link href={`/app/analyses/${a.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[22ch] truncate font-medium underline-offset-4 hover:underline sm:max-w-[30ch]">
                {name}
              </Link>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <DemoBadge when={a.is_demo} />
                <span className="md:hidden">
                  <FormattedDate value={a.completed_at ?? a.created_at} mode="relative" />
                </span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: "top",
      header: "Top-ranked candidate",
      skeleton: "w-36",
      className: "hidden lg:table-cell",
      cell: (a) => (a.top_label ? <span className="block max-w-[30ch] truncate">{a.top_label}</span> : <span className="text-muted-foreground">-</span>),
    },
    {
      id: "outcome",
      header: "Outcome for top candidate",
      skeleton: "w-32",
      cell: (a) =>
        a.top_verdict ? (
          <>
            <VerdictBadge verdict={a.top_verdict} size="sm" short />
            {a.top_label ? <span className="mt-1 block max-w-[24ch] truncate text-xs text-muted-foreground lg:hidden">{a.top_label}</span> : null}
          </>
        ) : (
          <JobStatusBadge status={analysisStatusForBadge(a.status)} />
        ),
    },
    {
      id: "candidates",
      header: "Candidates",
      align: "right",
      skeleton: "w-8",
      className: "hidden sm:table-cell",
      cell: (a) => formatNumber(a.candidate_count ?? 0),
    },
    {
      id: "date",
      header: "Date",
      skeleton: "w-20",
      className: "hidden md:table-cell whitespace-nowrap text-muted-foreground",
      cell: (a) => <FormattedDate value={a.completed_at ?? a.created_at} />,
    },
  ];

  return (
    <div>
      <DataTable
        caption={caption}
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        loading={query.isPending}
        fetching={query.isFetching}
        onRowClick={(a) => router.push(`/app/analyses/${a.id}`)}
        error={query.isError ? <ErrorState error={query.error} title="Could not load comparisons" onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
        empty={empty}
      />
      {hasVerdicts ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Each outcome is for the top-ranked candidate only and is a statistical indication, not proof of origin. Open a comparison for the reasons,
          limitations and every other candidate.
        </p>
      ) : null}
      {hasVerdicts && policies.data?.length === 1 ? <PolicyNotice policy={policies.data[0]} variant="compact" className="mt-1" /> : null}
      {hasVerdicts && (policies.data?.length ?? 0) > 1 && anyUncalibrated ? (
        <p className="mt-1 text-xs text-muted-foreground">Whether the policy used was calibrated is stated on each result page.</p>
      ) : null}
      <DataTablePagination pagination={pagination} total={query.data?.total} label="comparisons" />
    </div>
  );
}
