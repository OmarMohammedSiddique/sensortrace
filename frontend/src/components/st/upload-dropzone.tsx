"use client";

import { Ban, CircleCheck, CircleX, FileImage, LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";

import { Hash } from "@/components/st/hash";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { errorMessage } from "@/lib/api/errors";
import { useMeta } from "@/lib/api/hooks";
import type { UploadResponse, UploadResult } from "@/lib/api/types";
import { chunk, isAbortError, uploadFiles, type UploadOptions } from "@/lib/api/upload";
import { formatBytes, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ model */

type ItemStatus =
  | "queued" // waiting for its request
  | "uploading" // bytes in flight
  | "processing" // sent; server is validating
  | "accepted"
  | "rejected" // refused by the server, or by the client-side checks
  | "failed" // the request itself failed (network, 5xx); can be retried
  | "cancelled";

export interface UploadItem {
  key: string;
  file: File;
  status: ItemStatus;
  /** 0..1 while uploading */
  progress: number;
  /** Server result for accepted/rejected files. */
  result?: UploadResult;
  /** Reason for rejected / failed / cancelled. */
  reason?: string;
}

type Action =
  | { type: "add"; items: UploadItem[] }
  | { type: "patch"; keys: string[]; patch: Partial<UploadItem> | ((item: UploadItem) => Partial<UploadItem>) }
  | { type: "clear" };

function reducer(state: UploadItem[], action: Action): UploadItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];
    case "patch": {
      const keys = new Set(action.keys);
      return state.map((item) =>
        keys.has(item.key)
          ? { ...item, ...(typeof action.patch === "function" ? action.patch(item) : action.patch) }
          : item,
      );
    }
    case "clear":
      return [];
  }
}

const ACCEPT_EXT = /\.(jpe?g|png)$/i;
const DEFAULT_TYPES = ["image/jpeg", "image/png"];
/** Fallbacks used only until GET /meta has loaded. */
const FALLBACK_MAX_BYTES = 64 * 1024 * 1024;
const FALLBACK_MAX_FILES = 60;

let counter = 0;

/* -------------------------------------------------------------- component */

export interface UploadDropzoneProps {
  /** Target endpoint, e.g. `/api/v1/evidence` or `/api/v1/sensors/${id}/references`. */
  url: string;
  /**
   * Extra multipart fields sent with every request (objects are JSON-encoded), e.g.
   * `{ investigation_id, category: "questioned", acquisition: { source: "..." } }`.
   */
  fields?: UploadOptions["fields"];
  /** Called after each request with that request's per-file results. */
  onBatch?: (response: UploadResponse) => void;
  /**
   * Called once when the whole selection has been processed, with every server result.
   * Invalidate or refetch the affected lists here.
   */
  onComplete?: (summary: { accepted: UploadResult[]; rejected: UploadResult[]; failed: number }) => void;
  /** Heading inside the drop area. */
  title?: string;
  /** Helper line under the heading. The format and size limits are always appended. */
  description?: string;
  /** Cap on files per selection (e.g. remaining reference slots). */
  maxFiles?: number;
  /** Allow choosing more than one file (default true). */
  multiple?: boolean;
  disabled?: boolean;
  /** Smaller drop area for dialogs and side panels. */
  compact?: boolean;
  className?: string;
}

/**
 * Drag-and-drop / file-picker upload for JPEG and PNG images.
 * - Client-side checks: type and per-file size (limits from GET /meta).
 * - Large selections are split into several requests (`limits.max_files_per_request`
 *   and, when the API reports it, `limits.max_request_bytes`).
 * - Shows per-file progress and a results list with accepted files (hash, warnings) and
 *   rejected files (reason). Results are announced through an aria-live region.
 */
