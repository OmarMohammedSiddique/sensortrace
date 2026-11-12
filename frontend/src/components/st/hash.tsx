import { CopyButton } from "@/components/st/copy-button";
import { truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HashProps {
  /** Full hash / id. Renders a dash when empty. */
  value: string | null | undefined;
  /** Characters kept at each end (default 8). Ignored when `full`. */
  chars?: number;
  /** Show the whole value, wrapping if needed (detail panels, reports). */
  full?: boolean;
  /** What is being copied, for the accessible name: "Copy SHA-256". */
  label?: string;
  copy?: boolean;
  className?: string;
}

/** Monospace hash or identifier, middle-truncated, full value in `title`, with a copy button. */
export function Hash({ value, chars = 8, full = false, label = "SHA-256", copy = true, className }: HashProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5 align-middle", className)}>
      <code
        title={value}
        className={cn("font-mono text-[0.8125rem] text-foreground/90", full ? "break-all" : "whitespace-nowrap")}
      >
        {full ? value : truncateMiddle(value, chars, chars)}
        {full ? null : <span className="sr-only"> (truncated; full value: {value})</span>}
      </code>
      {copy ? <CopyButton value={value} label={`Copy ${label}`} /> : null}
    </span>
  );
}
