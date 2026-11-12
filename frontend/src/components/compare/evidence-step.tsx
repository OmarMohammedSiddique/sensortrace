"use client";

import { useQueries } from "@tanstack/react-query";
import { Check, FileImage, X } from "lucide-react";
import { useState } from "react";

import { DataTablePagination, usePagination } from "@/components/st/data-table";
import { DemoBadge } from "@/components/st/demo-badge";
import { SignedImage } from "@/components/st/signed-image";
import { EmptyState, ErrorState } from "@/components/st/states";
import { UploadDropzone } from "@/components/st/upload-dropzone";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, unwrap } from "@/lib/api/client";
import { FILE_URL_REFETCH, FILE_URL_STALE_TIME, useEvidenceList } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { Evidence, Investigation } from "@/lib/api/types";
import { CATEGORY_LABELS } from "@/lib/domain";
import { formatNumber, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export const MAX_IMAGES_PER_RUN = 20;

/** Loads the selected evidence items (dimensions and previews are needed for guidance). */
export function useSelectedEvidence(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.evidence.detail(id),
      queryFn: () => unwrap<Evidence>(api.GET("/api/v1/evidence/{evidence_id}", { params: { path: { evidence_id: id } } })),
      staleTime: FILE_URL_STALE_TIME,
      refetchInterval: FILE_URL_REFETCH,
      retry: false,
    })),
  });
}