export function UploadDropzone({
  url,
  fields,
  onBatch,
  onComplete,
  title = "Drop images here or choose files",
  description,
  maxFiles,
  multiple = true,
  disabled = false,
  compact = false,
  className,
}: UploadDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [items, dispatch] = useReducer(reducer, []);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const meta = useMeta();

  const maxBytes = meta.data?.limits.max_upload_bytes ?? FALLBACK_MAX_BYTES;
  const maxPerRequest = meta.data?.limits.max_files_per_request ?? FALLBACK_MAX_FILES;
  const maxRequestBytes = meta.data?.limits.max_request_bytes;
  const types = meta.data?.supported_formats ?? DEFAULT_TYPES;

  // Latest props for the async upload loop, so it never closes over stale values.
  const latest = useRef({ url, fields, onBatch, onComplete });
  useEffect(() => {
    latest.current = { url, fields, onBatch, onComplete };
  });
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (queue: UploadItem[]) => {
      if (queue.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setAnnouncement(`Uploading ${pluralize(queue.length, "file")}.`);

      // Split by count, then by total bytes when the API publishes a request limit.
      const batches: UploadItem[][] = [];
      for (const group of chunk(queue, maxPerRequest)) {
        let current: UploadItem[] = [];
        let bytes = 0;
        for (const item of group) {
          if (current.length > 0 && maxRequestBytes && bytes + item.file.size > maxRequestBytes * 0.95) {
            batches.push(current);
            current = [];
            bytes = 0;
          }
          current.push(item);
          bytes += item.file.size;
        }
        if (current.length > 0) batches.push(current);
      }

      const accepted: UploadResult[] = [];
      const rejected: UploadResult[] = [];
      let failed = 0;

      for (const batch of batches) {
        const keys = batch.map((i) => i.key);
        if (controller.signal.aborted) {
          dispatch({ type: "patch", keys, patch: { status: "cancelled", reason: "Upload cancelled." } });
          continue;
        }
        dispatch({ type: "patch", keys, patch: { status: "uploading", progress: 0 } });
        // Cumulative byte offsets let one request-level progress event drive per-file bars.
        const total = batch.reduce((sum, i) => sum + i.file.size, 0) || 1;
        const ends: number[] = [];
        batch.reduce((sum, i) => {
          ends.push(sum + i.file.size);
          return sum + i.file.size;
        }, 0);
        try {
          const response = await uploadFiles<UploadResponse>({
            url: latest.current.url,
            fields: latest.current.fields,
            files: batch.map((i) => i.file),
            signal: controller.signal,
            onProgress: ({ fraction }) => {
              const sent = fraction * total;
              batch.forEach((item, idx) => {
                const start = idx === 0 ? 0 : ends[idx - 1];
                const p = Math.max(0, Math.min(1, (sent - start) / (item.file.size || 1)));
                dispatch({
                  type: "patch",
                  keys: [item.key],
                  patch: p >= 1 ? { status: "processing", progress: 1 } : { status: "uploading", progress: p },
                });
              });
            },
          });
          const results = response.results ?? [];
          batch.forEach((item, idx) => {
            // Results come back in request order; fall back to a filename match.
            const result =
              results[idx]?.filename === item.file.name
                ? results[idx]
                : (results.find((r) => r.filename === item.file.name) ?? results[idx]);
            if (!result) {
              failed += 1;
              dispatch({ type: "patch", keys: [item.key], patch: { status: "failed", reason: "The server returned no result for this file." } });
              return;
            }
            (result.accepted ? accepted : rejected).push(result);
            dispatch({
              type: "patch",
              keys: [item.key],
              patch: {
                status: result.accepted ? "accepted" : "rejected",
                progress: 1,
                result,
                reason: result.accepted ? undefined : (result.error?.message ?? "The file was not accepted."),
              },
            });
          });
          latest.current.onBatch?.(response);
        } catch (err) {
          if (isAbortError(err)) {
            dispatch({ type: "patch", keys, patch: { status: "cancelled", reason: "Upload cancelled." } });
          } else {
            failed += batch.length;
            dispatch({ type: "patch", keys, patch: { status: "failed", reason: errorMessage(err) } });
          }
        }
      }

      abortRef.current = null;
      setBusy(false);
      const parts = [`${accepted.length} accepted`];
      if (rejected.length) parts.push(`${rejected.length} rejected`);
      if (failed) parts.push(`${failed} failed`);
      setAnnouncement(
        controller.signal.aborted ? `Upload cancelled. ${parts.join(", ")}.` : `Upload finished: ${parts.join(", ")}.`,
      );
      latest.current.onComplete?.({ accepted, rejected, failed });
    },
    [maxPerRequest, maxRequestBytes],
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (disabled || busy) return;
      let files = Array.from(list);
      if (!multiple) files = files.slice(0, 1);
      const next: UploadItem[] = files.map((file, index) => {
        const key = `u${++counter}`;
        const typeOk = file.type ? types.includes(file.type) : ACCEPT_EXT.test(file.name);
        if (!typeOk) {
          return { key, file, status: "rejected", progress: 0, reason: "Unsupported format. Only JPEG and PNG images can be analysed." };
        }
        if (file.size > maxBytes) {
          return { key, file, status: "rejected", progress: 0, reason: `File is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)} per image.` };
        }
        if (file.size === 0) {
          return { key, file, status: "rejected", progress: 0, reason: "The file is empty." };
        }
        if (maxFiles !== undefined && index >= maxFiles) {
          return { key, file, status: "rejected", progress: 0, reason: `Only ${pluralize(maxFiles, "more file")} can be added here.` };
        }
        return { key, file, status: "queued", progress: 0 };
      });
      dispatch({ type: "add", items: next });
      void run(next.filter((i) => i.status === "queued"));
    },
    [busy, disabled, maxBytes, maxFiles, multiple, run, types],
  );

  const retryFailed = () => {
    const retry = items.filter((i) => i.status === "failed" || i.status === "cancelled");
    dispatch({ type: "patch", keys: retry.map((i) => i.key), patch: { status: "queued", progress: 0, reason: undefined } });
    void run(retry.map((i) => ({ ...i, status: "queued" as const, progress: 0, reason: undefined })));
  };

  const counts = {
    accepted: items.filter((i) => i.status === "accepted").length,
    rejected: items.filter((i) => i.status === "rejected").length,
    retryable: items.filter((i) => i.status === "failed" || i.status === "cancelled").length,
    done: items.filter((i) => !["queued", "uploading", "processing"].includes(i.status)).length,
  };
  const inactive = disabled || busy;
  const limitsLine = `JPEG or PNG, up to ${formatBytes(maxBytes, 0)} each.`;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!inactive) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center transition-colors duration-150",
          compact ? "py-6" : "py-10",
          dragging ? "border-brand bg-brand-subtle" : "border-input bg-surface/60",
          inactive && "opacity-60",
        )}
      >
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10">
          <Upload aria-hidden="true" className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">{title}</p>
        <p id={`${inputId}-hint`} className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {description ? `${description} ` : ""}
          {limitsLine}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={inactive} onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          {busy ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
              Cancel upload
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={[...types, ".jpg", ".jpeg", ".png"].join(",")}
          multiple={multiple}
          disabled={inactive}
          aria-label={title}
          aria-describedby={`${inputId}-hint`}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {items.length > 0 ? (
        <section aria-label="Upload results" className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {busy ? (
                <>
                  Uploading: {counts.done} of {items.length} processed
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{counts.accepted} accepted</span>
                  {counts.rejected ? <>, {counts.rejected} rejected</> : null}
                  {counts.retryable ? <>, {counts.retryable} not uploaded</> : null}
                </>
              )}
            </p>
            {!busy ? (
              <div className="flex items-center gap-1">
                {counts.retryable ? (
                  <Button type="button" variant="outline" size="xs" onClick={retryFailed}>
                    Retry {pluralize(counts.retryable, "file")}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="xs" onClick={() => dispatch({ type: "clear" })}>
                  Clear list
                </Button>
              </div>
            ) : null}
          </header>
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const { status, file, result, reason } = item;
  const warnings = result?.warnings ?? [];
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 text-sm">
      <span className="mt-0.5 shrink-0">
        {status === "accepted" ? (
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
        ) : status === "rejected" || status === "failed" ? (
          <CircleX aria-hidden="true" className="size-4 text-danger" />
        ) : status === "cancelled" ? (
          <Ban aria-hidden="true" className="size-4 text-muted-foreground" />
        ) : status === "queued" ? (
          <FileImage aria-hidden="true" className="size-4 text-muted-foreground" />
        ) : (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-brand" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium" title={file.name}>
            {file.name}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        </div>
        {status === "uploading" ? (
          <Progress value={Math.round(item.progress * 100)} aria-label={`Uploading ${file.name}`} className="mt-1.5" />
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {status === "queued" ? "Waiting" : null}
          {status === "uploading" ? `Uploading ${Math.round(item.progress * 100)}%` : null}
          {status === "processing" ? "Checking the image" : null}
          {status === "accepted" ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className="font-medium text-success">Accepted</span>
              {result?.sha256 ? <Hash value={result.sha256} chars={6} /> : null}
            </span>
          ) : null}
          {status === "rejected" ? (
            <span>
              <span className="font-medium text-danger">Rejected: </span>
              {reason}
            </span>
          ) : null}
          {status === "failed" ? (
            <span>
              <span className="font-medium text-danger">Not uploaded: </span>
              {reason}
            </span>
          ) : null}
          {status === "cancelled" ? reason : null}
        </p>
        {warnings.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-xs leading-relaxed text-warning">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <span className="text-foreground/80">{w}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
