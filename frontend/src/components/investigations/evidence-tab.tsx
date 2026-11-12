"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, FileImage, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { type Column, DataTable, DataTablePagination, usePagination } from "@/components/st/data-table";
import { DemoBadge } from "@/components/st/demo-badge";
import { Bytes, FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { QualityFlags } from "@/components/st/quality-flags";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { UploadDropzone } from "@/components/st/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEvidenceList } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { Evidence, EvidenceCategory } from "@/lib/api/types";
import { CATEGORY_LABELS } from "@/lib/domain";
import { formatNumber, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AcquisitionFields, type AcquisitionValues, EMPTY_ACQUISITION, hasAcquisition } from "./acquisition-fields";
import { Panel } from "./panel";

export const CATEGORIES: EvidenceCategory[] = ["questioned", "reference", "context"];
export const CATEGORY_HINTS: Record<EvidenceCategory, string> = {
  questioned: "An image whose source sensor is in question. These are what you compare.",
  reference: "An image of known origin kept with the case for the record.",
  context: "Supporting material that is not itself compared.",
};

function UploadPanel({ investigationId }: { investigationId: string }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<EvidenceCategory>("questioned");
  const [acquisition, setAcquisition] = useState<AcquisitionValues>(EMPTY_ACQUISITION);
  const [showAcquisition, setShowAcquisition] = useState(false);
  const withAcquisition = showAcquisition && hasAcquisition(acquisition);

  return (
    <Panel title="Add evidence" icon={Upload}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="evidence-category">Category for the files you add</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as EvidenceCategory)}>
              <SelectTrigger id="evidence-category" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{CATEGORY_HINTS[category]}</p>
          </div>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              aria-expanded={showAcquisition}
              aria-controls="acquisition-details"
              onClick={() => setShowAcquisition((v) => !v)}
            >
              <ChevronDown aria-hidden="true" className={cn("transition-transform", showAcquisition && "rotate-180")} />
              Acquisition details (optional)
            </Button>
            {showAcquisition ? (
              <div id="acquisition-details" className="mt-2 animate-fade-in">
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                  Recorded with every file in the next upload. You can edit them per image afterwards.
                </p>
                <AcquisitionFields value={acquisition} onChange={setAcquisition} />
              </div>
            ) : null}
          </div>
        </div>
        <UploadDropzone
          url="/api/v1/evidence"
          fields={{ investigation_id: investigationId, category, acquisition: withAcquisition ? acquisition : undefined }}
          title="Drop evidence images here"
          description="The exact bytes you upload are stored unmodified and hashed with SHA-256."
          onComplete={() => {
            for (const queryKey of [qk.evidence.all, qk.investigations.all, qk.dashboard, qk.usage]) {
              void queryClient.invalidateQueries({ queryKey });
            }
          }}
        />
      </div>
    </Panel>
  );
}

export function EvidenceTab({ investigationId, onOpen }: { investigationId: string; onOpen: (evidenceId: string) => void }) {
  const pagination = usePagination(25);
  const query = useEvidenceList({ investigation_id: investigationId, ...pagination.params });
  const rows = query.data?.items;

  // The list endpoint does not report duplicates; mark identical content within the page.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of rows ?? []) seen.set(e.sha256, (seen.get(e.sha256) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([sha]) => sha));
  }, [rows]);

  const columns: Column<Evidence>[] = [
    {
      id: "file",
      header: "Image",
      skeleton: "w-44",
      cell: (e) => (
        <div className="flex min-w-0 items-center gap-3">
          <SignedImage src={e.preview_url} alt={`Preview of ${e.filename}`} onExpired={() => void query.refetch()} className="size-10 shrink-0" imgClassName="object-cover" />
          <div className="min-w-0">
            <button
              type="button"
              className="block max-w-[22ch] truncate rounded-sm text-left font-medium underline-offset-4 hover:underline sm:max-w-[32ch]"
              onClick={(ev) => {
                ev.stopPropagation();
                onOpen(e.id);
              }}
            >
              {e.filename}
            </button>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <DemoBadge when={e.is_demo} />
              {repeated.has(e.sha256) ? (
                <Badge variant="secondary" title="Another evidence item in this list has identical file content">
                  <Copy aria-hidden="true" />
                  Duplicate content
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground sm:hidden">{CATEGORY_LABELS[e.category] ?? humanize(e.category)}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      skeleton: "w-16",
      className: "hidden sm:table-cell",
      cell: (e) => <Badge variant="outline">{CATEGORY_LABELS[e.category] ?? humanize(e.category)}</Badge>,
    },
    { id: "sha", header: "SHA-256", skeleton: "w-32", className: "hidden lg:table-cell", cell: (e) => <span onClick={(ev) => ev.stopPropagation()}><Hash value={e.sha256} chars={6} /></span> },
    {
      id: "dimensions",
      header: "Dimensions",
      align: "right",
      skeleton: "w-20",
      className: "hidden md:table-cell whitespace-nowrap font-mono text-xs",
      cell: (e) => `${formatNumber(e.width)} × ${formatNumber(e.height)}`,
    },
    { id: "size", header: "Size", align: "right", skeleton: "w-12", className: "hidden md:table-cell whitespace-nowrap", cell: (e) => <Bytes value={e.size_bytes} /> },
    {
      id: "received",
      header: "Received",
      skeleton: "w-20",
      className: "hidden xl:table-cell whitespace-nowrap text-muted-foreground",
      cell: (e) => <FormattedDate value={e.created_at} />,
    },
    { id: "quality", header: "Quality", skeleton: "w-16", cell: (e) => <QualityFlags quality={e.quality} variant="summary" /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <UploadPanel investigationId={investigationId} />
      <section aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="sr-only">
          Evidence images
        </h2>
        <DataTable
          caption="Evidence images in this investigation"
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={query.isPending}
          fetching={query.isFetching}
          onRowClick={(e) => onOpen(e.id)}
          error={query.isError ? <ErrorState error={query.error} title="Could not load evidence" onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
          empty={
            <EmptyState
              icon={FileImage}
              title="No evidence yet"
              description="Add the questioned images with the upload area above. Each file is hashed on receipt and stored exactly as received."
            />
          }
        />
        <DataTablePagination pagination={pagination} total={query.data?.total} label="evidence images" />
      </section>
    </div>
  );
}
