
import { CircleAlert, RefreshCw, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** ONE primary action (a `<Button>` or `<Button asChild><Link/></Button>`). */
  action?: React.ReactNode;
  /** Optional quieter second action (a link to docs, "Load demo data"). */
  secondaryAction?: React.ReactNode;
  /** `card` (default) draws a dashed well; `plain` has no border, for use inside a card. */
  variant?: "card" | "plain";
  className?: string;
}

/** What a list or section shows when there is nothing yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "card",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        variant === "card" ? "rounded-lg border border-dashed bg-surface/60 py-12" : "py-8",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
        </div>
      ) : null}
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  /** Anything thrown; `ApiError.message` is shown when available. */
  error?: unknown;
  title?: string;
  /** Usually `query.refetch`. Omit to hide the retry button. */
  onRetry?: () => void;
  /** Pass `query.isFetching` to show progress on the retry button. */
  retrying?: boolean;
  variant?: "card" | "plain" | "inline";
  className?: string;
}

/** Inline failure with the API's message and a retry button. Announced via role="alert". */
export function ErrorState({
  error,
  title = "Could not load this",
  onRetry,
  retrying = false,
  variant = "card",
  className,
}: ErrorStateProps) {
  const message = errorMessage(error, "An unexpected error occurred.");
  const retry = onRetry ? (
    <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
      <RefreshCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
      Try again
    </Button>
  ) : null;

  if (variant === "inline") {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm",
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">{title}.</span> <span className="text-muted-foreground">{message}</span>
        </p>
        {retry}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        variant === "card" ? "rounded-lg border border-dashed border-danger-border bg-danger-subtle/40 py-10" : "py-8",
        className,
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-background ring-1 ring-danger-border">
        <CircleAlert aria-hidden="true" className="size-5 text-danger" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      {retry ? <div className="mt-5">{retry}</div> : null}
    </div>
  );
}

/** Generic stacked skeleton for a section that is loading. Prefer shape-matched skeletons. */
export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
