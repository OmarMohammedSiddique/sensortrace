"use client";

import { Archive, Download, HardDrive, PackageOpen, Trash2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { Panel, triggerDownload } from "@/components/cameras/shared";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { EmptyState, ErrorState, LoadingRows } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DELETE_ACCOUNT_CONFIRMATION,
  useDeleteAccount,
  useDeleteExport,
  useExports,
  useStartAccountExport,
} from "@/lib/api/account-hooks";
import { isJobActive, useJobs, useUsage } from "@/lib/api/hooks";
import type { ExportOut } from "@/lib/api/types";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatNumber, humanize } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ usage */

const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: "evidence", label: "Evidence images", color: "var(--chart-1)" },
  { key: "reference_images", label: "Reference images", color: "var(--chart-2)" },
  { key: "fingerprints", label: "Fingerprints", color: "var(--chart-3)" },
  { key: "reports", label: "Reports", color: "var(--chart-4)" },
  { key: "exports", label: "Exports", color: "var(--chart-5)" },
];

const COUNT_LABELS: Record<string, string> = {
  investigations: "Investigations",
  evidence: "Evidence images",
  devices: "Cameras",
  sensors: "Sensors",
  fingerprints: "Fingerprint versions",
  analyses: "Analyses",
  reports: "Reports",
  jobs: "Background jobs",
};

