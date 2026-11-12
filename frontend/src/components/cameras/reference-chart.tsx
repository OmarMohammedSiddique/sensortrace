"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export interface ReferencePoint {
  /** Position in the reference set, starting at 1. */
  n: number;
  /** Filename (or hash) shown in the tooltip. */
  name: string;
  value: number | null;
}

/**
 * One bar per reference image. Always pair it with a table of the same values: the chart
 * itself is exposed to assistive technology only through `summary`.
 */
export function ReferenceBarChart({
  data,
  label,
  summary,
  color = "var(--chart-1)",
  format,
  className,
}: {
  data: ReferencePoint[];
  /** Series name, e.g. "Leave-one-out PCE". */
  label: string;
  /** One-sentence text alternative. */
  summary: string;
  color?: string;
  format: (value: number) => string;
  className?: string;
}) {
  const config = { value: { label, color } } satisfies ChartConfig;
  return (
    <figure className={className}>
      <ChartContainer config={config} role="img" aria-label={summary} className="aspect-auto h-52 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="n" tickLine={false} axisLine={false} tickMargin={6} minTickGap={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => compact(v)}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as ReferencePoint | undefined;
                  return p ? `${p.n}. ${p.name}` : "";
                }}
                formatter={(value) => (
                  <span className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium">{typeof value === "number" ? format(value) : "-"}</span>
                  </span>
                )}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">
        {label} by reference image (numbered in upload order)
      </figcaption>
    </figure>
  );
}

function compact(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1000) return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  if (abs >= 10 || abs === 0) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
