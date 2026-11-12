"use client";

/**
 * Reusable TanStack Query hooks for the main resources.
 *
 * Pattern for adding one:
 *   1. add a key to `keys.ts`;
 *   2. write `useThing(id)` with `useQuery({ queryKey: qk.things.detail(id), queryFn: () => unwrap<Thing>(api.GET(...)) })`;
 *   3. for mutations use `useApiMutation(fn, { invalidate: [qk.things.all] })`.
 *
 * Objects that embed signed file URLs (5 minute expiry) use FILE_URL_STALE_TIME and
 * FILE_URL_REFETCH so the URLs on screen are always fresh.
 */
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { api, setCsrfToken, unwrap } from "./client";
import { ApiError } from "./errors";
import { qk } from "./keys";
import type {
  Analysis,
  AnalysisDetail,
  AnalysisIn,
  AnalysisPatch,
  AnalysisStarted,
  AuditEntry,
  Dashboard,
  Device,
  DeviceIn,
  DevicePatch,
  Evidence,
  EvidencePatch,
  EvidenceCategory,
  Fingerprint,
  FingerprintDetail,
  Investigation,
  InvestigationIn,
  InvestigationPatch,
  InvestigationStatus,
  Job,
  Meta,
  Note,
  Page,
  PageParams,
  Policy,
  ProfileIn,
  ReferenceImage,
  Report,
  Sensor,
  SensorIn,
  SensorPatch,
  SessionInfo,
  Usage,
  User,
} from "./types";

/**
 * Request bodies are typed with the relaxed `Input<>` shapes from types.ts (fields with
 * server-side defaults are optional), so they are cast when handed to the generated client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** Signed file URLs expire after 5 minutes: treat objects carrying them as stale after 3.5. */
export const FILE_URL_STALE_TIME = 210_000;
/** Background refetch interval for mounted queries that carry signed file URLs. */
export const FILE_URL_REFETCH = 240_000;
/** Poll interval for a job that is queued or running. */
export const JOB_POLL_MS = 1_500;

const fileUrlOptions = {
  staleTime: FILE_URL_STALE_TIME,
  refetchInterval: FILE_URL_REFETCH,
} as const;

export function isJobActive(job: Pick<Job, "status"> | undefined | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}
export function isJobTerminal(job: Pick<Job, "status"> | undefined | null): boolean {
  return job?.status === "succeeded" || job?.status === "failed" || job?.status === "cancelled";
}

/* ------------------------------------------------------------------ session */

/** Resolves to `null` (not an error) when signed out. Keeps the in-memory CSRF token in sync. */
export const meQueryOptions = queryOptions({
  queryKey: qk.me,
  queryFn: async (): Promise<SessionInfo | null> => {
    try {
      const session = await unwrap(api.GET("/api/v1/auth/me"));
      setCsrfToken(session.csrf_token ?? null);
      return session;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setCsrfToken(null);
        return null;
      }
      throw err;
    }
  },
  staleTime: 60_000,
  retry: false,
});

export function useMe() {
  return useQuery(meQueryOptions);
}

export function useMeta() {
  return useQuery({
    queryKey: qk.meta,
    queryFn: () => unwrap<Meta>(api.GET("/api/v1/meta")),
    staleTime: 10 * 60_000,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => unwrap<Dashboard>(api.GET("/api/v1/dashboard")),
    staleTime: 15_000,
    // Poll quickly while work is running, otherwise just keep signed preview URLs fresh.
    refetchInterval: (q) => ((q.state.data?.active_jobs.length ?? 0) > 0 ? 2_500 : FILE_URL_REFETCH),
  });
}

export function usePolicies() {
  return useQuery({
    queryKey: qk.policies,
    queryFn: () => unwrap<Policy[]>(api.GET("/api/v1/policies")),
    staleTime: 10 * 60_000,
  });
}

export function useUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => unwrap<Usage>(api.GET("/api/v1/account/usage")) });
}

