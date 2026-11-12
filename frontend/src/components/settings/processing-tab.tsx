"use client";

import { Cpu, Gauge, Library, ServerCog, ShieldAlert, Users } from "lucide-react";

import { Detail, Notice, Panel } from "@/components/cameras/shared";
import { ErrorState } from "@/components/st/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminConfig, useAdminStats } from "@/lib/api/account-hooks";
import { useMeta } from "@/lib/api/hooks";
import { useUser } from "@/lib/auth";
import { JOB_STATUS_LABELS } from "@/lib/domain";
import { formatBytes, formatNumber, humanize } from "@/lib/format";

const LIMIT_LABELS: Record<string, string> = {
  max_upload_bytes: "Largest file accepted",
  max_request_bytes: "Largest upload request",
  max_image_pixels: "Largest image",
  max_files_per_request: "Files per upload request",
  max_reference_images: "Reference images per sensor",
  max_candidates_per_analysis: "Sensors compared per analysis",
  recommended_reference_images: "Recommended reference images",
  min_reference_images: "Minimum reference images",
  user_storage_quota_bytes: "Storage quota per user",
  max_active_jobs_per_user: "Concurrent jobs per user",
  file_token_seconds: "File link lifetime",
  job_timeout_seconds: "Job time limit",
  session_hours: "Session lifetime",
  rate_auth_per_15min: "Sign-in attempts per 15 minutes",
  rate_api_per_minute: "API requests per minute",
  rate_upload_per_hour: "Uploads per hour",
  worker_memory_limit_mb: "Worker memory limit",
  default_retention_days: "Default retention",
};

/** Formats a limit by the unit its key name declares. */
function formatLimit(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "number") return value === null || value === undefined ? "-" : String(value);
  if (key.endsWith("_bytes")) return formatBytes(value, 0);
  if (key.endsWith("_pixels")) return `${formatNumber(value / 1_000_000, 1)} megapixels`;
  if (key.endsWith("_seconds")) return value >= 120 ? `${formatNumber(value / 60, 1)} minutes` : `${formatNumber(value)} seconds`;
  if (key.endsWith("_hours")) return `${formatNumber(value)} hours`;
  if (key.endsWith("_mb")) return `${formatNumber(value)} MB`;
  if (key.endsWith("_days")) return value === 0 ? "Keep until deleted" : `${formatNumber(value)} days`;
  return formatNumber(value);
}

function LimitList({ limits }: { limits: Record<string, unknown> }) {
  return (
    <dl className="-my-2 divide-y">
      {Object.entries(limits).map(([key, value]) => (
        <Detail key={key} label={LIMIT_LABELS[key] ?? humanize(key)} className="sm:grid-cols-[16rem_minmax(0,1fr)]">
          <span className="font-mono text-xs">{formatLimit(key, value)}</span>
        </Detail>
      ))}
    </dl>
  );
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <div role="status" aria-label={`Loading ${title.toLowerCase()}`} className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </Panel>
  );
}

function AdminSection() {
  const config = useAdminConfig(true);
  const stats = useAdminStats(true);
  return (
    <>
      <Notice tone="info" title="Administrator view">
        The values below are read-only. They are set through environment variables when the server is deployed and
        cannot be changed from the app. The statistics are totals for the whole server; they never include other
        users&apos; evidence, fingerprints or results.
      </Notice>

      {config.isPending ? (
        <PanelSkeleton title="Server configuration" />
      ) : config.isError ? (
        <ErrorState title="Could not load the server configuration" error={config.error} onRetry={() => void config.refetch()} retrying={config.isFetching} />
      ) : (
        <Panel title="Server configuration" icon={ServerCog}>
          <dl className="-mt-2 mb-2 divide-y border-b">
            <Detail label="Environment" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              <span className="font-mono text-xs">{config.data.environment ?? "-"}</span>
            </Detail>
            <Detail label="Storage backend" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              <span className="font-mono text-xs">{config.data.storage_backend ?? "-"}</span>
            </Detail>
            <Detail label="Registration" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              {config.data.registration_open === undefined ? "-" : config.data.registration_open ? "Open" : "Closed"}
            </Detail>
          </dl>
          <LimitList limits={config.data.limits ?? {}} />
        </Panel>
      )}

      {stats.isPending ? (
        <PanelSkeleton title="Server statistics" />
      ) : stats.isError ? (
        <ErrorState title="Could not load server statistics" error={stats.error} onRetry={() => void stats.refetch()} retrying={stats.isFetching} />
      ) : (
        <Panel title="Server statistics" icon={Users}>
          <dl className="-my-2 divide-y">
            <Detail label="User accounts" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              <span className="font-mono text-xs">{formatNumber(stats.data.users)}</span>
            </Detail>
            <Detail label="Analyses run" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              <span className="font-mono text-xs">{formatNumber(stats.data.analyses)}</span>
            </Detail>
            <Detail label="Evidence stored" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
              <span className="font-mono text-xs">{formatBytes(stats.data.evidence_bytes)}</span>
            </Detail>
            {Object.entries(stats.data.jobs_by_status ?? {}).map(([status, count]) => (
              <Detail key={status} label={`Jobs: ${(JOB_STATUS_LABELS[status] ?? humanize(status)).toLowerCase()}`} className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{formatNumber(count)}</span>
              </Detail>
            ))}
          </dl>
        </Panel>
      )}
    </>
  );
}

export function ProcessingTab() {
  const user = useUser();
  const meta = useMeta();

  return (
    <div className="flex flex-col gap-6">
      {meta.isPending ? (
        <>
          <PanelSkeleton title="Versions" />
          <PanelSkeleton title="Limits" />
        </>
      ) : meta.isError ? (
        <ErrorState title="Could not load processing information" error={meta.error} onRetry={() => void meta.refetch()} retrying={meta.isFetching} />
      ) : (
        <>
          <Panel
            title="Versions"
            icon={Cpu}
            description="Every fingerprint and analysis records the versions it was produced with, so a result can be traced to the exact method used."
          >
            <dl className="-my-2 divide-y">
              <Detail label="API version" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{meta.data.api_version}</span>
              </Detail>
              <Detail label="Engine version" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{meta.data.engine_version}</span>
              </Detail>
              <Detail label="Fingerprint algorithm" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{meta.data.algorithm_version}</span>
              </Detail>
              <Detail label="Decision policy" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{meta.data.decision_policy_version}</span>
              </Detail>
              <Detail label="Accepted image formats" className="sm:grid-cols-[16rem_minmax(0,1fr)]">
                <span className="font-mono text-xs">{meta.data.supported_formats.join(", ")}</span>
              </Detail>
            </dl>
          </Panel>

          <Panel title="Numerical libraries" icon={Library}>
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(meta.data.libraries as Record<string, string>).map(([name, version]) => (
                <li key={name} className="rounded-md border px-1.5 py-0.5 font-mono text-xs">
                  {name} <span className="text-muted-foreground">{version}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Limits" icon={Gauge} description="Limits that apply to your uploads and analyses on this server.">
            <LimitList limits={meta.data.limits} />
          </Panel>
        </>
      )}

      {user.role === "admin" ? (
        <AdminSection />
      ) : (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Processing settings are fixed by the server operator through environment variables. Administrators see the
          full server configuration here.
        </p>
      )}
    </div>
  );
}
