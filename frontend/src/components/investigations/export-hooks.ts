"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { FILE_URL_REFETCH, FILE_URL_STALE_TIME, useApiMutation } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import type { ExportOut, Job } from "@/lib/api/types";

/** Data exports of the account (ZIP archives). Carries signed `download_url`s. */
export function useDataExports() {
  return useQuery({
    queryKey: qk.exports,
    queryFn: () => unwrap<ExportOut[]>(api.GET("/api/v1/account/exports")),
    staleTime: FILE_URL_STALE_TIME,
    refetchInterval: FILE_URL_REFETCH,
  });
}

/** Starts a ZIP export of one investigation. Resolves with `{ export, job }`. */
export function useStartInvestigationExport(investigationId: string) {
  return useApiMutation(
    () =>
      unwrap<{ export: ExportOut; job: Job }>(
        api.POST("/api/v1/investigations/{investigation_id}/export", { params: { path: { investigation_id: investigationId } } }),
      ),
    { invalidate: [qk.exports, qk.jobs.all, qk.investigations.detail(investigationId)] },
  );
}

export function useDeleteDataExport() {
  return useApiMutation(
    (exportId: string) => unwrap(api.DELETE("/api/v1/account/exports/{export_id}", { params: { path: { export_id: exportId } } })),
    { invalidate: [qk.exports, qk.usage] },
  );
}
