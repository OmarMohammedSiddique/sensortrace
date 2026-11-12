/**
 * Friendly names for the generated OpenAPI schema types, plus hand-written shapes for the
 * fields the OpenAPI document leaves as free-form objects (`quality`, `policy`,
 * `measurement`, `decision`, ...). The hand-written shapes were derived from live API
 * responses; every field that is not guaranteed is optional, so always read defensively.
 */
import type { components } from "./schema";

type S = components["schemas"];

export type Meta = Omit<S["Meta"], "limits" | "reference_guidance" | "limitations"> & {
  limits: MetaLimits;
  reference_guidance: GuidanceItem[];
  limitations: GuidanceItem[];
};
export interface MetaLimits {
  max_upload_bytes: number;
  max_image_pixels: number;
  max_files_per_request: number;
  max_reference_images: number;
  max_candidates_per_analysis: number;
  recommended_reference_images: number;
  min_reference_images: number;
  [key: string]: number;
}
export interface GuidanceItem {
  title: string;
  body: string;
}

export type User = S["UserOut"];
export type SessionInfo = S["SessionInfo"];
export type SessionOut = S["SessionOut"];
export type TokenOut = S["TokenOut"];
export type TokenCreated = S["TokenCreated"];
export type Usage = S["Usage"];
export type AuditEntry = S["AuditOut"];
export type ExportOut = S["ExportOut"];

export type Device = S["DeviceOut"];
export type DeviceIn = S["DeviceIn"];
export type DevicePatch = S["DevicePatch"];
export type Sensor = S["SensorOut"];
export type SensorIn = S["SensorIn"];
export type SensorPatch = S["SensorPatch"];
export type Fingerprint = S["FingerprintOut"];
export type FingerprintDetail = S["FingerprintDetail"];
export type Investigation = S["InvestigationOut"];
export type InvestigationIn = S["InvestigationIn"];
export type InvestigationPatch = S["InvestigationPatch"];
export type Note = S["NoteOut"];
export type Report = S["ReportOut"];
export type Job = S["JobOut"];
export type UploadResult = S["UploadResult"];
export type UploadResponse = S["UploadResponse"];
export type AnalysisIn = S["AnalysisIn"];
export type AnalysisStarted = S["AnalysisStarted"];

export type Policy = S["PolicyOut"];
/** The policy snapshot embedded in analyses and decisions has the same fields as PolicyOut. */
export type PolicySnapshot = Partial<Policy> & { calibrated?: boolean };

/* ------------------------------------------------------------------ enums */

export const VERDICTS = [
  "match_supported",
  "non_match_supported",
  "inconclusive",
  "insufficient_or_unsupported",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type PipelineClass = "conventional" | "computational" | "unknown";
export type EvidenceCategory = "questioned" | "reference" | "context";
export type InvestigationStatus = "open" | "closed" | "archived";
export type DeviceType = NonNullable<DeviceIn["device_type"]>;

/* ------------------------------------------------------------- quality */

export type QualitySeverity = "info" | "warning" | "severe";
export interface QualityFlag {
  code: string;
  severity: QualitySeverity;
  message: string;
}
export interface QualityReport {
  flags?: QualityFlag[];
  worst?: QualitySeverity | null;
  metrics?: Record<string, number | string | boolean | null>;
}

export type Evidence = Omit<S["EvidenceOut"], "quality" | "acquisition" | "category"> & {
  category: EvidenceCategory | (string & {});
  quality: QualityReport;
  acquisition: Partial<S["Acquisition"]>;
};
export type ReferenceImage = Omit<S["ReferenceOut"], "quality"> & { quality: QualityReport };

/* ------------------------------------------------------------ analyses */

export interface AnalysisSummary {
  text?: string;
  counts?: Partial<Record<Verdict, number>>;
  multiple_matches?: boolean;
}
export type Analysis = Omit<S["AnalysisOut"], "summary"> & { summary: AnalysisSummary };

export interface Measurement {
  pce?: number | null;
  ncc?: number | null;
  /** How the image was aligned to the fingerprint grid, e.g. "native". */
  geometry?: string;
  rotation?: number;
  shift?: [number, number];
  search_size?: number;
  valid_pixels?: number;
  valid_fraction?: number;
  peak_value?: number;
  /** Statistic for each alignment hypothesis that was tested, keyed by hypothesis name. */
  tested?: Record<string, number>;
  p_value_gaussian?: number | null;
  p_false_alarm_gaussian?: number | null;
  offgrid_peak_pce?: number | null;
  offgrid_peak_shift?: [number, number] | null;
  /** 33x33 window of the normalised correlation surface centred on the tested shift. */
  surface_window?: number[][] | null;
  notes?: string[];
}

export type NuaMitigation =
  | "not_applicable"
  | "declared_conventional"
  | "calibrated_for_model"
  | "same_model_controls"
  | "controls_failed"
  | "none";

export interface NuaInfo {
  device_class?: PipelineClass | (string & {});
  model_key?: string;
  mitigation?: NuaMitigation | (string & {});
  n_controls?: number;
  max_control?: number;
}

export interface Decision {
  verdict: Verdict;
  /** Human label for the verdict, supplied by the API. Display verbatim. */
  label: string;
  effective_pce?: number | null;
  reasons?: string[];
  caveats?: string[];
  policy?: PolicySnapshot;
  nua?: NuaInfo;
}

export interface CandidateSnapshot {
  device_name?: string;
  sensor_name?: string;
  make?: string;
  model?: string;
  firmware?: string;
  serial_number?: string;
  pipeline_class?: PipelineClass | (string & {});
  is_demo?: boolean;
  n_images?: number;
  split_half_pce?: number | null;
  algorithm_version?: string;
  fingerprint_version?: number;
  fingerprint_digest?: string;
  fingerprint_width?: number;
  fingerprint_height?: number;
}

export interface Experimental {
  delta_spce?: number | null;
  note?: string;
  control_ids?: string[];
}

export type Candidate = Omit<
  S["CandidateOut"],
  "snapshot" | "measurement" | "decision" | "experimental" | "verdict"
> & {
  verdict: Verdict;
  snapshot: CandidateSnapshot;
  measurement: Measurement;
  decision: Decision;
  experimental: Experimental | null;
};

export type AnalysisDetail = Omit<
  S["AnalysisDetail"],
  "summary" | "policy" | "quality" | "candidates" | "evidence"
> & {
  summary: AnalysisSummary;
  policy: PolicySnapshot;
  quality: QualityReport;
  candidates: Candidate[];
  evidence?: Evidence | null;
};

/* ----------------------------------------------------------- dashboard */

export interface DashboardCounts {
  investigations: number;
  evidence: number;
  devices: number;
  sensors: number;
  fingerprints: number;
  analyses: number;
  reports: number;
  jobs: number;
  [key: string]: number;
}
export interface StorageBreakdown {
  evidence: number;
  reference_images: number;
  fingerprints: number;
  reports: number;
  exports: number;
  total: number;
  [key: string]: number;
}
export type Dashboard = Omit<S["Dashboard"], "counts" | "storage" | "recent_analyses"> & {
  counts: DashboardCounts;
  storage: StorageBreakdown;
  recent_analyses: Analysis[];
};

/* --------------------------------------------------------------- pages */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface PageParams {
  limit?: number;
  offset?: number;
}
