"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";

import { formatSmall } from "@/lib/format";
import { cn } from "@/lib/utils";

type RGB = [number, number, number];

/**
 * Diverging scale centred on zero: negative values run to a warm ochre, positive values
 * to the indigo accent, zero is the card surface. The hues are chosen to be distinguishable
 * under the common colour-vision deficiencies and to avoid the verdict colours.
 */
const SCALES: Record<"light" | "dark", { neg: RGB; zero: RGB; pos: RGB; cross: string }> = {
  light: { neg: [176, 98, 22], zero: [250, 250, 251], pos: [49, 62, 168], cross: "rgba(24,24,27,0.55)" },
  dark: { neg: [224, 158, 82], zero: [30, 30, 34], pos: [150, 168, 255], cross: "rgba(244,244,245,0.6)" },
};

function mix(a: RGB, b: RGB, t: number): string {
  // Slight gamma on t keeps small values near zero visibly tinted.
  const k = Math.pow(Math.max(0, Math.min(1, t)), 0.8);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

export interface SurfaceStats {
  rows: number;
  cols: number;
  centre: number;
  max: number;
  maxRow: number;
  maxCol: number;
  min: number;
  /** Largest absolute value: the colour scale spans [-absMax, +absMax]. */
  absMax: number;
}

/** Summary numbers for a surface window (also useful for text next to the plot). */
export function surfaceStats(surface: number[][] | null | undefined): SurfaceStats | null {
  if (!surface?.length || !surface[0]?.length) return null;
  const rows = surface.length;
  const cols = surface[0].length;
  let max = -Infinity;
  let min = Infinity;
  let maxRow = 0;
  let maxCol = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = surface[r][c];
      if (!Number.isFinite(v)) continue;
      if (v > max) {
        max = v;
        maxRow = r;
        maxCol = c;
      }
      if (v < min) min = v;
    }
  }
  if (!Number.isFinite(max)) return null;
  const centre = surface[Math.floor(rows / 2)][Math.floor(cols / 2)];
  return { rows, cols, centre, max, maxRow, maxCol, min, absMax: Math.max(Math.abs(max), Math.abs(min)) || 1 };
}

export interface CorrelationSurfaceProps {
  /** `measurement.surface_window`: a square (33x33) window of the correlation surface. */
  surface: number[][] | null | undefined;
  /** Rendered edge length in CSS pixels (default 264 = 8 px per cell). The plot scales down to fit. */
  size?: number;
  /** Extra context for the accessible summary, e.g. "Demo camera A / Main sensor". */
  label?: string;
  /** Hide the visible caption + legend (the accessible summary stays). */
  hideCaption?: boolean;
  className?: string;
}

/**
 * Heat-map of the correlation surface around the tested alignment. A sensor match shows
 * as a single sharp peak at the centre; unrelated noise shows no structure. The colour
 * scale is symmetric about zero and normalised to this window's largest absolute value,
 * so colours are NOT comparable between two plots: read the numbers in the caption.
 */
export function CorrelationSurface({ surface, size = 264, label, hideCaption = false, className }: CorrelationSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const stats = useMemo(() => surfaceStats(surface), [surface]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !surface || !stats) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = SCALES[theme];
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cell = Math.max(1, Math.round((size * dpr) / stats.cols));
    canvas.width = cell * stats.cols;
    canvas.height = cell * stats.rows;
    for (let r = 0; r < stats.rows; r++) {
      for (let c = 0; c < stats.cols; c++) {
        const v = surface[r][c];
        const t = Number.isFinite(v) ? v / stats.absMax : 0;
        ctx.fillStyle = t >= 0 ? mix(scale.zero, scale.pos, t) : mix(scale.zero, scale.neg, -t);
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    // Corner ticks around the centre cell (the tested alignment), leaving the cell visible.
    const cr = Math.floor(stats.rows / 2);
    const cc = Math.floor(stats.cols / 2);
    const x = cc * cell;
    const y = cr * cell;
    const arm = cell * 1.5;
    const gap = cell * 0.75;
    ctx.strokeStyle = scale.cross;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(x + cell / 2, y - gap - arm);
    ctx.lineTo(x + cell / 2, y - gap);
    ctx.moveTo(x + cell / 2, y + cell + gap);
    ctx.lineTo(x + cell / 2, y + cell + gap + arm);
    ctx.moveTo(x - gap - arm, y + cell / 2);
    ctx.lineTo(x - gap, y + cell / 2);
    ctx.moveTo(x + cell + gap, y + cell / 2);
    ctx.lineTo(x + cell + gap + arm, y + cell / 2);
    ctx.stroke();
  }, [surface, stats, theme, size]);

  if (!surface || !stats) {
    return (
      <div
        className={cn(
          "flex aspect-square items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground",
          className,
        )}
        style={{ width: size, maxWidth: "100%" }}
      >
        No correlation surface available
      </div>
    );
  }

  const half = Math.floor(stats.cols / 2);
  const dx = stats.maxCol - Math.floor(stats.cols / 2);
  const dy = stats.maxRow - Math.floor(stats.rows / 2);
  const peakAtCentre = dx === 0 && dy === 0;
  const summary =
    `Correlation surface${label ? ` for ${label}` : ""}, ${stats.rows} by ${stats.cols} cells around the tested alignment. ` +
    `Value at the centre: ${formatSmall(stats.centre)}. ` +
    `Maximum in the window: ${formatSmall(stats.max)}, ` +
    (peakAtCentre ? "located at the centre." : `located ${Math.abs(dx)} cells ${dx < 0 ? "left" : "right"} and ${Math.abs(dy)} cells ${dy < 0 ? "up" : "down"} from the centre.`) +
    ` Minimum: ${formatSmall(stats.min)}.`;
  const scale = SCALES[theme];

  return (
    <figure className={cn("inline-flex max-w-full flex-col gap-2", className)} style={{ width: size }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        className="aspect-square w-full rounded-md ring-1 ring-foreground/10 [image-rendering:pixelated]"
      />
      {hideCaption ? null : (
        <figcaption className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="font-mono">-{formatSmall(stats.absMax, 2)}</span>
            <span
              className="h-1.5 flex-1 rounded-full ring-1 ring-foreground/10"
              style={{
                background: `linear-gradient(to right, rgb(${scale.neg.join(",")}), rgb(${scale.zero.join(",")}), rgb(${scale.pos.join(",")}))`,
              }}
            />
            <span className="font-mono">+{formatSmall(stats.absMax, 2)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div className="flex justify-between gap-2">
              <dt>Centre</dt>
              <dd className="font-mono text-foreground">{formatSmall(stats.centre)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Maximum</dt>
              <dd className="font-mono text-foreground">{formatSmall(stats.max)}</dd>
            </div>
          </dl>
          <p className="leading-relaxed">
            {peakAtCentre
              ? "The largest value in this window is at the centre (the tested alignment)."
              : `The largest value in this window is ${Math.abs(dx)} cells ${dx < 0 ? "left" : "right"}, ${Math.abs(dy)} cells ${dy < 0 ? "up" : "down"} of the centre.`}{" "}
            Window of &plusmn;{half} cells; colours are scaled to this window only.
          </p>
        </figcaption>
      )}
    </figure>
  );
}