export function useAudit(params: PageParams & { action?: string } = {}) {
  return useQuery({
    queryKey: qk.audit(params),
    queryFn: () => unwrap<Page<AuditEntry>>(api.GET("/api/v1/account/audit", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

/* --------------------------------------------------------------------- jobs */

export function useJobs(params: PageParams & { active?: boolean } = {}, options: { poll?: boolean } = {}) {
  const poll = options.poll ?? true;
  return useQuery({
    queryKey: qk.jobs.list(params),
    queryFn: () => unwrap<Page<Job>>(api.GET("/api/v1/jobs", { params: { query: params } })),
    placeholderData: keepPreviousData,
    refetchInterval: poll
      ? (q) => (q.state.data?.items.some(isJobActive) ? 2_000 : 20_000)
      : false,
  });
}

/** Polls every 1.5 s while the job is queued or running, then stops. */
export function useJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: qk.jobs.detail(jobId ?? ""),
    queryFn: () => unwrap<Job>(api.GET("/api/v1/jobs/{job_id}", { params: { path: { job_id: jobId! } } })),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (!q.state.data || isJobActive(q.state.data) ? JOB_POLL_MS : false),
    refetchIntervalInBackground: true,
  });
}

/**
 * Invalidate everything a finished job may have changed. Call from `JobProgress.onDone`
 * (it does this for you by default).
 */
export function invalidateAfterJob(queryClient: QueryClient, job: Pick<Job, "kind" | "target_type">): void {
  const keys: QueryKey[] = [qk.jobs.all, qk.dashboard, qk.usage];
  const t = `${job.kind} ${job.target_type}`;
  if (t.includes("fingerprint")) keys.push(qk.fingerprints.all, qk.sensors.all, qk.devices.all);
  if (t.includes("analysis")) keys.push(qk.analyses.all, qk.investigations.all);
  if (t.includes("export")) keys.push(qk.exports);
  if (t.includes("report")) keys.push(qk.reports.all);
  for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
}

/* ---------------------------------------------------------- mutation helper */

/**
 * `useMutation` with invalidation built in. `invalidate` may be a list of keys or a function
 * of the result and variables. Errors are `ApiError`; surface `error.message` (the shared
 * toast helper `toastError` in `@/lib/toast` does this).
 */
export function useApiMutation<TData, TVars = void>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: Omit<UseMutationOptions<TData, ApiError, TVars>, "mutationFn"> & {
    invalidate?: QueryKey[] | ((data: TData, vars: TVars) => QueryKey[]);
  } = {},
) {
  const queryClient = useQueryClient();
  const { invalidate, onSuccess, ...rest } = options;
  return useMutation<TData, ApiError, TVars>({
    mutationFn,
    ...rest,
    onSuccess: async (...args) => {
      const [data, vars] = args;
      const keys = typeof invalidate === "function" ? invalidate(data, vars) : (invalidate ?? []);
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      return onSuccess?.(...args);
    },
  });
}

export function useCancelJob() {
  return useApiMutation(
    (jobId: string) =>
      unwrap<Job>(api.POST("/api/v1/jobs/{job_id}/cancel", { params: { path: { job_id: jobId } } })),
    { invalidate: [qk.jobs.all, qk.dashboard] },
  );
}

/* ------------------------------------------------------------------ profile */

export function useUpdateProfile() {
  return useApiMutation(
    (body: ProfileIn) => unwrap<User>(api.PATCH("/api/v1/auth/me", { body: body as Body })),
    { invalidate: [qk.me, qk.dashboard] },
  );
}

/* --------------------------------------------------------------- demo data */

const EVERYTHING: QueryKey[] = [
  qk.dashboard,
  qk.devices.all,
  qk.sensors.all,
  qk.fingerprints.all,
  qk.investigations.all,
  qk.evidence.all,
  qk.analyses.all,
  qk.reports.all,
  qk.jobs.all,
  qk.usage,
];

/** Creates the synthetic demo data set. Resolves with the ids of what was created. */
export function useCreateDemo() {
  return useApiMutation(
    () =>
      unwrap<{ sensor_ids?: string[]; evidence_ids?: string[]; job_ids?: string[]; investigation_id?: string }>(
        api.POST("/api/v1/demo"),
      ),
    { invalidate: EVERYTHING },
  );
}
export function useDeleteDemo() {
  return useApiMutation(() => unwrap(api.DELETE("/api/v1/demo")), { invalidate: EVERYTHING });
}

/* ------------------------------------------------------------------ devices */

export function useDevices(params: PageParams = {}) {
  return useQuery({
    queryKey: qk.devices.list(params),
    queryFn: () => unwrap<Page<Device>>(api.GET("/api/v1/devices", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}
export function useDevice(deviceId: string | undefined) {
  return useQuery({
    queryKey: qk.devices.detail(deviceId ?? ""),
    queryFn: () =>
      unwrap<Device>(api.GET("/api/v1/devices/{device_id}", { params: { path: { device_id: deviceId! } } })),
    enabled: Boolean(deviceId),
  });
}
export function useCreateDevice() {
  return useApiMutation((body: DeviceIn) => unwrap<Device>(api.POST("/api/v1/devices", { body: body as Body })), {
    invalidate: [qk.devices.all, qk.dashboard],
  });
}
export function useUpdateDevice(deviceId: string) {
  return useApiMutation(
    (body: DevicePatch) =>
      unwrap<Device>(api.PATCH("/api/v1/devices/{device_id}", { params: { path: { device_id: deviceId } }, body: body as Body })),
    { invalidate: [qk.devices.all, qk.sensors.all] },
  );
}
export function useDeleteDevice() {
  return useApiMutation(
    (deviceId: string) =>
      unwrap(api.DELETE("/api/v1/devices/{device_id}", { params: { path: { device_id: deviceId } } })),
    { invalidate: [qk.devices.all, qk.sensors.all, qk.dashboard, qk.usage] },
  );
}

/* ------------------------------------------------------------------ sensors */

export function useSensors(params: PageParams & { ready?: boolean } = {}) {
  return useQuery({
    queryKey: qk.sensors.list(params),
    queryFn: () => unwrap<Page<Sensor>>(api.GET("/api/v1/sensors", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}
export function useSensor(sensorId: string | undefined) {
  return useQuery({
    queryKey: qk.sensors.detail(sensorId ?? ""),
    queryFn: () =>
      unwrap<Sensor>(api.GET("/api/v1/sensors/{sensor_id}", { params: { path: { sensor_id: sensorId! } } })),
    enabled: Boolean(sensorId),
  });
}
export function useCreateSensor(deviceId: string) {
  return useApiMutation(
    (body: SensorIn) =>
      unwrap<Sensor>(
        api.POST("/api/v1/devices/{device_id}/sensors", { params: { path: { device_id: deviceId } }, body: body as Body }),
      ),
    { invalidate: [qk.devices.all, qk.sensors.all, qk.dashboard] },
  );
}
export function useUpdateSensor(sensorId: string) {
  return useApiMutation(
    (body: SensorPatch) =>
      unwrap<Sensor>(api.PATCH("/api/v1/sensors/{sensor_id}", { params: { path: { sensor_id: sensorId } }, body: body as Body })),
    { invalidate: [qk.sensors.all, qk.devices.all] },
  );
}
export function useDeleteSensor() {
  return useApiMutation(
    (sensorId: string) =>
      unwrap(api.DELETE("/api/v1/sensors/{sensor_id}", { params: { path: { sensor_id: sensorId } } })),
    { invalidate: [qk.sensors.all, qk.devices.all, qk.dashboard, qk.usage] },
  );
}

/** Reference images carry signed `preview_url`s. */
export function useReferences(sensorId: string | undefined, params: PageParams = {}) {
  return useQuery({
    queryKey: qk.sensors.references(sensorId ?? "", params),
    queryFn: () =>
      unwrap<Page<ReferenceImage>>(
        api.GET("/api/v1/sensors/{sensor_id}/references", {
          params: { path: { sensor_id: sensorId! }, query: params },
        }),
      ),
    enabled: Boolean(sensorId),
    placeholderData: keepPreviousData,
    ...fileUrlOptions,
  });
}
export function useDeleteReference() {
  return useApiMutation(
    (referenceId: string) =>
      unwrap(api.DELETE("/api/v1/references/{reference_id}", { params: { path: { reference_id: referenceId } } })),
    { invalidate: [qk.sensors.all, qk.usage] },
  );
}

/* ------------------------------------------------------------- fingerprints */

export function useFingerprints(sensorId: string | undefined) {
  return useQuery({
    queryKey: qk.sensors.fingerprints(sensorId ?? ""),
    queryFn: () =>
      unwrap<Fingerprint[]>(
        api.GET("/api/v1/sensors/{sensor_id}/fingerprints", { params: { path: { sensor_id: sensorId! } } }),
      ),
    enabled: Boolean(sensorId),
  });
}
/** Fingerprint detail carries signed `visual_url`, `spectrum_url` and `download_url`. */
export function useFingerprint(fingerprintId: string | null | undefined) {
  return useQuery({
    queryKey: qk.fingerprints.detail(fingerprintId ?? ""),
    queryFn: () =>
      unwrap<FingerprintDetail>(
        api.GET("/api/v1/fingerprints/{fingerprint_id}", { params: { path: { fingerprint_id: fingerprintId! } } }),
      ),
    enabled: Boolean(fingerprintId),
    ...fileUrlOptions,
  });
}
/** Starts a fingerprint build. Resolves with `{ fingerprint, job }`: pass `job.id` to `JobProgress`. */
export function useStartFingerprint(sensorId: string) {
  return useApiMutation(
    () =>
      unwrap<{ fingerprint: Fingerprint; job: Job }>(
        api.POST("/api/v1/sensors/{sensor_id}/fingerprints", { params: { path: { sensor_id: sensorId } } }),
      ),
    { invalidate: [qk.sensors.all, qk.jobs.all, qk.dashboard] },
  );
}
export function useActivateFingerprint() {
  return useApiMutation(
    (fingerprintId: string) =>
      unwrap<FingerprintDetail>(
        api.POST("/api/v1/fingerprints/{fingerprint_id}/activate", {
          params: { path: { fingerprint_id: fingerprintId } },
        }),
      ),
    { invalidate: [qk.sensors.all, qk.fingerprints.all, qk.devices.all, qk.dashboard] },
  );
}
export function useDeleteFingerprint() {
  return useApiMutation(
    (fingerprintId: string) =>
      unwrap(
        api.DELETE("/api/v1/fingerprints/{fingerprint_id}", { params: { path: { fingerprint_id: fingerprintId } } }),
      ),
    { invalidate: [qk.sensors.all, qk.fingerprints.all, qk.devices.all, qk.dashboard, qk.usage] },
  );
}

/* ----------------------------------------------------------- investigations */

export function useInvestigations(params: PageParams & { status?: InvestigationStatus; q?: string } = {}) {
  return useQuery({
    queryKey: qk.investigations.list(params),
    queryFn: () =>
      unwrap<Page<Investigation>>(api.GET("/api/v1/investigations", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}
export function useInvestigation(id: string | undefined) {
  return useQuery({
    queryKey: qk.investigations.detail(id ?? ""),
    queryFn: () =>
      unwrap<Investigation>(
        api.GET("/api/v1/investigations/{investigation_id}", { params: { path: { investigation_id: id! } } }),
      ),
    enabled: Boolean(id),
  });
}
export function useCreateInvestigation() {
  return useApiMutation(
    (body: InvestigationIn) => unwrap<Investigation>(api.POST("/api/v1/investigations", { body: body as Body })),
    { invalidate: [qk.investigations.all, qk.dashboard] },
  );
}
export function useUpdateInvestigation(id: string) {
  return useApiMutation(
    (body: InvestigationPatch) =>
      unwrap<Investigation>(
        api.PATCH("/api/v1/investigations/{investigation_id}", { params: { path: { investigation_id: id } }, body: body as Body }),
      ),
    { invalidate: [qk.investigations.all, qk.dashboard] },
  );
}
export function useDeleteInvestigation() {
  return useApiMutation(
    (id: string) =>
      unwrap(api.DELETE("/api/v1/investigations/{investigation_id}", { params: { path: { investigation_id: id } } })),
    { invalidate: [qk.investigations.all, qk.evidence.all, qk.analyses.all, qk.reports.all, qk.dashboard, qk.usage] },
  );
}
export function useInvestigationNotes(id: string | undefined) {
  return useQuery({
    queryKey: qk.investigations.notes(id ?? ""),
    queryFn: () =>
      unwrap<Note[]>(
        api.GET("/api/v1/investigations/{investigation_id}/notes", { params: { path: { investigation_id: id! } } }),
      ),
    enabled: Boolean(id),
  });
}
export function useAddNote(investigationId: string) {
  return useApiMutation(
    (body: string) =>
      unwrap<Note>(
        api.POST("/api/v1/investigations/{investigation_id}/notes", {
          params: { path: { investigation_id: investigationId } },
          body: { body },
        }),
      ),
    { invalidate: [qk.investigations.detail(investigationId), qk.investigations.lists()] },
  );
}
export function useDeleteNote(investigationId: string) {
  return useApiMutation(
    (noteId: string) => unwrap(api.DELETE("/api/v1/notes/{note_id}", { params: { path: { note_id: noteId } } })),
    { invalidate: [qk.investigations.detail(investigationId), qk.investigations.lists()] },
  );
}
export function useInvestigationHistory(id: string | undefined, params: PageParams = {}) {
  return useQuery({
    queryKey: qk.investigations.history(id ?? "", params),
    queryFn: () =>
      unwrap<Page<AuditEntry>>(
        api.GET("/api/v1/investigations/{investigation_id}/history", {
          params: { path: { investigation_id: id! }, query: params },
        }),
      ),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

/* ----------------------------------------------------------------- evidence */

export interface EvidenceListParams extends PageParams {
  investigation_id?: string;
  unassigned?: boolean;
  category?: EvidenceCategory;
}
/** Evidence carries signed `preview_url` and `download_url`. */
export function useEvidenceList(params: EvidenceListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.evidence.list(params),
    queryFn: () => unwrap<Page<Evidence>>(api.GET("/api/v1/evidence", { params: { query: params } })),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    ...fileUrlOptions,
  });
}
export function useEvidence(evidenceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.evidence.detail(evidenceId ?? ""),
    queryFn: () =>
      unwrap<Evidence>(
        api.GET("/api/v1/evidence/{evidence_id}", { params: { path: { evidence_id: evidenceId! } } }),
      ),
    enabled: Boolean(evidenceId),
    ...fileUrlOptions,
  });
}
export function useUpdateEvidence() {
  return useApiMutation(
    ({ id, ...body }: EvidencePatch & { id: string }) =>
      unwrap<Evidence>(
        api.PATCH("/api/v1/evidence/{evidence_id}", { params: { path: { evidence_id: id } }, body: body as Body }),
      ),
    { invalidate: [qk.evidence.all, qk.investigations.all] },
  );
}
export function useDeleteEvidence() {
  return useApiMutation(
    (evidenceId: string) =>
      unwrap(api.DELETE("/api/v1/evidence/{evidence_id}", { params: { path: { evidence_id: evidenceId } } })),
    { invalidate: [qk.evidence.all, qk.investigations.all, qk.analyses.all, qk.dashboard, qk.usage] },
  );
}

/* ----------------------------------------------------------------- analyses */

export interface AnalysisListParams extends PageParams {
  investigation_id?: string;
  evidence_id?: string;
  unassigned?: boolean;
}
/** Analyses carry a signed `evidence_preview_url`. */
export function useAnalyses(params: AnalysisListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.analyses.list(params),
    queryFn: () => unwrap<Page<Analysis>>(api.GET("/api/v1/analyses", { params: { query: params } })),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    ...fileUrlOptions,
  });
}
export function useAnalysis(analysisId: string | undefined) {
  return useQuery({
    queryKey: qk.analyses.detail(analysisId ?? ""),
    queryFn: () =>
      unwrap<AnalysisDetail>(
        api.GET("/api/v1/analyses/{analysis_id}", { params: { path: { analysis_id: analysisId! } } }),
      ),
    enabled: Boolean(analysisId),
    ...fileUrlOptions,
  });
}
/** Starts one analysis per evidence id. Resolves with `{ analyses, jobs }`. */
export function useStartAnalyses() {
  return useApiMutation((body: AnalysisIn) => unwrap<AnalysisStarted>(api.POST("/api/v1/analyses", { body: body as Body })), {
    invalidate: [qk.analyses.all, qk.jobs.all, qk.dashboard, qk.investigations.all],
  });
}
export function useUpdateAnalysis() {
  return useApiMutation(
    ({ id, ...body }: AnalysisPatch & { id: string }) =>
      unwrap<Analysis>(
        api.PATCH("/api/v1/analyses/{analysis_id}", { params: { path: { analysis_id: id } }, body: body as Body }),
      ),
    { invalidate: [qk.analyses.all, qk.investigations.all] },
  );
}
export function useDeleteAnalysis() {
  return useApiMutation(
    (analysisId: string) =>
      unwrap(api.DELETE("/api/v1/analyses/{analysis_id}", { params: { path: { analysis_id: analysisId } } })),
    { invalidate: [qk.analyses.all, qk.investigations.all, qk.reports.all, qk.dashboard] },
  );
}

/* ------------------------------------------------------------------ reports */

export interface ReportListParams extends PageParams {
  analysis_id?: string;
  investigation_id?: string;
}
/** Reports carry a signed `download_url`. */
export function useReports(params: ReportListParams = {}) {
  return useQuery({
    queryKey: qk.reports.list(params),
    queryFn: () => unwrap<Page<Report>>(api.GET("/api/v1/reports", { params: { query: params } })),
    placeholderData: keepPreviousData,
    ...fileUrlOptions,
  });
}
export function useReport(reportId: string | undefined) {
  return useQuery({
    queryKey: qk.reports.detail(reportId ?? ""),
    queryFn: () =>
      unwrap<Report>(api.GET("/api/v1/reports/{report_id}", { params: { path: { report_id: reportId! } } })),
    enabled: Boolean(reportId),
    ...fileUrlOptions,
  });
}
export function useCreateAnalysisReport() {
  return useApiMutation(
    (analysisId: string) =>
      unwrap<Report>(
        api.POST("/api/v1/analyses/{analysis_id}/reports", { params: { path: { analysis_id: analysisId } } }),
      ),
    { invalidate: [qk.reports.all, qk.dashboard, qk.usage] },
  );
}
export function useCreateInvestigationReport() {
  return useApiMutation(
    (investigationId: string) =>
      unwrap<Report>(
        api.POST("/api/v1/investigations/{investigation_id}/reports", {
          params: { path: { investigation_id: investigationId } },
        }),
      ),
    { invalidate: [qk.reports.all, qk.dashboard, qk.usage] },
  );
}
export function useDeleteReport() {
  return useApiMutation(
    (reportId: string) =>
      unwrap(api.DELETE("/api/v1/reports/{report_id}", { params: { path: { report_id: reportId } } })),
    { invalidate: [qk.reports.all, qk.dashboard, qk.usage] },
  );
}
