import { cn } from "@/lib/utils";

/**
 * SensorTrace mark: a 3x3 patch of sensor pixels with one that stands out, the way a
 * correlation peak stands out of noise.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect x="1" y="1" width="22" height="22" rx="5.5" className="fill-foreground" />
      {[6.5, 12, 17.5].flatMap((cy, r) =>
        [6.5, 12, 17.5].map((cx, c) =>
          r === 1 && c === 1 ? (
            <rect key={`${r}${c}`} x={cx - 2.4} y={cy - 2.4} width="4.8" height="4.8" rx="1.2" className="fill-primary" />
          ) : (
            <rect
              key={`${r}${c}`}
              x={cx - 1.5}
              y={cy - 1.5}
              width="3"
              height="3"
              rx="0.8"
              className="fill-background"
              opacity={(r + c) % 2 === 0 ? 0.42 : 0.72}
            />
          ),
        ),
      )}
    </svg>
  );
}

export function Logo({ className, markOnly = false }: { className?: string; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {markOnly ? (
        <span className="sr-only">SensorTrace</span>
      ) : (
        <span className="text-[0.9375rem] font-semibold tracking-tight">SensorTrace</span>
      )}
    </span>
  );
}