function num(record: unknown, key: string): number {
  const v = (record as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function UsagePanel() {
  const usage = useUsage();
  if (usage.isPending) {
    return (
      <Panel title="Storage" icon={HardDrive}>
        <div role="status" aria-label="Loading storage usage" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </Panel>
    );
  }
  if (usage.isError) {
    return (
      <Panel title="Storage" icon={HardDrive}>
        <ErrorState variant="inline" title="Could not load storage usage" error={usage.error} onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
      </Panel>
    );
  }
  const { storage, quota_bytes: quota, counts } = usage.data;
  const total = num(storage, "total");
  const percent = quota > 0 ? Math.min(100, (total / quota) * 100) : 0;
  const near = percent >= 90;
  const known = CATEGORIES.reduce((sum, c) => sum + num(storage, c.key), 0);
  const other = Math.max(0, total - known);
  const scale = quota > 0 ? quota : total || 1;
  const percentText = percent > 0 && percent < 0.1 ? "less than 0.1" : formatNumber(percent, 1);

  return (
    <Panel title="Storage" icon={HardDrive}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xl font-medium tracking-tight">
          <Bytes value={total} />
          {quota > 0 ? <span className="text-sm font-normal text-muted-foreground"> of {formatBytes(quota, 0)} used</span> : null}
        </p>
        {quota > 0 ? <p className={cn("font-mono text-xs", near ? "text-danger" : "text-muted-foreground")}>{percentText}% of quota</p> : null}
      </div>
      {/* Stacked bar: one segment per category, scaled against the quota. The table below carries the same numbers. */}
      <div
        role="img"
        aria-label={`Storage used: ${formatBytes(total)}${quota > 0 ? ` of ${formatBytes(quota, 0)} (${percentText} percent)` : ""}. The breakdown by category is in the table that follows.`}
        className="mt-3 flex h-3 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {CATEGORIES.map((c) => {
          const value = num(storage, c.key);
          if (value <= 0) return null;
          return <span key={c.key} style={{ width: `${Math.max(0.5, (value / scale) * 100)}%`, backgroundColor: c.color }} />;
        })}
        {other > 0 ? <span className="bg-foreground/40" style={{ width: `${Math.max(0.5, (other / scale) * 100)}%` }} /> : null}
      </div>
      {near ? (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <TriangleAlert aria-hidden="true" className="size-3.5" /> Storage is almost full. Delete exports, reports or evidence you no longer need.
        </p>
      ) : null}
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <table className="w-full text-sm">
          <caption className="eyebrow mb-2 text-left">Storage by category</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Size</th>
              <th scope="col">Share of used storage</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {CATEGORIES.map((c) => {
              const value = num(storage, c.key);
              return (
                <tr key={c.key}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </span>
                  </th>
                  <td className="py-1.5 text-right font-mono text-xs">{formatBytes(value)}</td>
                  <td className="w-16 py-1.5 text-right font-mono text-xs text-muted-foreground">{total > 0 ? `${formatNumber((value / total) * 100, 1)}%` : "-"}</td>
                </tr>
              );
            })}
            {other > 0 ? (
              <tr>
                <th scope="row" className="py-1.5 text-left font-normal">Other</th>
                <td className="py-1.5 text-right font-mono text-xs">{formatBytes(other)}</td>
                <td className="w-16 py-1.5 text-right font-mono text-xs text-muted-foreground">{formatNumber((other / total) * 100, 1)}%</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <table className="w-full text-sm">
          <caption className="eyebrow mb-2 text-left">Records in your account</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {Object.entries(counts as Record<string, unknown>).map(([key, value]) => (
              <tr key={key}>
                <th scope="row" className="py-1.5 text-left font-normal">{COUNT_LABELS[key] ?? humanize(key)}</th>
                <td className="py-1.5 text-right font-mono text-xs">{typeof value === "number" ? formatNumber(value) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- exports */

function ExportStatus({ status }: { status: string }) {
  const label = status === "ready" ? "Ready" : status === "pending" || status === "running" ? "Being prepared" : humanize(status);
  return (
    <span className={cn("text-xs font-medium", status === "ready" ? "text-success" : status === "failed" ? "text-danger" : "text-muted-foreground")}>
      {label}
    </span>
  );
}

function ExportsPanel() {
  const exports = useExports();
  const start = useStartAccountExport();
  const remove = useDeleteExport();
  const activeJobs = useJobs({ active: true, limit: 100 });
  const running = activeJobs.data?.items.find((j) => j.target_type === "export" && isJobActive(j));
  // Remember the last export job seen so its outcome stays visible after it finishes.
  const [jobId, setJobId] = useState<string | null>(null);
  if (running && running.id !== jobId) setJobId(running.id);
  const [toDelete, setToDelete] = useState<ExportOut | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (item: ExportOut) => {
    setDownloading(item.id);
    try {
      // Links are signed for five minutes: fetch a fresh one at the moment of the click.
      const fresh = (await exports.refetch()).data?.find((e) => e.id === item.id);
      if (!fresh?.download_url) throw new Error("This export is no longer available.");
      triggerDownload(fresh.download_url);
    } catch (err) {
      toastError(err, "Could not download the export");
    } finally {
      setDownloading(null);
    }
  };

  const accountExports = exports.data ?? [];

  return (
    <Panel
      title="Export your data"
      icon={Archive}
      flush
      action={
        <Button
          size="sm"
          disabled={start.isPending || Boolean(running)}
          onClick={() =>
            start.mutate(undefined, {
              onSuccess: ({ job }) => setJobId(job.id),
              onError: (e) => toastError(e, "Could not start the export"),
            })
          }
        >
          <PackageOpen aria-hidden="true" />
          {start.isPending ? "Starting" : running ? "Export in progress" : "Export everything"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Packages all of your records and the original files you uploaded into a single ZIP archive. Preparing it
          runs in the background; the download link stays valid for 7 days, after which the archive is removed. An
          archive counts towards your storage until then.
        </p>
        {jobId ? <JobProgress key={jobId} jobId={jobId} title="Preparing export" className="bg-background" onDone={(job) => (job.status === "succeeded" ? toastSuccess("Export ready", "Download it from the list below.") : undefined)} /> : null}
      </div>
      <div className="border-t">
        {exports.isPending ? (
          <LoadingRows rows={2} className="p-4" />
        ) : exports.isError ? (
          <div className="p-4">
            <ErrorState variant="inline" title="Could not load exports" error={exports.error} onRetry={() => void exports.refetch()} retrying={exports.isFetching} />
          </div>
        ) : accountExports.length === 0 ? (
          <EmptyState variant="plain" icon={Archive} title="No exports" description="Archives you prepare are listed here until they expire or you delete them." />
        ) : (
          <ul className="divide-y" aria-label="Exports">
            {accountExports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                    {e.scope === "investigation" ? "Investigation export" : "Full account export"}
                    <ExportStatus status={e.status} />
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>
                      Requested <FormattedDate value={e.created_at} />
                    </span>
                    {e.status === "ready" ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <Bytes value={e.size_bytes} />
                      </>
                    ) : null}
                    {e.expires_at ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          Expires <FormattedDate value={e.expires_at} />
                        </span>
                      </>
                    ) : null}
                    {e.sha256 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <Hash value={e.sha256} chars={6} />
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {e.status === "ready" ? (
                    <Button variant="outline" size="sm" disabled={downloading === e.id} onClick={() => void download(e)}>
                      <Download aria-hidden="true" />
                      {downloading === e.id ? "Preparing" : "Download"}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label="Delete export" onClick={() => setToDelete(e)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title="Delete this export?"
        description="The archive is removed and its download link stops working. Your data itself is not affected, and you can prepare a new export at any time."
        confirmLabel="Delete export"
        onConfirm={async () => {
          if (!toDelete) return;
          await remove.mutateAsync(toDelete.id);
          toastSuccess("Export deleted");
        }}
      />
    </Panel>
  );
}

/* --------------------------------------------------------- delete account */

function DeleteAccountPanel() {
  const { signOut, user } = useAuth();
  const remove = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const passwordId = useId();

  return (
    <section aria-labelledby="delete-account-title" className="overflow-hidden rounded-lg border border-danger-border bg-card">
      <header className="flex min-h-11 items-center border-b border-danger-border px-4">
        <h2 id="delete-account-title" className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert aria-hidden="true" className="size-4 text-danger" /> Delete account
        </h2>
      </header>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          <p>
            Permanently deletes your account and everything that belongs to it. This cannot be undone and nothing can
            be recovered afterwards, so export your data first if you may need it.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            <li>Cameras, sensors, reference images and every fingerprint</li>
            <li>Investigations, evidence images, notes, analyses and reports</li>
            <li>Exports, API tokens, sessions and your activity log</li>
          </ul>
        </div>
        <Button
          variant="destructive"
          className="shrink-0"
          onClick={() => {
            setPassword("");
            setOpen(true);
          }}
        >
          <Trash2 aria-hidden="true" /> Delete account
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account permanently?"
        description={
          <>
            The account <span className="font-medium break-all text-foreground">{user?.email}</span> and every file and
            record in it will be deleted immediately. There is no undo and no recovery period.
          </>
        }
        confirmLabel="Delete my account"
        typedConfirmation={DELETE_ACCOUNT_CONFIRMATION}
        onConfirm={async () => {
          if (!password) throw new Error("Enter your password to confirm.");
          await remove.mutateAsync(password);
          toastSuccess("Your account has been deleted");
          await signOut("/");
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={passwordId} className="text-xs font-normal text-muted-foreground">
            Your password
          </Label>
          <Input id={passwordId} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </ConfirmDialog>
    </section>
  );
}

export function DataTab() {
  return (
    <div className="flex flex-col gap-6">
      <UsagePanel />
      <ExportsPanel />
      <DeleteAccountPanel />
    </div>
  );
}
