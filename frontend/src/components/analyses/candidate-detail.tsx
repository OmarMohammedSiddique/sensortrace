"use client";

import { CircleCheck, FlaskConical, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { CorrelationSurface } from "@/components/st/correlation-surface";
import { DemoBadge } from "@/components/st/demo-badge";
import { Hash } from "@/components/st/hash";
import { PolicyNotice } from "@/components/st/policy-notice";
import { VerdictBadge } from "@/components/st/verdict-badge";
import { Badge } from "@/components/ui/badge";
import type { Candidate, PolicySnapshot } from "@/lib/api/types";
import { PIPELINE_LABELS } from "@/lib/domain";
import { formatNumber, formatPce, formatSmall, humanize, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { explainNua, formatScientific, GEOMETRY, rotationLabel } from "./explain";

function Row({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,10rem)_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8125rem] break-words">{value}</dd>
      {children ? <dd className="text-xs leading-relaxed text-muted-foreground">{children}</dd> : null}
    </div>
  );
}

function SubHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h4 id={id} className="eyebrow mb-1 border-b pb-2">
      {children}
    </h4>
  );
}

function pair(value: [number, number] | null | undefined): string {
  return value ? `row ${formatNumber(value[0])}, column ${formatNumber(value[1])}` : "-";
}

