/**
 * Plain-language explanations for the fixed vocabulary of a comparison result.
 * Wording rules: never a probability, never certainty, sensor is not the same as model.
 */
import type { CandidateSnapshot, NuaInfo, PolicySnapshot } from "@/lib/api/types";
import { formatNumber, formatPce, pluralize } from "@/lib/format";

export interface ReferenceProfile {
  group?: { make?: string | null; model?: string | null; lens_model?: string | null; width?: number | null; height?: number | null; channels?: number | null };
  mean_intensity?: number | null;
  mean_saturated_fraction?: number | null;
  screening?: { submitted?: number | null; accepted?: number | null; rejected?: number | null; loo_pce_median?: number | null };
}
export interface MetadataConsistency {
  status?: "unknown" | "same_model" | "different_model" | (string & {});
  image?: { make?: string; model?: string };
  reference?: { make?: string; model?: string };
  note?: string;
}
/** Snapshot fields added to newer analyses; absent on older ones. */
export type SnapshotExtra = CandidateSnapshot & {
  reference_profile?: ReferenceProfile;
  metadata_consistency?: MetadataConsistency;
};

export const GEOMETRY: Record<string, { label: string; explanation: string }> = {
  native: {
    label: "Native",
    explanation: "The image has the same pixel dimensions as the fingerprint, so it was tested in place, pixel for pixel (upright and turned 180°).",
  },
  rotated: {
    label: "Rotated",
    explanation: "The image has the fingerprint's dimensions with width and height swapped, so it was tested turned by 90° and by 270°.",
  },
  cropped: {
    label: "Cropped (experimental)",
    explanation:
      "The image is smaller than the fingerprint, so every position it could occupy inside the sensor area was searched. Searching many positions raises the chance of a high value by coincidence; the adjusted statistic accounts for that under an idealised noise model that has not been validated empirically.",
  },
  unsupported: {
    label: "Unsupported",
    explanation:
      "The image is larger than the fingerprint in at least one dimension, so it cannot be a crop of this sensor's output at this resolution. It may have been resized, or come from a different sensor or capture mode. No test was performed.",
  },
};

export const METADATA_STATUS: Record<string, string> = {
  same_model: "Same make and model named",
  different_model: "A different camera is named",
  unknown: "Cannot be compared: no camera model is recorded on one or both sides",
};

/** "rot180" -> "180°". Unknown keys are returned unchanged. */
export function rotationLabel(key: string): string {
  const m = /^rot(\d+)$/.exec(key);
  return m ? `${m[1]}°` : key;
}

/** p-values in scientific notation. Zero means the value underflowed double precision. */
export function formatScientific(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value === 0) return "< 1e-300";
  return value.toExponential(2);
}

export interface NuaExplanation {
  tone: "neutral" | "ok" | "warning";
  title: string;
  body: string;
  /** What the user can do next, when something can be done. */
  action?: string;
}

/** How the same-model alternative was handled for one candidate, in words. */
export function explainNua(nua: NuaInfo | undefined, policy: PolicySnapshot | undefined, snapshot: CandidateSnapshot): NuaExplanation | null {
  if (!nua?.mitigation) return null;
  const model = [snapshot.make, snapshot.model].filter(Boolean).join(" ") || "this make and model";
  const threshold = policy?.match_threshold;
  const line = threshold !== undefined ? ` (match line ${formatNumber(threshold, 2)})` : "";
  switch (nua.mitigation) {
    case "not_applicable":
      return {
        tone: "neutral",
        title: "Same-model check not needed for this outcome",
        body: "Different devices of one model can share processing artefacts that raise the statistic. That only matters when the statistic reaches the match line, which it did not here.",
      };
    case "declared_conventional":
      return {
        tone: "neutral",
        title: "No same-model check: the device is declared as a conventional pipeline",
        body: "For cameras with limited in-camera processing, artefacts shared between units of one model are not expected to reach the match line, so the high statistic is read as pointing to this physical sensor. This rests on the pipeline declaration in the camera's record being right.",
      };
    case "calibrated_for_model":
      return {
        tone: "ok",
        title: "Same-model alternative covered by the policy's calibration",
        body: `The policy was calibrated for ${model} using images from other devices of the same model as negatives, so its match line already accounts for artefacts shared by that model.`,
      };
    case "same_model_controls":
      return {
        tone: "ok",
        title: `Checked against ${pluralize(nua.n_controls ?? 0, "same-model control device")}`,
        body: `The same image was also compared with ${pluralize(nua.n_controls ?? 0, "other physical device")} of ${model}. The highest control value was ${formatPce(nua.max_control)}${line}, so the high statistic is specific to this sensor among the devices tested. A small control set cannot rule out artefacts shared with other units, production batches or software versions.`,
      };
    case "controls_failed":
      return {
        tone: "warning",
        title: "A same-model control device also scored high",
        body: `Another physical device of ${model} reached ${formatPce(nua.max_control)} against this image${line}${nua.n_controls ? `, out of ${pluralize(nua.n_controls, "control")}` : ""}. The high statistic is therefore at least partly due to artefacts shared by the model, and it does not single out one device.`,
        action:
          "What you can do: this comparison cannot separate the devices. Check whether the image is consistent with the control device instead, add more units of the same model as controls, and treat the result as pointing to the camera model at most, not to a physical sensor.",
      };
    case "none":
      return {
        tone: "warning",
        title: "No same-model control device was available",
        body: `The device's pipeline is not declared conventional. On many recent phones, different units of the same model produce high statistics against each other's images, so a high value alone cannot be attributed to this individual sensor. That is why the outcome is not a supported match.`,
        action: `What you can do: enrol a second physical device of ${model} in the camera laboratory, build its fingerprint from images at the same resolution, then run the comparison again with both sensors selected. If the control stays below the match line, the result can support a match.`,
      };
    default:
      return null;
  }
}
