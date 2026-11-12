"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable key for React and for `aria` wiring. */
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Right-align numbers, and render them in mono via `className`. */
  align?: "left" | "right" | "center";
  /** Extra classes for both header and body cells (widths, `hidden md:table-cell`). */
  className?: string;
  /** Width of the loading skeleton bar, e.g. "w-24". */
  skeleton?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  /** `query.data?.items`. `undefined` while loading. */
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  /** First load (no data yet): shows skeleton rows. */
  loading?: boolean;
  /** Background refetch with previous data on screen: dims the body. */
  fetching?: boolean;
  /** Rendered instead of the table when there are no rows (use `<EmptyState>`). */
  empty?: React.ReactNode;
  /** Rendered instead of the table when the query failed (use `<ErrorState>`). */
  error?: React.ReactNode;
  /** Accessible name for the table. */
  caption: string;
  skeletonRows?: number;
  onRowClick?: (row: T) => void;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Dense, typed table with built-in loading, empty and error handling.
 * Columns scroll horizontally on small screens; hide secondary columns with
 * `className: "hidden md:table-cell"`.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  fetching = false,
  empty,
  error,
  caption,
  skeletonRows = 5,
  onRowClick,
  className,
}: DataTableProps<T>) {
  if (error) return <>{error}</>;
  if (!loading && rows && rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn("overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10", className)}>
      <Table aria-busy={loading || fetching}>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.id}
                scope="col"
                className={cn("eyebrow h-9 bg-muted/40", ALIGN[col.align ?? "left"], col.className)}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn("transition-opacity", fetching && !loading && "opacity-60")}>
          {loading || !rows
            ? Array.from({ length: skeletonRows }, (_, r) => (
                <TableRow key={r} className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableCell key={col.id} className={col.className}>
                      <Skeleton className={cn("h-4", col.skeleton ?? "w-24", col.align === "right" && "ml-auto")} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row, index) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {columns.map((col) => (
                    <TableCell key={col.id} className={cn(ALIGN[col.align ?? "left"], col.className)}>
                      {col.cell(row, index)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* -------------------------------------------------------------- pagination */

export interface PaginationState {
  limit: number;
  offset: number;
  /** Spread into a list hook: `useDevices(pagination.params)`. */
  params: { limit: number; offset: number };
  page: number;
  setPage: (page: number) => void;
  next: () => void;
  previous: () => void;
  reset: () => void;
}

/** Offset pagination state matching the API's `{items,total,limit,offset}` lists. */
export function usePagination(pageSize = 25): PaginationState {
  const [page, setPage] = useState(0);
  const offset = page * pageSize;
  return {
    limit: pageSize,
    offset,
    params: { limit: pageSize, offset },
    page,
    setPage: (p) => setPage(Math.max(0, p)),
    next: () => setPage((p) => p + 1),
    previous: () => setPage((p) => Math.max(0, p - 1)),
    reset: () => setPage(0),
  };
}

export interface DataTablePaginationProps {
  pagination: PaginationState;
  /** `query.data?.total` */
  total: number | undefined;
  /** Noun for the count line, e.g. "cameras". */
  label?: string;
  className?: string;
}

/** "1-25 of 240 cameras" with previous/next buttons. Renders nothing for a single page. */
export function DataTablePagination({ pagination, total, label = "items", className }: DataTablePaginationProps) {
  if (total === undefined || total <= pagination.limit) {
    return total ? (
      <p className={cn("mt-3 text-xs text-muted-foreground", className)}>
        {formatNumber(total)} {label}
      </p>
    ) : null;
  }
  const from = pagination.offset + 1;
  const to = Math.min(total, pagination.offset + pagination.limit);
  return (
    <nav aria-label="Pagination" className={cn("mt-3 flex items-center justify-between gap-3", className)}>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {formatNumber(from)}-{formatNumber(to)} of {formatNumber(total)} {label}
      </p>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={pagination.previous} disabled={pagination.offset === 0}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={pagination.next} disabled={to >= total}>
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
