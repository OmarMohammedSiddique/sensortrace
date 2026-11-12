"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Candidate, PolicySnapshot, Verdict } from "@/lib/api/types";
import { VERDICT_LABELS } from "@/lib/domain";
import { formatNumber, formatPce } from "@/lib/format";

/** Symmetric log: linear near zero, logarithmic for large magnitudes, defined for negatives. */
export function symlog(x: number): number {
  return Math.sign(x) * Math.log10(1 + Math.abs(x));
}

const VERDICT_FILL: Record<Verdict, string> = {
  match_supported: "var(--match)",
  non_match_supported: "var(--nonmatch)",
  inconclusive: "var(--inconclusive)",
  insufficient_or_unsupported: "var(--unsuitable)",
};

const CONFIG = { value: { label: "Adjusted statistic" } } satisfies ChartConfig;
const TICK_CANDIDATES = [-1e9, -1e6, -1000, -100, -10, 0, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];

interface Row {
  rank: string;
  name: string;
  real: number;
  value: number;
  verdict: Verdict;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${value / 1e9}B`;
  if (abs >= 1e6) return `${value / 1e6}M`;
  if (abs >= 1e4) return `${value / 1e3}k`;
  return formatNumber(value);
}

/**
 * Horizontal bars of the adjusted statistic per candidate on a symmetric-log scale, with the
 * policy's two lines. Colour repeats the verdict shown as text in the ranking table, which is
 * the accessible alternative to this chart.
 */
export function CandidateChart({ candidates, policy }: { candidates: Candidate[]; policy: PolicySnapshot }) {
  const mobile = useIsMobile();
  const rows: Row[] = candidates.flatMap((c) =>
    typeof c.effective_pce === "number" && Number.isFinite(c.effective_pce)
      ? [
          {
            rank: `#${c.rank}`,
            name: `${c.snapshot.device_name ?? "Device"} / ${c.snapshot.sensor_name ?? "sensor"}`,
            real: c.effective_pce,
            value: symlog(c.effective_pce),
            verdict: c.verdict,
          },
        ]
      : [],
  );
  const untested = candidates.length - rows.length;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidate produced a statistic, so there is nothing to plot.</p>;
  }

  const match = policy.match_threshold;
  const nonMatch = policy.non_match_threshold;
  const reals = [...rows.map((r) => r.real), 0, ...(match !== undefined ? [match] : []), ...(nonMatch !== undefined ? [nonMatch] : [])];
  const lo = Math.min(...reals);
  const hi = Math.max(...reals);
  const domain: [number, number] = [lo < 0 ? symlog(lo) * 1.08 : 0, symlog(hi) * 1.08];
  const thresholdValues = [match, nonMatch].filter((v): v is number => v !== undefined);
  // Round-number ticks, skipping any that would collide with a threshold label.
  const ticks = TICK_CANDIDATES.filter(
    (t) => symlog(t) >= domain[0] && symlog(t) <= domain[1] && !thresholdValues.some((th) => th !== t && Math.abs(symlog(th) - symlog(t)) < (domain[1] - domain[0]) * 0.06),
  ).map(symlog);

  return (
    <figure className="min-w-0">
      <ChartContainer config={CONFIG} className="aspect-auto w-full" style={{ height: Math.max(150, 76 + rows.length * 38) }}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 22, right: 20, bottom: 0, left: 0 }}
          accessibilityLayer
          aria-label={`Adjusted statistic per candidate on a symmetric logarithmic scale. ${rows.map((r) => `${r.rank} ${r.name}: ${formatPce(r.real)}, ${VERDICT_LABELS[r.verdict]}`).join(". ")}.`}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" dataKey="value" domain={domain} ticks={ticks} tickFormatter={(v: number) => compact(Math.round(Math.sign(v) * (10 ** Math.abs(v) - 1)))} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey={mobile ? "rank" : "name"}
            width={mobile ? 30 : 150}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium">
                    {row.rank} {row.name}
                  </p>
                  <p className="mt-0.5 font-mono">Adjusted statistic {formatPce(row.real)}</p>
                  <p className="text-muted-foreground">{VERDICT_LABELS[row.verdict]}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={2} barSize={16} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.rank} fill={VERDICT_FILL[r.verdict]} />
            ))}
          </Bar>
          {nonMatch !== undefined ? (
            <ReferenceLine
              x={symlog(nonMatch)}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 3"
              label={{ value: `Non-match line ${formatNumber(nonMatch, 2)}`, position: "top", fontSize: 10, fill: "var(--muted-foreground)", textAnchor: "end", dx: 4 }}
            />
          ) : null}
          {match !== undefined ? (
            <ReferenceLine
              x={symlog(match)}
              stroke="var(--foreground)"
              strokeDasharray="5 3"
              label={{ value: `Match line ${formatNumber(match, 2)}`, position: "top", fontSize: 10, fill: "var(--foreground)", textAnchor: "start", dx: -4 }}
            />
          ) : null}
        </BarChart>
      </ChartContainer>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Adjusted statistic per candidate. The axis is compressed (symmetric logarithmic) so that values near the lines and values in the tens of
        thousands are both readable: equal distances are equal ratios, not equal differences.{" "}
        {policy.calibrated ? "The lines are the policy's calibrated thresholds." : "The lines are uncalibrated reference lines; no error rate is attached to them."}
        {untested > 0 ? ` ${formatNumber(untested)} candidate${untested === 1 ? " is" : "s are"} not plotted because no test could be performed.` : ""} Exact values
        are in the table.
      </figcaption>
    </figure>
  );
}
