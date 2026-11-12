"use client";

import { useSyncExternalStore } from "react";

import { formatBytes, formatDateTime, formatPce, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const noop = () => () => {};
/** False during SSR and hydration, true afterwards. Locale formatting is client-only. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export interface FormattedDateProps {
  /** ISO 8601 timestamp from the API. Renders a dash when empty. */
  value: string | null | undefined;
  /** `datetime` (default), `date`, or `relative` ("3 minutes ago"). */
  mode?: "datetime" | "date" | "relative";
  className?: string;
}

/** Date in the user's locale inside a `<time>` element, with the ISO value as `title`. */
export function FormattedDate({ value, mode = "datetime", className }: FormattedDateProps) {
  const hydrated = useHydrated();
  if (!value) return <span className={cn("text-muted-foreground", className)}>-</span>;
  // Before hydration render a locale-independent ISO date so server and client agree.
  const text = !hydrated
    ? value.slice(0, 10)
    : mode === "relative"
      ? formatRelative(value)
      : formatDateTime(value, mode);
  return (
    <time dateTime={value} title={value} className={cn("whitespace-nowrap", className)}>
      {text}
    </time>
  );
}

/** Human-readable byte size ("1.5 MB") with the exact byte count as `title`. */
export function Bytes({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-muted-foreground", className)}>-</span>;
  return (
    <span title={`${value.toLocaleString("en-US")} bytes`} className={cn("whitespace-nowrap", className)}>
      {formatBytes(value)}
    </span>
  );
}

/**
 * A PCE-type detection statistic in mono with thousands separators. It is a statistic,
 * not a probability: never append "%" or call it confidence.
 */
export function Pce({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <span
      title={value === null || value === undefined ? undefined : String(value)}
      className={cn("font-mono whitespace-nowrap", className)}
    >
      {formatPce(value)}
    </span>
  );
}
