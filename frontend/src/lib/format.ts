/** Pure formatting helpers. Safe in server and client components. */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1536 -> "1.5 KB". Binary multiples (1 KB = 1024 B), matching the API's limits. */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "-";
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const d = unit === 0 || value >= 100 ? 0 : digits;
  return `${bytes < 0 ? "-" : ""}${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  })} ${BYTE_UNITS[unit]}`;
}

/** Integer or decimal with thousands separators. */
export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

/**
 * PCE / effective-PCE statistic: thousands separators, 1 decimal at or above 100,
 * 2 decimals below. This is a detection statistic, never a percentage or probability.
 */
export function formatPce(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const digits = Math.abs(value) >= 100 ? 1 : 2;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Small values such as NCC or p-values: fixed for readable magnitudes, exponent otherwise. */
export function formatSmall(value: number | null | undefined, significant = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 0.001 && abs < 10_000) return Number(value.toPrecision(significant)).toString();
  return value.toExponential(significant - 1);
}

/** "abcdef0123...89abcdef" keeping `head` and `tail` characters. */
export function truncateMiddle(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** "non_match_supported" -> "Non match supported". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replace(/[_.-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function formatDateTime(iso: string | null | undefined, style: "datetime" | "date" = "datetime"): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return style === "date"
    ? date.toLocaleDateString(undefined, { dateStyle: "medium" })
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "in 2 days", "just now". */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), "minute");
}

/** Duration between two ISO timestamps as "1m 12s". */
export function formatDuration(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso || !endIso) return "-";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
