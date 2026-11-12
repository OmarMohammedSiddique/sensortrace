/**
 * Shapes of the free-form `diagnostics` and `outcomes` fields of a fingerprint, derived
 * from live API responses. Everything is optional: read defensively.
 */
import type { QualityReport } from "@/lib/api/types";

export interface FingerprintDiagnostics {
  n_images?: number;
  sigma0?: number;
  mean_intensity?: number;
  mean_saturated_fraction?: number;
  fingerprint_std?: number;
  warnings?: string[];
  libraries?: Record<string, string>;
  reference_sha256?: string[];
  group?: { make?: string | null; model?: string | null; width?: number; height?: number; channels?: number; lens_model?: string | null };
  spectrum?: { peak_to_median?: number; block8_ratio?: number };
  split_half?: { pce?: number | null; ncc?: number | null; n_a?: number; n_b?: number; description?: string };
  screening?: {
    submitted?: number;
    accepted?: number;
    rejected?: number;
    loo_pce_median?: number | null;
    loo_crop_side?: number;
    config?: Record<string, number | boolean | string | null>;
  };
  reference_stats?: { index?: number; residual_std?: number; mean_intensity?: number; saturated_fraction?: number }[];
}

export interface ScreeningOutcome {
  ref_id?: string;
  sha256?: string;
  width?: number;
  height?: number;
  accepted?: boolean;
  loo_pce?: number | null;
  reasons?: string[];
  warnings?: string[];
  quality?: QualityReport;
}

export function diagnosticsOf(fp: { diagnostics?: unknown } | null | undefined): FingerprintDiagnostics {
  const d = fp?.diagnostics;
  return d && typeof d === "object" ? (d as FingerprintDiagnostics) : {};
}

export function outcomesOf(fp: { outcomes?: unknown } | null | undefined): ScreeningOutcome[] {
  return Array.isArray(fp?.outcomes) ? (fp.outcomes as ScreeningOutcome[]) : [];
}

export function metric(quality: QualityReport | null | undefined, key: string): number | null {
  const v = quality?.metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
