import type { AnalysisDetail, Candidate } from "@/lib/api/types";
import { formatNumber, formatPce, formatSmall } from "@/lib/format";

import { METADATA_STATUS, type SnapshotExtra } from "./explain";

function num(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value, digits) : "-";
}
function fraction(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${formatSmall(value * 100, 3)}%` : "-";
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "Not recorded";
}

/** True when at least one candidate carries the reference-set profile (newer analyses only). */
export function hasReferenceProfiles(candidates: Candidate[]): boolean {
  return candidates.some((c) => (c.snapshot as SnapshotExtra).reference_profile || (c.snapshot as SnapshotExtra).metadata_consistency);
}

/**
 * Side-by-side comparison of the questioned image with each candidate's reference set.
 * Large differences in brightness, saturation or resolution make a low statistic less
 * informative; none of these values is used for the outcome.
 */
export function ImageVsReference({ analysis }: { analysis: AnalysisDetail }) {
  const metrics = analysis.quality?.metrics ?? {};
  const evidence = analysis.evidence;
  const md = (evidence?.image_metadata ?? {}) as Record<string, unknown>;
  const cols = analysis.candidates.map((c) => ({ c, s: c.snapshot as SnapshotExtra }));
  const note = cols.map(({ s }) => s.metadata_consistency?.note).find(Boolean);

  const rows: { label: string; image: string; ref: (s: SnapshotExtra) => string; mono?: boolean }[] = [
    {
      label: "Dimensions",
      image: evidence ? `${formatNumber(evidence.width)} × ${formatNumber(evidence.height)} px` : "-",
      ref: (s) => (s.reference_profile?.group?.width && s.reference_profile.group.height ? `${formatNumber(s.reference_profile.group.width)} × ${formatNumber(s.reference_profile.group.height)} px` : "-"),
      mono: true,
    },
    { label: "Megapixels", image: num(metrics.megapixels, 2), ref: (s) => (s.reference_profile?.group?.width && s.reference_profile.group.height ? num((s.reference_profile.group.width * s.reference_profile.group.height) / 1e6, 2) : "-"), mono: true },
    { label: "Camera make in metadata", image: text(md.Make), ref: (s) => text(s.reference_profile?.group?.make) },
    { label: "Camera model in metadata", image: text(md.Model), ref: (s) => text(s.reference_profile?.group?.model) },
    { label: "Lens in metadata", image: text(md.LensModel), ref: (s) => text(s.reference_profile?.group?.lens_model) },
    { label: "Mean intensity (0-255)", image: num(metrics.mean_intensity, 1), ref: (s) => num(s.reference_profile?.mean_intensity, 1), mono: true },
    { label: "Saturated pixels", image: fraction(metrics.saturated_fraction), ref: (s) => fraction(s.reference_profile?.mean_saturated_fraction), mono: true },
    { label: "Texture index", image: num(metrics.texture_index, 2), ref: () => "-", mono: true },
    { label: "JPEG quality estimate", image: num(metrics.jpeg_quality_estimate, 0), ref: () => "-", mono: true },
    {
      label: "Reference images",
      image: "-",
      ref: (s) => {
        const sc = s.reference_profile?.screening;
        if (!sc || sc.submitted === null || sc.submitted === undefined) return "-";
        return `${formatNumber(sc.accepted ?? 0)} used of ${formatNumber(sc.submitted)} submitted, ${formatNumber(sc.rejected ?? 0)} screened out`;
      },
    },
    { label: "Leave-one-out PCE, median", image: "-", ref: (s) => formatPce(s.reference_profile?.screening?.loo_pce_median), mono: true },
    { label: "Camera named in metadata", image: "-", ref: (s) => (s.metadata_consistency?.status ? (METADATA_STATUS[s.metadata_consistency.status] ?? s.metadata_consistency.status) : "-") },
  ];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Questioned image compared with each candidate&apos;s reference set</caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th scope="col" className="eyebrow h-9 px-4 font-medium">
                Property
              </th>
              <th scope="col" className="eyebrow h-9 px-4 font-medium">
                Questioned image
              </th>
              {cols.map(({ c, s }) => (
                <th key={c.id} scope="col" className="eyebrow h-9 px-4 font-medium">
                  <span className="normal-case tracking-normal">
                    #{c.rank} {s.device_name} / {s.sensor_name}
                  </span>
                  <span className="block text-[0.625rem] font-normal">reference set</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="px-4 py-2 text-left font-normal text-muted-foreground">
                  {row.label}
                </th>
                <td className={row.mono ? "px-4 py-2 font-mono text-[0.8125rem]" : "px-4 py-2"}>{row.image}</td>
                {cols.map(({ c, s }) => (
                  <td key={c.id} className={row.mono ? "px-4 py-2 font-mono text-[0.8125rem]" : "px-4 py-2"}>
                    {row.ref(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        For context only: none of these values is used to decide an outcome. {note ?? "Metadata can be edited or stripped and is not used for the outcome."} A
        questioned image that is much darker, more saturated or at a different resolution than the reference set makes a low statistic less
        informative. The leave-one-out value is the median PCE of each reference image against a fingerprint built from the others.
      </p>
    </div>
  );
}