function SelectedList({ ids, onRemove }: { ids: string[]; onRemove: (id: string) => void }) {
  const results = useSelectedEvidence(ids);
  return (
    <ul className="flex flex-col divide-y rounded-md border" aria-label="Selected questioned images">
      {ids.map((id, i) => {
        const r = results[i];
        const e = r?.data;
        return (
          <li key={id} className="flex items-center gap-3 px-2.5 py-2">
            {e ? (
              <SignedImage src={e.preview_url} alt={`Preview of ${e.filename}`} onExpired={() => void r.refetch()} className="size-9 shrink-0" imgClassName="object-cover" />
            ) : (
              <Skeleton className="size-9 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              {e ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{e.filename}</span>
                    <DemoBadge when={e.is_demo} />
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatNumber(e.width)} × {formatNumber(e.height)} px
                  </p>
                </>
              ) : r?.isError ? (
                <p className="text-sm text-danger">This image could not be loaded. It may have been deleted.</p>
              ) : (
                <Skeleton className="h-4 w-40" />
              )}
            </div>
            <Button variant="ghost" size="icon-xs" aria-label={e ? `Remove ${e.filename} from this comparison` : "Remove image from this comparison"} onClick={() => onRemove(id)}>
              <X aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function ExistingPicker({
  selected,
  onToggle,
  investigations,
  initialFilter,
  full,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  investigations: Investigation[] | undefined;
  initialFilter: string;
  full: boolean;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const pagination = usePagination(12);
  const query = useEvidenceList({
    ...pagination.params,
    ...(filter === "unassigned" ? { unassigned: true } : filter !== "all" ? { investigation_id: filter } : {}),
  });
  const items = query.data?.items;

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={filter}
        onValueChange={(v) => {
          setFilter(v);
          pagination.reset();
        }}
      >
        <SelectTrigger aria-label="Show evidence from" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All evidence</SelectItem>
          <SelectItem value="unassigned">Not in an investigation</SelectItem>
          {investigations?.length ? (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Investigations</SelectLabel>
                {investigations.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    {inv.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          ) : null}
        </SelectContent>
      </Select>

      {query.isError ? (
        <ErrorState variant="inline" error={query.error} title="Could not load evidence" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : !items ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status" aria-label="Loading evidence">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState variant="plain" icon={FileImage} title="No evidence here" description="Upload an image instead, or choose a different source above." />
      ) : (
        <ul className={cn("grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3", query.isFetching && "opacity-60")}>
          {items.map((e) => {
            const isSelected = selected.includes(e.id);
            const disabled = !isSelected && full;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  disabled={disabled}
                  onClick={() => onToggle(e.id)}
                  className={cn(
                    "group relative block w-full overflow-hidden rounded-md border text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                    isSelected ? "border-brand bg-brand-subtle" : "hover:bg-accent/60",
                  )}
                >
                  <SignedImage src={e.preview_url} alt={`Preview of ${e.filename}`} onExpired={() => void query.refetch()} className="aspect-[4/3] w-full rounded-none" imgClassName="object-cover" />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border bg-background",
                      isSelected && "border-brand bg-primary text-primary-foreground",
                    )}
                  >
                    {isSelected ? <Check className="size-3" /> : null}
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block truncate text-xs font-medium">{e.filename}</span>
                    <span className="block truncate text-[0.6875rem] text-muted-foreground">
                      <span className="font-mono">
                        {e.width}×{e.height}
                      </span>
                      <span aria-hidden="true"> · </span>
                      {CATEGORY_LABELS[e.category] ?? humanize(e.category)}
                      {e.is_demo ? " · Synthetic demo" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <DataTablePagination pagination={pagination} total={query.data?.total} label="images" className="mt-0" />
    </div>
  );
}

export interface EvidenceStepProps {
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  /** Investigation chosen as destination: uploads are filed there. */
  investigationId: string | null;
  investigations: Investigation[] | undefined;
  /** Start on the picker (when the page was opened for an investigation) or on upload. */
  initialTab: "upload" | "existing";
}

export function EvidenceStep({ selected, onChange, investigationId, investigations, initialTab }: EvidenceStepProps) {
  const full = selected.length >= MAX_IMAGES_PER_RUN;
  const destination = investigations?.find((i) => i.id === investigationId);
  const toggle = (id: string) =>
    onChange((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_IMAGES_PER_RUN ? current : [...current, id]));
  const addMany = (ids: string[]) =>
    onChange((current) => {
      const next = [...current];
      for (const id of ids) if (!next.includes(id) && next.length < MAX_IMAGES_PER_RUN) next.push(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue={initialTab}>
        <TabsList className="w-full">
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="existing">Choose existing</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="pt-3">
          <UploadDropzone
            compact
            url="/api/v1/evidence"
            fields={{ investigation_id: investigationId ?? undefined, category: "questioned" }}
            disabled={full}
            title="Drop questioned images here"
            description={
              destination
                ? `Stored unmodified, hashed with SHA-256 and filed in "${destination.title}".`
                : "Stored unmodified and hashed with SHA-256. Not filed in an investigation unless you choose one in step 3 first."
            }
            onBatch={(response) => addMany(response.results.flatMap((r) => (r.accepted && r.id ? [r.id] : [])))}
          />
        </TabsContent>
        <TabsContent value="existing" className="pt-3">
          <ExistingPicker
            selected={selected}
            onToggle={toggle}
            investigations={investigations}
            initialFilter={investigationId ?? "all"}
            full={full}
          />
        </TabsContent>
      </Tabs>

      <div aria-live="polite">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">
            Selected <span className="font-mono text-muted-foreground">{selected.length}</span>
            <span className="font-normal text-muted-foreground"> of at most {MAX_IMAGES_PER_RUN}</span>
          </h3>
          {selected.length > 1 ? (
            <Button variant="ghost" size="xs" onClick={() => onChange([])}>
              Clear all
            </Button>
          ) : null}
        </div>
        {selected.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No questioned image selected yet.</p>
        ) : (
          <SelectedList ids={selected} onRemove={(id) => onChange((current) => current.filter((x) => x !== id))} />
        )}
        {full ? <p className="mt-2 text-xs text-warning">A run can hold at most {MAX_IMAGES_PER_RUN} images. Start this run, then add the rest in another.</p> : null}
      </div>
    </div>
  );
}
