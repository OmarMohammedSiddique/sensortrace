"use client";

import { Download, FileText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { triggerDownload } from "@/components/cameras/shared";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DataTable, DataTablePagination, usePagination, type Column } from "@/components/st/data-table";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api/client";
import { useDeleteReport, useReports } from "@/lib/api/hooks";
import type { Report } from "@/lib/api/types";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Download links are signed and expire after five minutes, so a fresh one is requested at
 * the moment of the click instead of trusting the link that came with the list.
 */
function DownloadButton({ report }: { report: Report }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const fresh = await unwrap<Report>(api.GET("/api/v1/reports/{report_id}", { params: { path: { report_id: report.id } } }));
      if (!fresh.download_url) throw new Error("The report file is not available.");
      triggerDownload(fresh.download_url);
    } catch (err) {
      toastError(err, "Could not download the report");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="xs" onClick={() => void download()} disabled={busy}>
      <Download aria-hidden="true" />
      {busy ? "Preparing" : "Download"}
      <span className="sr-only"> {report.title}</span>
    </Button>
  );
}

function Source({ report }: { report: Report }) {
  if (report.analysis_id) {
    return (
      <Link href={`/app/analyses/${report.analysis_id}`} className="text-brand underline-offset-4 hover:underline">
        Analysis
      </Link>
    );
  }
  if (report.investigation_id) {
    return (
      <Link href={`/app/investigations/${report.investigation_id}`} className="text-brand underline-offset-4 hover:underline">
        Investigation
      </Link>
    );
  }
  return <span className="text-muted-foreground">Source deleted</span>;
}

export function ReportsView() {
  const pagination = usePagination(25);
  const reports = useReports(pagination.params);
  const remove = useDeleteReport();
  const [toDelete, setToDelete] = useState<Report | null>(null);

  const columns: Column<Report>[] = [
    {
      id: "title",
      header: "Report",
      skeleton: "w-56",
      className: "whitespace-normal",
      cell: (r) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium break-words">{r.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
              <FormattedDate value={r.created_at} /> · <Bytes value={r.size_bytes} />
            </p>
          </div>
        </div>
      ),
    },
    { id: "source", header: "Made from", cell: (r) => <Source report={r} /> },
    {
      id: "created",
      header: "Created",
      className: "hidden md:table-cell",
      cell: (r) => <FormattedDate value={r.created_at} className="text-muted-foreground" />,
    },
    {
      id: "size",
      header: "Size",
      align: "right",
      className: "hidden md:table-cell",
      cell: (r) => <Bytes value={r.size_bytes} className="font-mono text-xs" />,
    },
    { id: "sha", header: "SHA-256", className: "hidden lg:table-cell", cell: (r) => <Hash value={r.sha256} chars={6} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <span className="flex items-center justify-end gap-1">
          <DownloadButton report={r} />
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" aria-label={`Delete report ${r.title}`} onClick={() => setToDelete(r)}>
            <Trash2 aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="PDF reports you have generated. Each records the measurements, the decision policy, the reasons and the caveats as they were when it was made. The SHA-256 lets a recipient check the file is unchanged."
      />
      <DataTable
        caption="Generated reports"
        columns={columns}
        rows={reports.data?.items}
        rowKey={(r) => r.id}
        loading={reports.isPending}
        fetching={reports.isPlaceholderData}
        error={reports.isError && !reports.data ? <ErrorState title="Could not load reports" error={reports.error} onRetry={() => void reports.refetch()} retrying={reports.isFetching} /> : null}
        empty={
          <EmptyState
            icon={FileText}
            title="No reports yet"
            description="Reports are generated from a completed analysis, or from an investigation to cover all of its analyses. Open one and choose to generate a report."
            action={
              <Button asChild>
                <Link href="/app/investigations">Go to investigations</Link>
              </Button>
            }
            secondaryAction={
              <Button asChild variant="outline">
                <Link href="/app/compare">Compare an image</Link>
              </Button>
            }
          />
        }
      />
      <DataTablePagination pagination={pagination} total={reports.data?.total} label="reports" />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this report?"
        description={
          <>
            <span className="font-medium break-words text-foreground">{toDelete?.title}</span> will be deleted. The
            analysis it was made from is not affected and a new report can be generated from it. Copies already
            downloaded are not recalled. This cannot be undone.
          </>
        }
        confirmLabel="Delete report"
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync(toDelete.id);
          toastSuccess("Report deleted");
        }}
      />
    </>
  );
}
