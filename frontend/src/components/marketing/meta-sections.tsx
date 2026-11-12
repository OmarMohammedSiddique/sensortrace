"use client";

import { ErrorState } from "@/components/st/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeta } from "@/lib/api/hooks";
import type { GuidanceItem } from "@/lib/api/types";
import { formatBytes, formatNumber } from "@/lib/format";

function GuidanceGrid({ items, numbered }: { items: GuidanceItem[]; numbered?: boolean }) {
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/10 sm:grid-cols-2">
      {items.map((item, i) => (
        <li key={item.title} className="bg-card p-5">
          <h3 className="flex items-baseline gap-2.5 text-sm font-medium text-foreground">
            {numbered ? <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span> : null}
            {item.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

function MetaList({ pick, numbered }: { pick: "limitations" | "reference_guidance"; numbered?: boolean }) {
  const meta = useMeta();
  if (meta.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (meta.isError) {
    return (
      <ErrorState
        variant="inline"
        title="This list is served by the SensorTrace API, which could not be reached"
        error={meta.error}
        onRetry={() => void meta.refetch()}
        retrying={meta.isFetching}
      />
    );
  }
  return <GuidanceGrid items={meta.data[pick]} numbered={numbered} />;
}

/** Limitations as published by the running engine (GET /meta `limitations`). */
export function LimitationsList() {
  return <MetaList pick="limitations" />;
}

/** Reference-image guidance as published by the running engine (GET /meta `reference_guidance`). */
export function ReferenceGuidanceList() {
  return <MetaList pick="reference_guidance" numbered />;
}

/** Versions and limits of the running server. */
export function EngineFacts() {
  const meta = useMeta();
  if (meta.isPending) return <Skeleton className="h-32 w-full" />;
  if (meta.isError) {
    return <ErrorState variant="inline" title="Could not read server information" error={meta.error} onRetry={() => void meta.refetch()} />;
  }
  const m = meta.data;
  const rows: [string, string][] = [
    ["Engine version", m.engine_version],
    ["Algorithm version", m.algorithm_version],
    ["Decision policy version", m.decision_policy_version],
    ["Supported formats", m.supported_formats.map((f) => f.replace("image/", "").toUpperCase()).join(", ")],
    ["Largest image file", formatBytes(m.limits.max_upload_bytes, 0)],
    ["Largest image", `${formatNumber(m.limits.max_image_pixels / 1_000_000)} megapixels`],
    ["Reference images per sensor", `${m.limits.min_reference_images} minimum, ${m.limits.recommended_reference_images} recommended, ${m.limits.max_reference_images} maximum`],
    ["Sensors compared per analysis", `up to ${m.limits.max_candidates_per_analysis}`],
  ];
  return (
    <dl className="divide-y overflow-hidden rounded-lg bg-card text-sm ring-1 ring-foreground/10">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[16rem_1fr]">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-[0.8125rem] text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
