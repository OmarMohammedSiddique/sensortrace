"use client";

import { ChartColumn, CircleCheck, ClipboardList, Lightbulb, Upload } from "lucide-react";

import { QualityFlags } from "@/components/st/quality-flags";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReferences } from "@/lib/api/hooks";
import type { QualityFlag, QualitySeverity, ReferenceImage, Sensor } from "@/lib/api/types";
import { formatNumber, pluralize } from "@/lib/format";

import { metric } from "./fingerprint-types";
import { ReferenceBarChart, type ReferencePoint } from "./reference-chart";
import { ALL_REFERENCES, dimensionGroups } from "./sensor-references";
import { Notice, Panel } from "./shared";

const SEVERITY_ORDER: QualitySeverity[] = ["severe", "warning", "info"];

interface FlagGroup {
  code: string;
  severity: QualitySeverity;
  /** One example message from the API for this flag code. */
  message: string;
  count: number;
}

/** Counts how many references carry each quality flag, most severe and most common first. */
function groupFlags(refs: ReferenceImage[]): FlagGroup[] {
  const groups = new Map<string, FlagGroup>();
  for (const r of refs) {
    for (const f of (r.quality?.flags ?? []) as QualityFlag[]) {
      const g = groups.get(f.code);
      if (g) g.count += 1;
      else groups.set(f.code, { code: f.code, severity: f.severity, message: f.message, count: 1 });
    }
  }
  return [...groups.values()].toSorted(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.count - a.count,
  );
}

/** What to do about a flag, in plain language. Keyed by the API's flag codes; unknown codes show the API message only. */
const ADVICE: Record<string, string> = {
  very_low_resolution: "Use the sensor's full native resolution. Very small images contain too few pixels to compare.",
  low_resolution: "Use the sensor's full native resolution. Small images contain fewer pixels to compare, which weakens every result.",
  heavy_saturation: "Reduce exposure until nothing is blown out. Clipped white areas carry no pattern at all.",
  saturation: "Reduce exposure until nothing is blown out. Clipped white areas carry no pattern at all.",
  very_dark: "Expose more brightly. The sensor pattern scales with brightness, so dark images contribute little.",
  strong_jpeg_compression: "Upload the original files from the camera at its highest quality setting. Recompressed copies lose most of the pattern.",
  jpeg_compression: "Upload the original files from the camera at its highest quality setting. Recompressed copies lose part of the pattern.",
  high_texture: "Photograph something featureless (an out-of-focus overcast sky, a plain wall, a sheet of paper) so scene detail does not leak into the fingerprint.",
  png_container: "Upload the file the camera wrote, normally a JPEG. Screenshots, exports and conversions may not contain the pattern.",
  editing_software: "Use files straight from the camera. Images saved by an editor or sharing app may be resampled or shifted.",
  digital_zoom: "Retake these at the lens's native 1x setting. Digitally zoomed images are resampled and do not line up with the sensor grid.",
  dimension_mismatch: "Use files that have not been resized or cropped after capture.",
  custom_rendering: "Turn off HDR, portrait, night, panorama and similar modes for reference images.",
  composite_image: "Turn off multi-frame modes for reference images so each file is a single exposure.",
};

function range(values: number[]): { min: number; max: number; mean: number } | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / values.length };
}

function series(refs: ReferenceImage[], key: string, scale = 1): ReferencePoint[] {
  return refs.map((r, i) => {
    const v = metric(r.quality, key);
    return { n: i + 1, name: r.filename, value: v === null ? null : v * scale };
  });
}

function summaryText(label: string, points: ReferencePoint[], format: (v: number) => string): string {
  const r = range(points.flatMap((p) => (p.value === null ? [] : [p.value])));
  return r
    ? `Bar chart of ${label} for ${points.length} reference images: lowest ${format(r.min)}, highest ${format(r.max)}, average ${format(r.mean)}. All values are in the table that follows.`
    : `No ${label} values are available.`;
}

