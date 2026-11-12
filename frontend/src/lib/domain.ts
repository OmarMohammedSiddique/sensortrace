/**
 * Domain vocabulary: the fixed labels the UI uses for API enum values.
 * Verdict labels are mandated by the product brief and must be used verbatim.
 */
import type { AuditEntry, Job, NuaInfo, Verdict } from "@/lib/api/types";
import { VERDICTS } from "@/lib/api/types";
import { humanize } from "@/lib/format";

export const VERDICT_LABELS: Record<Verdict, string> = {
  match_supported: "Evidence supports a match",
  non_match_supported: "Evidence supports a non-match",
  inconclusive: "Inconclusive",
  insufficient_or_unsupported: "Insufficient quality or unsupported analysis",
};

/** Short forms for tight spaces (table cells, legends). Still never "identified"/"confirmed". */
export const VERDICT_SHORT_LABELS: Record<Verdict, string> = {
  match_supported: "Supports match",
  non_match_supported: "Supports non-match",
  inconclusive: "Inconclusive",
  insufficient_or_unsupported: "Insufficient / unsupported",
};

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

export const PIPELINE_LABELS: Record<string, string> = {
  conventional: "Conventional pipeline",
  computational: "Computational pipeline",
  unknown: "Unknown pipeline",
};

export const PIPELINE_DESCRIPTIONS: Record<string, string> = {
  conventional:
    "Single-exposure capture with limited in-camera processing, typical of dedicated cameras and older phones.",
  computational:
    "Multi-frame fusion, HDR, strong lens correction or similar processing, typical of modern smartphones. Same-model control devices are needed before a high statistic supports a match.",
  unknown:
    "Processing pipeline not known. Treated like a computational pipeline: same-model controls are needed before a high statistic supports a match.",
};

export const DEVICE_TYPE_LABELS: Record<string, string> = {
  smartphone: "Smartphone",
  tablet: "Tablet",
  dedicated_camera: "Dedicated camera",
  action_camera: "Action camera",
  drone: "Drone",
  webcam: "Webcam",
  other: "Other",
};

export const CATEGORY_LABELS: Record<string, string> = {
  questioned: "Questioned",
  reference: "Reference",
  context: "Context",
};

export const JOB_KIND_LABELS: Record<string, string> = {
  fingerprint: "Fingerprint estimation",
  analysis: "Sensor comparison",
  export: "Data export",
  report: "Report generation",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] ?? humanize(kind);
}

/** Readable stage name; stages come from the engine as snake_case identifiers. */
export function jobStageLabel(job: Pick<Job, "stage" | "status">): string {
  if (job.status !== "running") return JOB_STATUS_LABELS[job.status] ?? humanize(job.status);
  return humanize(job.stage) || "Running";
}

/**
 * True when a candidate's non-unique-artefact (NUA) safeguard is missing, so a high
 * statistic cannot be attributed to the individual sensor. The UI must then explain why
 * and suggest enrolling a second device of the same make and model as a control.
 */
export function needsSameModelControl(nua: NuaInfo | undefined | null): boolean {
  return nua?.mitigation === "none" || nua?.mitigation === "controls_failed";
}

export const NUA_MITIGATION_LABELS: Record<string, string> = {
  not_applicable: "Not required for this device class",
  declared_conventional: "Device declared as a conventional pipeline",
  calibrated_for_model: "Policy calibrated for this camera model",
  same_model_controls: "Checked against same-model control devices",
  controls_failed: "Same-model control devices also scored high",
  none: "No same-model control devices enrolled",
};

/* -------------------------------------------------------------- audit log */

const AUDIT_TEXT: Record<string, string> = {
  "account.registered": "Account created",
  "account.updated": "Account settings updated",
  "account.password_changed": "Password changed",
  "account.deleted": "Account deleted",
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "auth.session_revoked": "Session revoked",
  "token.created": "API token created",
  "token.revoked": "API token revoked",
  "demo.created": "Synthetic demo data added",
  "demo.removed": "Synthetic demo data removed",
  "device.created": "Camera registered",
  "device.updated": "Camera details updated",
  "device.deleted": "Camera deleted",
  "sensor.created": "Sensor added",
  "sensor.updated": "Sensor details updated",
  "sensor.deleted": "Sensor deleted",
  "reference.uploaded": "Reference image uploaded",
  "reference.deleted": "Reference image deleted",
  "fingerprint.requested": "Fingerprint estimation started",
  "fingerprint.created": "Fingerprint estimated",
  "fingerprint.activated": "Fingerprint version activated",
  "fingerprint.deleted": "Fingerprint deleted",
  "investigation.created": "Investigation created",
  "investigation.updated": "Investigation updated",
  "investigation.deleted": "Investigation deleted",
  "investigation.retention_purged": "Investigation removed by retention policy",
  "note.added": "Note added",
  "note.deleted": "Note deleted",
  "evidence.uploaded": "Evidence image uploaded",
  "evidence.updated": "Evidence details updated",
  "evidence.deleted": "Evidence image deleted",
  "analysis.requested": "Comparison started",
  "analysis.completed": "Comparison completed",
  "analysis.saved_to_investigation": "Comparison saved to an investigation",
  "analysis.deleted": "Comparison deleted",
  "report.generated": "Report generated",
  "report.deleted": "Report deleted",
  "export.requested": "Data export started",
  "export.created": "Data export ready",
  "job.cancel_requested": "Job cancellation requested",
  "job.succeeded": "Background job completed",
  "job.failed": "Background job failed",
  "job.cancelled": "Background job cancelled",
};

/** Plain-language sentence for an audit entry. Unknown actions fall back to a humanised code. */
export function auditText(entry: Pick<AuditEntry, "action" | "details">): string {
  const base = AUDIT_TEXT[entry.action] ?? humanize(entry.action);
  const details = entry.details as Record<string, unknown> | null | undefined;
  const name = details && ["filename", "name", "title"].map((k) => details[k]).find((v) => typeof v === "string" && v);
  return typeof name === "string" ? `${base}: ${name}` : base;
}

/** In-app link for the entity an audit entry refers to, when it has a page. */
export function auditHref(entry: Pick<AuditEntry, "action" | "entity_type" | "entity_id" | "investigation_id">): string | null {
  if (entry.action.endsWith(".deleted") || entry.action.endsWith(".removed")) return null;
  const id = entry.entity_id;
  switch (entry.entity_type) {
    case "device":
      return id ? `/app/cameras/${id}` : null;
    case "sensor":
      return id ? `/app/sensors/${id}` : null;
    case "analysis":
      return id ? `/app/analyses/${id}` : null;
    case "investigation":
      return id ? `/app/investigations/${id}` : null;
    case "report":
      return "/app/reports";
    case "job":
      return "/app/jobs";
    default:
      return entry.investigation_id ? `/app/investigations/${entry.investigation_id}` : null;
  }
}

/** In-app link for the thing a job is working on. */
export function jobHref(job: Pick<Job, "kind" | "target_type" | "target_id">): string | null {
  if (!job.target_id) return null;
  if (job.target_type === "analysis") return `/app/analyses/${job.target_id}`;
  if (job.target_type === "sensor") return `/app/sensors/${job.target_id}`;
  if (job.target_type === "export") return "/app/settings";
  return null;
}