export function CandidateDetail({ candidate, analysisPolicy, candidateCount }: { candidate: Candidate; analysisPolicy: PolicySnapshot; candidateCount: number }) {
  const { measurement: m, decision, snapshot, experimental } = candidate;
  const policy = decision.policy ?? analysisPolicy;
  const hasStatistic = typeof m.pce === "number";
  // Without a statistic there is nothing the same-model question could apply to.
  const nua = hasStatistic ? explainNua(decision.nua, policy, snapshot) : null;
  const geometry = GEOMETRY[m.geometry ?? ""];
  const tested = Object.entries(m.tested ?? {});
  const hypotheses = (m.search_size ?? 0) * Math.max(candidateCount, 1);
  const reasons = decision.reasons ?? [];
  const caveats = decision.caveats ?? [];
  // Engine notes that already appear as the reasons are not repeated.
  const notes = (m.notes ?? []).filter((n) => !reasons.includes(n));
  const NuaIcon = nua?.tone === "warning" ? TriangleAlert : nua?.tone === "ok" ? CircleCheck : Info;
  // The full notice for the analysis policy is in the summary; repeat it in full only if this decision used a different one.
  const samePolicy = policy.policy_id === analysisPolicy.policy_id && policy.version === analysisPolicy.version;

  return (
    <div className="flex flex-col gap-7 pt-1 pb-2">
      {/* Outcome, reasons, limitations */}
      <section className="grid gap-5 lg:grid-cols-2">
        <div>
          <SubHeading>Outcome and reasons</SubHeading>
          <div className="pt-3">
            <VerdictBadge verdict={decision.verdict} size="lg" wrap />
            {reasons.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No reasons were recorded for this outcome.</p>
            )}
          </div>
        </div>
        <div>
          <SubHeading>Limitations</SubHeading>
          {caveats.length > 0 ? (
            <ul className="list-disc space-y-1.5 pt-3 pl-5 text-sm leading-relaxed text-muted-foreground">
              {caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="pt-3 text-sm text-muted-foreground">No limitations were recorded.</p>
          )}
        </div>
      </section>

      {nua ? (
        <section
          aria-label="Same-model handling"
          className={cn("rounded-lg border px-4 py-3.5 text-sm", nua.tone === "warning" ? "border-warning-border bg-warning-subtle" : "border-border bg-muted/40")}
        >
          <div className="flex items-start gap-2.5">
            <NuaIcon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", nua.tone === "warning" ? "text-warning" : nua.tone === "ok" ? "text-success" : "text-muted-foreground")} />
            <div className="min-w-0">
              <p className="eyebrow">Same-model check (sensor versus camera model)</p>
              <h4 className="mt-1 font-medium">{nua.title}</h4>
              <p className="mt-1 leading-relaxed text-muted-foreground">{nua.body}</p>
              {nua.action ? <p className="mt-2 leading-relaxed">{nua.action}</p> : null}
              {nua.action && decision.nua?.mitigation === "none" ? (
                <p className="mt-2">
                  <Link href="/app/cameras?new=1" className="font-medium underline underline-offset-4">
                    Register a control device
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <PolicyNotice policy={policy} variant={samePolicy ? "compact" : "full"} />

      {/* Measurements */}
      <section>
        <SubHeading>Measurements</SubHeading>
        {notes.length > 0 ? (
          <ul className="mt-3 space-y-1.5 rounded-md border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <dl className="divide-y">
          <Row label="Adjusted statistic" value={hasStatistic ? formatPce(decision.effective_pce ?? candidate.effective_pce) : "Not available"}>
            {hasStatistic ? (
              <>
                The value compared with the policy lines. It is the PCE lowered to account for {formatNumber(hypotheses)}{" "}
                {hypotheses === 1 ? "hypothesis" : "hypotheses"} having been tried ({formatNumber(m.search_size ?? 0)} {m.search_size === 1 ? "alignment" : "alignments"} ×{" "}
                {pluralize(candidateCount, "candidate sensor")}): the more things are tried, the easier it is to get a high value by coincidence. It is a
                detection statistic, not a percentage or a probability.
              </>
            ) : (
              "No statistic exists because no test could be performed."
            )}
          </Row>
          {hasStatistic ? (
            <>
          <Row label="PCE" value={formatPce(m.pce)}>
            Peak-to-correlation energy: how far the correlation at the tested alignment stands above the background of the correlation surface.
            Unrelated sensors give values around 1; the same sensor typically gives much larger values, depending on image size and content.
          </Row>
          <Row label="NCC" value={formatSmall(m.ncc)}>
            Normalised correlation between the image&apos;s noise residual and the fingerprint. It is small even for images from the same sensor,
            because the sensor pattern is a weak signal.
          </Row>
            </>
          ) : null}
          <Row label="Geometry" value={geometry?.label ?? humanize(m.geometry)}>
            {geometry?.explanation}
          </Row>
          {hasStatistic ? (
            <>
              <Row label="Rotation" value={m.rotation === null || m.rotation === undefined ? "-" : `${m.rotation}°`}>
                Rotation, counter-clockwise in stored pixel geometry, at which the best statistic was found.
              </Row>
              <Row label="Offset" value={pair(m.shift)}>
                Position of the image inside the fingerprint grid. Zero for a full-frame image; the located position for a crop.
              </Row>
              <Row label="Alignments tested" value={formatNumber(m.search_size ?? 0)}>
                Number of rotation and position hypotheses examined for this sensor.
              </Row>
              <Row
                label="Usable pixels"
                value={
                  <>
                    {formatNumber(m.valid_pixels ?? 0)}
                    {typeof m.valid_fraction === "number" ? <span className="text-muted-foreground"> ({formatNumber(m.valid_fraction * 100, 1)}% of the overlap)</span> : null}
                  </>
                }
              >
                Pixels that entered the statistic: inside the overlap and not saturated.
                {policy.min_valid_pixels !== undefined ? ` The policy needs at least ${formatNumber(policy.min_valid_pixels)} before a low statistic means anything.` : ""}
              </Row>
              {tested.length > 0 ? (
                <Row
                  label="Statistic per rotation"
                  value={
                    <ul>
                      {tested.map(([key, value]) => (
                        <li key={key} className="flex justify-between gap-3 sm:max-w-36">
                          <span className="text-muted-foreground">{rotationLabel(key)}</span>
                          <span>{formatPce(value)}</span>
                        </li>
                      ))}
                    </ul>
                  }
                >
                  PCE at each rotation that was tried. For the same sensor one rotation stands far above the others. The others stay near 1 for a single alignment, and somewhat higher when many positions are searched.
                </Row>
              ) : null}
              <Row label="Peak value" value={formatSmall(m.peak_value, 4)}>
                Raw height of the correlation at the tested alignment, before normalisation. Only meaningful relative to the rest of the surface.
              </Row>
              {m.offgrid_peak_pce !== null && m.offgrid_peak_pce !== undefined ? (
                <Row
                  label="Off-grid peak"
                  value={
                    <>
                      {formatPce(m.offgrid_peak_pce)}
                      <span className="block text-muted-foreground">at {pair(m.offgrid_peak_shift)}</span>
                    </>
                  }
                >
                  Diagnostic only, not used for the outcome: the largest value found anywhere on the surface, away from the tested alignment. Because
                  it is the maximum over every position, moderate values occur by coincidence. A very large one would suggest the image was shifted or
                  cropped relative to the fingerprint.
                </Row>
              ) : null}
              <Row label="Tail value, one alignment" value={formatScientific(m.p_value_gaussian)}>
                <strong className="font-medium text-foreground">Idealised model, not an error rate.</strong> How often pure Gaussian noise would
                exceed this PCE at a single alignment. Real images do not follow that model, so this is a reference figure only.
              </Row>
              <Row label="Tail value, all alignments" value={formatScientific(m.p_false_alarm_gaussian)}>
                <strong className="font-medium text-foreground">Idealised model, not an error rate.</strong> The same figure after allowing for every
                alignment tried for this sensor. It is not the chance that the outcome is wrong, and not the chance that the image came from another
                camera.
              </Row>
            </>
          ) : null}
        </dl>
      </section>

      {m.surface_window ? (
        <section>
          <SubHeading>Correlation surface</SubHeading>
          <div className="grid items-start gap-4 pt-3 sm:grid-cols-[auto_1fr]">
            <CorrelationSurface surface={m.surface_window} label={`${snapshot.device_name ?? ""} / ${snapshot.sensor_name ?? ""}`} />
            <div className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              <p>
                Each cell is the correlation between the image&apos;s noise and the fingerprint at one small shift around the tested alignment; the
                centre cell is the alignment itself.
              </p>
              <p className="mt-2">
                An image from the same sensor shows <span className="text-foreground">one isolated peak at the centre</span> over a flat, noisy
                background. No clear central peak, or a surface that looks the same everywhere, is what an unrelated sensor produces. A broad blob or
                several peaks points to shared processing artefacts or to resampling rather than to one sensor.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {experimental ? (
        <section className="rounded-lg border border-dashed px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <FlaskConical aria-hidden="true" />
              Experimental
            </Badge>
            <h4 className="text-sm font-medium">Delta-sPCE</h4>
          </div>
          <p className="mt-2 font-mono text-base">{formatPce(experimental.delta_spce)}</p>
          {experimental.note ? <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">{experimental.note}</p> : null}
          {experimental.control_ids?.length ? (
            <p className="mt-1.5 text-xs text-muted-foreground">Computed against {pluralize(experimental.control_ids.length, "same-model control fingerprint")} in this comparison.</p>
          ) : null}
        </section>
      ) : null}

      {/* Fingerprint snapshot */}
      <section>
        <SubHeading>Reference fingerprint used (snapshot at the time of comparison)</SubHeading>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <dl className="divide-y">
            <Snap label="Device">
              <span className="flex flex-wrap items-center gap-2">
                {snapshot.device_name ?? "-"} <DemoBadge when={snapshot.is_demo} />
              </span>
            </Snap>
            <Snap label="Sensor">
              {candidate.sensor_id ? (
                <Link href={`/app/sensors/${candidate.sensor_id}`} className="underline underline-offset-4">
                  {snapshot.sensor_name ?? "Open sensor"}
                </Link>
              ) : (
                <>
                  {snapshot.sensor_name ?? "-"} <span className="text-muted-foreground">(since deleted)</span>
                </>
              )}
            </Snap>
            <Snap label="Make and model">{[snapshot.make, snapshot.model].filter(Boolean).join(" ") || "-"}</Snap>
            <Snap label="Serial number" mono>
              {snapshot.serial_number || "-"}
            </Snap>
            <Snap label="Firmware" mono>
              {snapshot.firmware || "-"}
            </Snap>
            <Snap label="Pipeline class">{PIPELINE_LABELS[snapshot.pipeline_class ?? ""] ?? humanize(snapshot.pipeline_class) ?? "-"}</Snap>
          </dl>
          <dl className="divide-y border-t sm:border-t-0">
            <Snap label="Fingerprint version" mono>
              {snapshot.fingerprint_version !== undefined ? `v${snapshot.fingerprint_version}` : "-"}
            </Snap>
            <Snap label="Fingerprint digest">{snapshot.fingerprint_digest ? <Hash value={snapshot.fingerprint_digest} label="fingerprint digest" /> : "-"}</Snap>
            <Snap label="Reference images used" mono>
              {formatNumber(snapshot.n_images)}
            </Snap>
            <Snap label="Fingerprint size" mono>
              {snapshot.fingerprint_width && snapshot.fingerprint_height ? `${formatNumber(snapshot.fingerprint_width)} × ${formatNumber(snapshot.fingerprint_height)} px` : "-"}
            </Snap>
            <Snap label="Split-half PCE" mono>
              {formatPce(snapshot.split_half_pce)}
            </Snap>
            <Snap label="Algorithm version" mono>
              {snapshot.algorithm_version ?? "-"}
            </Snap>
          </dl>
        </div>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Split-half PCE is the fingerprint&apos;s internal consistency: the reference images are split in two halves, a fingerprint is estimated from
          each, and the two are compared. A high value means the reference set carries a stable sensor pattern.
        </p>
      </section>
    </div>
  );
}

function Snap({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-baseline gap-x-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-[0.8125rem]")}>{children}</dd>
    </div>
  );
}
