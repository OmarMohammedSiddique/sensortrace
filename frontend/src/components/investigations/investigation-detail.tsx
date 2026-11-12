"use client";

import { CalendarClock, FileImage, FileText, FolderSearch, History, NotebookPen, Pencil, ScanSearch } from "lucide-react";
import Link from "next/link";
import { ApiError } from "@/lib/api/errors";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-context";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useInvestigation, useUpdateInvestigation } from "@/lib/api/hooks";
import type { Investigation, InvestigationStatus } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

import { ComparisonsTab } from "./comparisons-tab";
import { EvidenceSheet } from "./evidence-sheet";
import { EvidenceTab } from "./evidence-tab";
import { HistoryTab } from "./history-tab";
import { NotesTab } from "./notes-tab";
import { ReportsTab } from "./reports-tab";
import { daysUntil, INVESTIGATION_STATUSES, RETENTION_EXPLANATION, STATUS_META } from "./shared";

const TABS = [
  { id: "evidence", label: "Evidence", icon: FileImage },
  { id: "comparisons", label: "Comparisons", icon: ScanSearch },
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "history", label: "History", icon: History },
  { id: "reports", label: "Reports and export", icon: FileText },
] as const;
type TabId = (typeof TABS)[number]["id"];

function DetailsEditor({ investigation, onDone }: { investigation: Investigation; onDone: () => void }) {
  const id = useId();
  const update = useUpdateInvestigation(investigation.id);
  const [title, setTitle] = useState(investigation.title);
  const [reference, setReference] = useState(investigation.reference);
  const [description, setDescription] = useState(investigation.description);
  const invalid = title.trim() === "";

  return (
    <form
      className="mb-6 grid gap-3 rounded-lg bg-card p-4 ring-1 ring-foreground/10 sm:mb-8 sm:grid-cols-[2fr_1fr]"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        update.mutate(
          { title: title.trim(), reference: reference.trim(), description: description.trim() },
          {
            onSuccess: () => {
              toastSuccess("Investigation updated");
              onDone();
            },
          },
        );
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus aria-invalid={invalid} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-ref`}>Reference</Label>
        <Input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="font-mono" placeholder="Case or file number" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-desc`}>Description</Label>
        <Textarea id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} rows={3} />
      </div>
      {update.isError ? (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm sm:col-span-2">
          {update.error.message}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={update.isPending || invalid}>
          {update.isPending ? "Saving" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" disabled={update.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StatusSelect({ investigation }: { investigation: Investigation }) {
  const update = useUpdateInvestigation(investigation.id);
  return (
    <Select
      value={investigation.status}
      disabled={update.isPending}
      onValueChange={(v) =>
        update.mutate(
          { status: v as InvestigationStatus },
          {
            onSuccess: (inv) => toastSuccess(`Investigation marked ${STATUS_META[inv.status as InvestigationStatus]?.label.toLowerCase() ?? inv.status}`),
            onError: (err) => toastError(err, "Could not change the status"),
          },
        )
      }
    >
      <SelectTrigger aria-label="Investigation status" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INVESTIGATION_STATUSES.map((s) => {
          const Icon = STATUS_META[s].icon;
          return (
            <SelectItem key={s} value={s}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {STATUS_META[s].label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function RetentionControl({ investigation }: { investigation: Investigation }) {
  const id = useId();
  const update = useUpdateInvestigation(investigation.id);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const current = investigation.retention_until;
  const remaining = current ? daysUntil(current) : null;
  const parsed = /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
  const valid = parsed >= 1 && parsed <= 3650;

  const save = (retention_days: number) =>
    update.mutate(
      { retention_days },
      {
        onSuccess: () => {
          toastSuccess(retention_days === 0 ? "Retention date cleared" : "Retention date set");
          setOpen(false);
          setDays("");
        },
      },
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <CalendarClock aria-hidden="true" />
          {current ? (
            <span>
              Retained until <FormattedDate value={current} mode="date" />
            </span>
          ) : (
            "No retention date"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save(parsed);
          }}
        >
          <div>
            <h2 className="text-sm font-medium">Retention</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{RETENTION_EXPLANATION}</p>
          </div>
          {current ? (
            <p className="rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-xs leading-relaxed">
              Scheduled for permanent deletion on <FormattedDate value={current} mode="date" className="font-medium" />
              {remaining !== null ? ` (${remaining <= 0 ? "due now" : `in ${formatNumber(remaining)} ${remaining === 1 ? "day" : "days"}`})` : null}.
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-days`}>{current ? "New retention period, in days from today" : "Retention period, in days from today"}</Label>
            <Input id={`${id}-days`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 365" aria-invalid={days !== "" && !valid} />
            {days !== "" && !valid ? <p className="text-xs text-danger">Enter a whole number of days from 1 to 3,650.</p> : null}
          </div>
          {update.isError ? (
            <p role="alert" className="text-xs text-danger">
              {update.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!valid || update.isPending}>
              {update.isPending ? "Saving" : "Set retention"}
            </Button>
            {current ? (
              <Button type="button" variant="outline" size="sm" disabled={update.isPending} onClick={() => save(0)}>
                Clear retention date
              </Button>
            ) : null}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function InvestigationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useInvestigation(id);
  const investigation = query.data;
  useBreadcrumbLabel(investigation?.title);
  const [editing, setEditing] = useState(false);

  const tabParam = searchParams.get("tab");
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "evidence";
  const evidenceId = searchParams.get("item");

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (query.isError) {
    return query.error instanceof ApiError && query.error.isNotFound ? (
      <EmptyState
        icon={FolderSearch}
        title="Investigation not found"
        description="It may have been deleted, or removed on its retention date."
        action={
          <Button asChild>
            <Link href="/app/investigations">Back to investigations</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={query.error} title="Could not load this investigation" onRetry={() => void query.refetch()} retrying={query.isFetching} />
    );
  }
  if (!investigation) {
    return (
      <div role="status" aria-label="Loading investigation">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <Skeleton className="mt-8 h-9 w-full max-w-xl" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  const counts: Partial<Record<TabId, number>> = {
    evidence: investigation.evidence_count ?? 0,
    comparisons: investigation.analysis_count ?? 0,
    notes: investigation.note_count ?? 0,
  };

  return (
    <>
      {editing ? (
        <>
          <h1 className="mb-3 text-xl font-semibold tracking-tight sm:text-2xl">Edit investigation</h1>
          <DetailsEditor investigation={investigation} onDone={() => setEditing(false)} />
        </>
      ) : (
        <PageHeader
          eyebrow={investigation.reference ? <span className="font-mono normal-case tracking-normal">{investigation.reference}</span> : "Investigation"}
          title={investigation.title}
          badges={
            <>
              <DemoBadge when={investigation.is_demo} />
              <Button variant="ghost" size="icon-sm" aria-label="Edit title, reference and description" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
              </Button>
            </>
          }
          description={
            <>
              {investigation.description ? <span className="block whitespace-pre-wrap">{investigation.description}</span> : null}
              <span className="mt-1.5 block text-xs">
                Created <FormattedDate value={investigation.created_at} />
                <span aria-hidden="true"> · </span>
                updated <FormattedDate value={investigation.updated_at} mode="relative" />
              </span>
            </>
          }
          actions={
            <>
              <StatusSelect investigation={investigation} />
              <RetentionControl investigation={investigation} />
            </>
          }
        />
      )}

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v === "evidence" ? null : v, item: null })}>
        <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line" className="border-b">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="px-2.5">
                <t.icon aria-hidden="true" />
                {t.label}
                {counts[t.id] !== undefined ? <span className="font-mono text-xs text-muted-foreground">{formatNumber(counts[t.id])}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="evidence">
          <EvidenceTab investigationId={investigation.id} onOpen={(item) => setParams({ item })} />
        </TabsContent>
        <TabsContent value="comparisons">
          <ComparisonsTab investigationId={investigation.id} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab investigationId={investigation.id} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab investigationId={investigation.id} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab investigation={investigation} />
        </TabsContent>
      </Tabs>

      <EvidenceSheet evidenceId={evidenceId} onOpenChange={(item) => setParams({ item })} />
    </>
  );
}
