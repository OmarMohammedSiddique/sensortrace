"use client";

import { Camera, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useMemo } from "react";

import { DemoBadge } from "@/components/st/demo-badge";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Evidence, Page, Sensor } from "@/lib/api/types";
import { PIPELINE_LABELS } from "@/lib/domain";
import { formatNumber, humanize, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { modelKey, predictGeometry } from "./geometry";

interface SensorGroup {
  key: string;
  label: string;
  sensors: Sensor[];
  /** Distinct physical devices in the group: two or more can act as controls for each other. */
  devices: number;
}

function groupSensors(sensors: Sensor[]): SensorGroup[] {
  const groups = new Map<string, SensorGroup>();
  for (const s of sensors) {
    const key = modelKey(s.device_make, s.device_model) || `device:${s.device_id}`;
    const label = [s.device_make, s.device_model].filter(Boolean).join(" ") || "Make and model not recorded";
    const g = groups.get(key) ?? { key, label, sensors: [], devices: 0 };
    g.sensors.push(s);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.devices = new Set(g.sensors.map((s) => s.device_id)).size;
  return [...groups.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}

/** Guidance derived from the current selection. Every statement follows from loaded data. */
export function SelectionGuidance({ sensors, images }: { sensors: Sensor[]; images: Evidence[] }) {
  // Non-conventional sensors with no same-model sensor of ANOTHER device (same fingerprint size) selected.
  const needControl = sensors.filter((s) => {
    if (s.pipeline_class === "conventional") return false;
    const key = modelKey(s.device_make, s.device_model);
    return !sensors.some(
      (o) =>
        o.id !== s.id &&
        o.device_id !== s.device_id &&
        key !== "" &&
        modelKey(o.device_make, o.device_model) === key &&
        o.active_fingerprint?.width === s.active_fingerprint?.width &&
        o.active_fingerprint?.height === s.active_fingerprint?.height,
    );
  });

  const cropped: string[] = [];
  const unsupported: string[] = [];
  for (const image of images) {
    for (const s of sensors) {
      const fp = s.active_fingerprint;
      if (!fp?.width || !fp.height) continue;
      const g = predictGeometry(image.width, image.height, fp.width, fp.height);
      const line = `${image.filename} (${image.width}×${image.height}) against ${s.device_name} / ${s.name} (${fp.width}×${fp.height})`;
      if (g === "cropped") cropped.push(line);
      if (g === "unsupported") unsupported.push(line);
    }
  }

  if (needControl.length === 0 && cropped.length === 0 && unsupported.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {needControl.length > 0 ? (
        <Notice tone="warning" title="A match cannot be supported for these sensors without a same-model control">
          <p>
            {needControl.map((s) => `${s.device_name} / ${s.name}`).join("; ")}{" "}
            {needControl.length === 1 ? "belongs to a device whose pipeline is" : "belong to devices whose pipelines are"} not declared conventional.
            Different units of the same recent phone model often share processing artefacts, so a high statistic alone does not single out one
            physical sensor. Without a control the outcome for a high statistic will be Inconclusive.
          </p>
          <p className="mt-1.5">
            To address this, enrol a second physical device of the same make and model in the{" "}
            <Link href="/app/cameras" className="font-medium text-foreground underline underline-offset-4">
              camera laboratory
            </Link>{" "}
            and select its sensor here as well. It must have the same fingerprint size.
          </p>
        </Notice>
      ) : null}
      {unsupported.length > 0 ? (
        <Notice tone="warning" title={`${pluralize(unsupported.length, "pair")} cannot be tested: the image is larger than the fingerprint`}>
          <p>
            An image larger than the fingerprint cannot be a crop of that sensor&apos;s output at this resolution. It may have been resized, or come
            from a different sensor or capture mode. Those pairs will be reported as &ldquo;Insufficient quality or unsupported analysis&rdquo; with
            no statistic.
          </p>
          <PairList items={unsupported} />
        </Notice>
      ) : null}
      {cropped.length > 0 ? (
        <Notice tone="info" title={`${pluralize(cropped.length, "pair")} will use the experimental crop search`}>
          <p>
            The image is smaller than the fingerprint, so every possible position is searched. The statistic is adjusted for the number of positions
            tried, the comparison takes longer, and a non-match conclusion is not available for crops.
          </p>
          <PairList items={cropped} />
        </Notice>
      ) : null}
    </div>
  );
}

function PairList({ items }: { items: string[] }) {
  const shown = items.slice(0, 4);
  return (
    <ul className="mt-1.5 list-disc pl-4 font-mono text-[0.6875rem] leading-relaxed">
      {shown.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
      {items.length > shown.length ? <li className="list-none font-sans">and {formatNumber(items.length - shown.length)} more</li> : null}
    </ul>
  );
}

function Notice({ tone, title, children }: { tone: "warning" | "info"; title: string; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div className={cn("rounded-md border px-3 py-2.5 text-xs leading-relaxed", tone === "warning" ? "border-warning-border bg-warning-subtle" : "border-border bg-muted/40")}>
      <p className="flex items-start gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
        {title}
      </p>
      <div className="mt-1 pl-6 text-muted-foreground">{children}</div>
    </div>
  );
}

export interface SensorStepProps {
  query: UseQueryResult<Page<Sensor>>;
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  /** API limit on candidates per comparison (`meta.limits.max_candidates_per_analysis`). */
  maxCandidates: number | undefined;
}

export function SensorStep({ query, selected, onChange, maxCandidates }: SensorStepProps) {
  const id = useId();
  const sensors = query.data?.items;
  const groups = useMemo(() => groupSensors(sensors ?? []), [sensors]);

  if (query.isError) return <ErrorState variant="inline" error={query.error} title="Could not load sensors" onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  if (!sensors) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading sensors">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (sensors.length === 0) {
    return (
      <EmptyState
        variant="plain"
        icon={Camera}
        title="No sensor has a fingerprint yet"
        description="A comparison needs at least one enrolled sensor with a ready fingerprint. Register a camera, add reference images and estimate its fingerprint in the camera laboratory."
        action={
          <Button asChild>
            <Link href="/app/cameras">Open the camera laboratory</Link>
          </Button>
        }
      />
    );
  }

  const limit = maxCandidates ?? sensors.length;
  const allIds = sensors.slice(0, limit).map((s) => s.id);
  const allSelected = allIds.length > 0 && allIds.every((x) => selected.includes(x));
  const atLimit = selected.length >= limit;
  const toggle = (sensorId: string, on: boolean) =>
    onChange((current) => (on ? (current.includes(sensorId) || current.length >= limit ? current : [...current, sensorId]) : current.filter((x) => x !== sensorId)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-all`} className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
          <Checkbox
            id={`${id}-all`}
            checked={allSelected}
            onCheckedChange={(v) => onChange(v === true ? allIds : [])}
          />
          Select all
        </label>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          <span className="font-mono">{selected.length}</span> of {formatNumber(sensors.length)} selected
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <fieldset key={group.key} className="overflow-hidden rounded-md border">
            <legend className="sr-only">{group.label}</legend>
            <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-medium">{group.label}</span>
              <span className="text-[0.6875rem] text-muted-foreground">
                {group.devices > 1 ? `${group.devices} devices of this make and model: they act as controls for each other` : "1 device of this make and model"}
              </span>
            </div>
            <ul className="divide-y">
              {group.sensors.map((s) => {
                const checked = selected.includes(s.id);
                const fp = s.active_fingerprint;
                const inputId = `${id}-${s.id}`;
                return (
                  <li key={s.id}>
                    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50", checked && "bg-brand-subtle/60")}>
                      <Checkbox id={inputId} className="mt-0.5" checked={checked} disabled={!checked && atLimit} onCheckedChange={(v) => toggle(s.id, v === true)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                          <span className="break-words">
                            {s.device_name} <span className="font-normal text-muted-foreground">/ {s.name}</span>
                          </span>
                          <DemoBadge when={s.is_demo} />
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <Badge variant={s.pipeline_class === "conventional" ? "outline" : "secondary"}>{PIPELINE_LABELS[s.pipeline_class ?? ""] ?? humanize(s.pipeline_class)}</Badge>
                          {fp ? (
                            <>
                              <span className="font-mono">
                                {formatNumber(fp.width)} × {formatNumber(fp.height)} px
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{pluralize(fp.n_images ?? 0, "reference image")} used</span>
                              <span aria-hidden="true">·</span>
                              <span>fingerprint v{fp.version}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      {atLimit && sensors.length > limit ? (
        <p className="text-xs text-warning">A comparison can include at most {formatNumber(limit)} sensors.</p>
      ) : null}
      {(query.data?.total ?? 0) > sensors.length ? (
        <p className="text-xs text-muted-foreground">Showing the first {formatNumber(sensors.length)} of {formatNumber(query.data?.total ?? 0)} ready sensors.</p>
      ) : null}
    </div>
  );
}