export function QualityTab({ sensor, onTab }: { sensor: Sensor; onTab: (tab: string) => void }) {
  const references = useReferences(sensor.id, ALL_REFERENCES);

  if (references.isPending) {
    return (
      <div role="status" aria-label="Loading quality data" className="flex flex-col gap-6">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (references.isError) {
    return <ErrorState title="Could not load reference quality" error={references.error} onRetry={() => void references.refetch()} retrying={references.isFetching} />;
  }

  const refs = references.data.items;
  if (refs.length === 0) {
    return (
      <EmptyState
        icon={ChartColumn}
        title="No reference images to assess"
        description="Quality measurements appear here once reference images are uploaded for this sensor."
        action={
          <Button onClick={() => onTab("references")}>
            <Upload aria-hidden="true" /> Add reference images
          </Button>
        }
      />
    );
  }

  const intensity = series(refs, "mean_intensity");
  const saturated = series(refs, "saturated_fraction", 100);
  const texture = series(refs, "texture_index");
  const flags = groupFlags(refs);
  const actionable = flags.filter((f) => f.severity !== "info");
  const clean = refs.filter((r) => ((r.quality?.flags ?? []) as QualityFlag[]).every((f) => f.severity === "info")).length;
  const groups = dimensionGroups(refs);
  const fmt0 = (v: number) => formatNumber(v, 0);
  const fmt1 = (v: number) => formatNumber(v, 1);
  const fmtPct = (v: number) => `${formatNumber(v, 2)}%`;

  return (
    <div className="flex flex-col gap-6">
      <Panel title="What to improve" icon={Lightbulb}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed" aria-live="polite">
            <span className="font-medium">
              {clean === refs.length
                ? `None of the ${pluralize(refs.length, "reference image")} has a quality warning.`
                : `${formatNumber(refs.length - clean)} of ${pluralize(refs.length, "reference image")} ${refs.length - clean === 1 ? "has" : "have"} at least one quality warning.`}
            </span>{" "}
            <span className="text-muted-foreground">
              Warnings do not stop a fingerprint from being built, but each one makes it weaker than it could be.
            </span>
          </p>
          {actionable.length === 0 && groups.length <= 1 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck aria-hidden="true" className="size-4 text-success" />
              Nothing to fix. Adding more images of the same kind still strengthens the fingerprint.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {groups.length > 1 ? (
                <li>
                  <Notice tone="warning" title={`Mixed dimensions: ${groups.map((g) => `${g.width} × ${g.height} (${g.count})`).join(", ")}`}>
                    Only the largest group with the same dimensions is used. Move the other images to a sensor entry of
                    their own, or delete them.
                  </Notice>
                </li>
              ) : null}
              {actionable.map((f) => (
                <li key={f.code}>
                  <Notice tone={f.severity === "severe" ? "danger" : "warning"} title={`${formatNumber(f.count)} of ${formatNumber(refs.length)} images: ${f.message}`}>
                    {ADVICE[f.code] ?? null}
                  </Notice>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Mean intensity" icon={ChartColumn}>
          <ReferenceBarChart data={intensity} label="Mean intensity" format={fmt0} summary={summaryText("mean intensity (0 to 255)", intensity, fmt0)} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Average brightness on a 0 to 255 scale. Brighter images carry more of the sensor pattern, as long as they
            are not clipped.
          </p>
        </Panel>
        <Panel title="Saturated fraction" icon={ChartColumn}>
          <ReferenceBarChart data={saturated} label="Saturated pixels (%)" color="var(--chart-3)" format={fmtPct} summary={summaryText("saturated pixel percentage", saturated, fmtPct)} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Share of pixels clipped to pure white. Clipped pixels contain no pattern, so lower is better and zero is
            ideal.
          </p>
        </Panel>
        <Panel title="Texture index" icon={ChartColumn}>
          <ReferenceBarChart data={texture} label="Texture index" color="var(--chart-2)" format={fmt1} summary={summaryText("texture index", texture, fmt1)} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            How much fine scene detail the image contains. Lower is better: flat, featureless scenes leave the sensor
            pattern cleanest.
          </p>
        </Panel>
      </div>

      <Panel title="Per-image measurements" icon={ClipboardList} flush>
        <div className="max-h-[32rem] overflow-auto">
          <Table>
            <caption className="sr-only">Quality measurements for every reference image of this sensor</caption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="eyebrow h-9 w-10 bg-muted/40">#</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40">Reference</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40 text-right">Dimensions</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40 text-right">Mean intensity</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40 text-right">Saturated</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40 text-right">Texture index</TableHead>
                <TableHead scope="col" className="eyebrow h-9 bg-muted/40">Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refs.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <span className="block max-w-[16rem] truncate" title={r.filename}>
                      {r.filename}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                    {r.width} × {r.height}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{intensity[i].value === null ? "-" : fmt1(intensity[i].value as number)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{saturated[i].value === null ? "-" : fmtPct(saturated[i].value as number)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{texture[i].value === null ? "-" : fmt1(texture[i].value as number)}</TableCell>
                  <TableCell>
                    <QualityFlags quality={r.quality} variant="summary" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </div>
  );
}
