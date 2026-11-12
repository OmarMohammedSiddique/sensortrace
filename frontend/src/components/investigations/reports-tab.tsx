"use client";

import { Download, FileArchive, FileText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isJobTerminal, useCreateInvestigationReport, useDeleteInvestigation, useDeleteReport, useJob, useReports } from "@/lib/api/hooks";
import type { ExportOut, Investigation, Report } from "@/lib/api/types";
import { humanize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

import { useDataExports, useDeleteDataExport, useStartInvestigationExport } from "./export-hooks";
import { Panel } from "./panel";

/** One generated PDF: title, date, size, hash, download and delete. */
export function ReportRow({ report, onDelete }: { report: Report; onDelete: (report: Report) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">{report.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <FormattedDate value={report.created_at} />
          <span aria-hidden="true">·</span>
          <Bytes value={report.size_bytes} />
          <span aria-hidden="true">·</span>
          <Hash value={report.sha256} chars={6} />
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {report.download_url ? (
          <Button asChild variant="outline" size="sm">
            <a href={report.download_url} download>
              <Download aria-hidden="true" />
              Download PDF
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={`Delete report ${report.title}`} onClick={() => onDelete(report)}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function ReportsPanel({ investigation }: { investigation: Investigation }) {
  const query = useReports({ investigation_id: investigation.id, limit: 100 });
  const create = useCreateInvestigationReport();
  const del = useDeleteReport();
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const reports = query.data?.items;

  return (
    <Panel
      title="Reports"
      icon={FileText}
      flush
      description="The investigation summary report is a PDF listing the evidence with hashes, every comparison with its adjusted statistic and outcome, and your notes. For the reasons and limitations behind an outcome, generate the report of that comparison from its result page. Reports generated from a single comparison in this investigation are listed here too."
      action={
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(investigation.id, {
              onSuccess: () => toastSuccess("Report generated", "The PDF is ready to download."),
              onError: (err) => toastError(err, "Could not generate the report"),
            })
          }
        >
          {create.isPending ? "Generating" : "Generate summary report"}
        </Button>
      }
    >
      <div aria-live="polite">
        {query.isError ? (
          <div className="p-4">
            <ErrorState variant="inline" error={query.error} title="Could not load reports" onRetry={() => void query.refetch()} retrying={query.isFetching} />
          </div>
        ) : !reports ? (
          <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading reports">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : reports.length === 0 ? (
          <EmptyState variant="plain" icon={FileText} title="No reports yet" description="Generate a summary report when you want a self-contained record of this investigation." />
        ) : (
          <ul className="divide-y">
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} onDelete={setToDelete} />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this report?"
        description="The PDF is permanently deleted. The evidence and comparisons it describes are not affected, and you can generate a new report at any time."
        confirmLabel="Delete report"
        onConfirm={async () => {
          if (!toDelete) return;
          await del.mutateAsync(toDelete.id);
          toastSuccess("Report deleted");
        }}
      />
    </Panel>
  );
}

function ExportRow({ item, onDelete }: { item: ExportOut; onDelete: (item: ExportOut) => void }) {
  const ready = item.status === "ready" || Boolean(item.download_url);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <FileArchive aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">
          Export of <FormattedDate value={item.created_at} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {ready ? <Bytes value={item.size_bytes} /> : <span>{humanize(item.status)}</span>}
          {item.sha256 ? (
            <>
              <span aria-hidden="true">·</span>
              <Hash value={item.sha256} chars={6} />
            </>
          ) : null}
          {item.expires_at ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                available until <FormattedDate value={item.expires_at} />
              </span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {item.download_url ? (
          <Button asChild variant="outline" size="sm">
            <a href={item.download_url} download>
              <Download aria-hidden="true" />
              Download ZIP
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Delete this export" onClick={() => onDelete(item)}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function ExportPanel({ investigation }: { investigation: Investigation }) {
  const exportsQuery = useDataExports();
  const start = useStartInvestigationExport(investigation.id);
  const del = useDeleteDataExport();
  const [running, setRunning] = useState<{ jobId: string; exportId: string } | null>(null);
  const [toDelete, setToDelete] = useState<ExportOut | null>(null);
  const mine = exportsQuery.data?.filter((e) => e.investigation_id === investigation.id);
  const visible = mine?.filter((e) => e.id !== running?.exportId || e.download_url);

  return (
    <Panel
      title="Export"
      icon={FileArchive}
      flush
      description="An export is a ZIP archive with this investigation's records as JSON, the original evidence files exactly as received and the generated reports. It is built in the background and stays available for a limited time."
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={start.isPending || running !== null}
          onClick={() =>
            start.mutate(undefined, {
              onSuccess: (res) => setRunning({ jobId: res.job.id, exportId: res.export.id }),
              onError: (err) => toastError(err, "Could not start the export"),
            })
          }
        >
          {start.isPending ? "Starting" : "Export investigation"}
        </Button>
      }
    >
      {running ? (
        <div className="border-b p-4">
          <JobProgress
            jobId={running.jobId}
            title="Building the export"
            onDone={(job) => {
              void exportsQuery.refetch();
              if (job.status === "succeeded") {
                toastSuccess("Export ready", "The ZIP archive can be downloaded below.");
                setRunning(null);
              }
            }}
          />
          {/* Failed and cancelled jobs stay on screen with their message until dismissed. */}
          <DismissWhenFinished jobId={running.jobId} onDismiss={() => setRunning(null)} />
        </div>
      ) : null}
      <div aria-live="polite">
        {exportsQuery.isError ? (
          <div className="p-4">
            <ErrorState variant="inline" error={exportsQuery.error} title="Could not load exports" onRetry={() => void exportsQuery.refetch()} retrying={exportsQuery.isFetching} />
          </div>
        ) : !visible ? (
          <div className="p-4" role="status" aria-label="Loading exports">
            <Skeleton className="h-9 w-full" />
          </div>
        ) : visible.length === 0 ? (
          running ? null : (
            <EmptyState variant="plain" icon={FileArchive} title="No exports yet" description="Create an export to take a complete copy of this investigation out of SensorTrace." />
          )
        ) : (
          <ul className="divide-y">
            {visible.map((e) => (
              <ExportRow key={e.id} item={e} onDelete={setToDelete} />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this export?"
        description="The ZIP archive is permanently deleted. The investigation itself is not affected."
        confirmLabel="Delete export"
        onConfirm={async () => {
          if (!toDelete) return;
          await del.mutateAsync(toDelete.id);
          toastSuccess("Export deleted");
        }}
      />
    </Panel>
  );
}

function DismissWhenFinished({ jobId, onDismiss }: { jobId: string; onDismiss: () => void }) {
  const job = useJob(jobId);
  if (!isJobTerminal(job.data) || job.data?.status === "succeeded") return null;
  return (
    <Button variant="ghost" size="sm" className="mt-2" onClick={onDismiss}>
      Dismiss
    </Button>
  );
}

function DangerPanel({ investigation }: { investigation: Investigation }) {
  const router = useRouter();
  const del = useDeleteInvestigation();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-danger-border bg-danger-subtle/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-sm font-medium">Delete this investigation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently deletes the investigation with its evidence files, comparisons, notes and reports. This cannot be undone. Export it first if
            you need a copy.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden="true" />
          Delete investigation
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this investigation permanently?"
        description={
          <>
            Everything in <span className="font-medium text-foreground">{investigation.title}</span> will be deleted: evidence files, comparisons, notes and
            reports. There is no recycle bin and no way to restore it.
          </>
        }
        typedConfirmation={investigation.title}
        confirmLabel="Delete investigation"
        onConfirm={async () => {
          await del.mutateAsync(investigation.id);
          toastSuccess("Investigation deleted");
          router.replace("/app/investigations");
        }}
      />
    </section>
  );
}

export function ReportsTab({ investigation }: { investigation: Investigation }) {
  return (
    <div className="flex flex-col gap-6">
      <ReportsPanel investigation={investigation} />
      <ExportPanel investigation={investigation} />
      <DangerPanel investigation={investigation} />
    </div>
  );
}
