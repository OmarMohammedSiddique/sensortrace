"use client";

import { Aperture, ArrowRight, Fingerprint as FingerprintIcon, GitCompareArrows, Images, Pencil, Trash2, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-context";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { Hash } from "@/components/st/hash";
import { JobProgress } from "@/components/st/job-progress";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Stat } from "@/components/st/stat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { useDeleteSensor, useFingerprint, useMeta, useSensor } from "@/lib/api/hooks";
import type { Sensor } from "@/lib/api/types";
import { formatNumber, formatPce, pluralize } from "@/lib/format";
import { toastSuccess } from "@/lib/toast";

import { diagnosticsOf } from "./fingerprint-types";
import { EditSensorDialog } from "./sensor-dialog";
import { FingerprintTab } from "./sensor-fingerprint";
import { QualityTab } from "./sensor-quality";
import { ReferencesTab } from "./sensor-references";
import { isNotFound, needsControls, Notice, Panel, PipelineBadge, positionLabel, SensorStatus, useSensorBuild } from "./shared";

const TABS = ["overview", "references", "fingerprint", "quality"] as const;

/* --------------------------------------------------------------- overview */

function NextStep({ sensor, building, submitted, onTab }: { sensor: Sensor; building: boolean; submitted: number | undefined; onTab: (tab: string) => void }) {
  const meta = useMeta();
  const refs = sensor.reference_count ?? 0;
  const min = meta.data?.limits.min_reference_images ?? 2;
  const recommended = meta.data?.limits.recommended_reference_images;
  const fp = sensor.active_fingerprint;

  let title: string;
  let body: React.ReactNode;
  let action: React.ReactNode;

  if (building) {
    title = "A fingerprint is being estimated";
    body = "You can leave this page. The job continues in the background and the sensor becomes ready when it finishes.";
    action = (
      <Button variant="outline" onClick={() => onTab("fingerprint")}>
        View progress <ArrowRight aria-hidden="true" data-icon="inline-end" />
      </Button>
    );
  } else if (refs === 0) {
    title = "Upload reference images";
    body = "Take flat, bright, evenly lit photos with this exact lens and mode, then upload the original files.";
    action = (
      <Button onClick={() => onTab("references")}>
        <Upload aria-hidden="true" /> Add reference images
      </Button>
    );
  } else if (refs < min) {
    title = "Add more reference images";
    body = `A fingerprint needs at least ${min} reference images${recommended ? `; ${recommended} or more are recommended` : ""}.`;
    action = (
      <Button onClick={() => onTab("references")}>
        <Upload aria-hidden="true" /> Add reference images
      </Button>
    );
  } else if (!fp) {
    title = "Create the fingerprint";
    body =
      recommended && refs < recommended
        ? `You have ${pluralize(refs, "reference image")}. That is enough to build a fingerprint, but ${recommended} or more give a stronger one.`
        : `You have ${pluralize(refs, "reference image")}. Estimate the sensor fingerprint from them.`;
    action = (
      <Button onClick={() => onTab("fingerprint")}>
        <FingerprintIcon aria-hidden="true" /> Go to fingerprint
      </Button>
    );
  } else if (submitted !== undefined && refs > submitted) {
    title = "New reference images are not in the fingerprint yet";
    body = `Fingerprint v${fp.version} was built when this sensor had ${pluralize(submitted, "reference image")}; it now has ${formatNumber(refs)}. Create a new version to include the new ones.`;
    action = (
      <Button variant="outline" onClick={() => onTab("fingerprint")}>
        <FingerprintIcon aria-hidden="true" /> Go to fingerprint
      </Button>
    );
  } else {
    title = "Ready to compare";
    body = "Test a questioned image against this sensor. The result says whether the image is consistent with this fingerprint; it cannot name an unknown camera.";
    action = (
      <Button asChild>
        <Link href="/app/compare">
          <GitCompareArrows aria-hidden="true" /> Compare an image
        </Link>
      </Button>
    );
  }

  return (
    <section aria-labelledby="next-step-title" className="flex flex-col gap-3 rounded-lg border border-brand-border bg-brand-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">Next step</p>
        <h2 id="next-step-title" className="mt-1 text-sm font-medium">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}

function OverviewTab({ sensor, onTab }: { sensor: Sensor; onTab: (tab: string) => void }) {
  const { building, job } = useSensorBuild(sensor.id);
  const active = sensor.active_fingerprint;
  const detail = useFingerprint(sensor.active_fingerprint_id);
  const diag = diagnosticsOf(detail.data);
  const warnings = diag.warnings ?? [];
  const splitHalf = diag.split_half?.pce;

  return (
    <div className="flex flex-col gap-6">
      <NextStep sensor={sensor} building={Boolean(building)} submitted={diag.screening?.submitted} onTab={onTab} />

      {building && job ? <JobProgress jobId={job.id} title={`Estimating fingerprint v${building.version}`} /> : null}

      <Panel title="Status" icon={Aperture}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <Stat label="State" value={<SensorStatus sensor={sensor} building={Boolean(building)} className="text-sm" />} />
          <Stat label="Reference images" value={formatNumber(sensor.reference_count ?? 0)} />
          <Stat label="Position" value={positionLabel(sensor.position)} />
          <Stat label="Added" value={<FormattedDate value={sensor.created_at} mode="date" />} />
        </dl>
        {sensor.notes ? (
          <p className="mt-4 border-t pt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{sensor.notes}</p>
        ) : null}
      </Panel>

      <Panel
        title="Active fingerprint"
        icon={FingerprintIcon}
        action={
          active ? (
            <Button variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground" onClick={() => onTab("fingerprint")}>
              Details and versions <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          ) : null
        }
      >
        {!active ? (
          <EmptyState
            variant="plain"
            icon={FingerprintIcon}
            title="No fingerprint yet"
            description="A fingerprint is the sensor's noise pattern, estimated from its reference images. Questioned images are compared against it."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
              <Stat label="Version" value={`v${active.version}`} mono />
              <Stat label="Images used" value={formatNumber(active.n_images)} />
              <Stat
                label="Dimensions"
                value={active.width && active.height ? `${formatNumber(active.width)} × ${formatNumber(active.height)}` : "-"}
                unit="px"
                mono
              />
              <Stat label="Created" value={<FormattedDate value={active.created_at} mode="date" />} />
              <Stat
                className="col-span-2"
                label="Split-half PCE"
                loading={detail.isPending}
                value={formatPce(splitHalf)}
                mono
                hint="Two fingerprints built from separate halves of the references, compared with each other. A large positive value means the pattern is reproducible."
              />
              <Stat className="col-span-2" label="Algorithm" value={active.algorithm_version || "-"} mono />
            </dl>
            <div className="border-t pt-3">
              <p className="eyebrow mb-1">Fingerprint digest</p>
              <Hash value={active.digest} label="fingerprint digest" chars={12} />
            </div>
            {detail.isError ? (
              <ErrorState variant="inline" title="Could not load fingerprint diagnostics" error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
            ) : null}
            {warnings.length > 0 ? (
              <div className="flex flex-col gap-2" aria-label="Fingerprint warnings">
                {warnings.map((w) => (
                  <Notice key={w} tone="warning">
                    <span className="text-foreground">{w}</span>
                  </Notice>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {needsControls(sensor.pipeline_class) ? (
        <Notice tone="info" title="Same-model control needed for this camera">
          {sensor.device_name} is not declared as a conventional pipeline. A high statistic supports a match only when
          another device of the same make and model is enrolled as a control.{" "}
          <Link href={`/app/cameras/${sensor.device_id}`} className="font-medium text-foreground underline underline-offset-4">
            Check its controls
          </Link>
          .
        </Notice>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading sensor" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="h-56 rounded-lg" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function SensorProfileInner() {
  const { sensorId } = useParams<{ sensorId: string }>();
  const router = useRouter();
  const sensor = useSensor(sensorId);
  const remove = useDeleteSensor();
  const [tab, setTab] = useUrlTab(TABS, "overview");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useBreadcrumbLabel(sensor.data ? `${sensor.data.device_name} / ${sensor.data.name}` : null);

  if (sensor.isPending || (leaving && !sensor.data)) return <ProfileSkeleton />;
  if (sensor.isError && !sensor.data) {
    return isNotFound(sensor.error) ? (
      <EmptyState
        icon={Aperture}
        title="Sensor not found"
        description="It may have been deleted with its camera, or the link is wrong."
        action={
          <Button asChild>
            <Link href="/app/cameras">Back to cameras</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState title="Could not load this sensor" error={sensor.error} onRetry={() => void sensor.refetch()} retrying={sensor.isFetching} />
    );
  }

  const s = sensor.data;
  if (!s) return <ProfileSkeleton />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/app/cameras/${s.device_id}`} className="underline-offset-4 hover:underline">
            {s.device_name}
          </Link>
        }
        title={s.name}
        badges={
          <>
            <DemoBadge when={s.is_demo} />
            <PipelineBadge value={s.pipeline_class} />
          </>
        }
        description={
          <>
            {[s.device_make, s.device_model].filter(Boolean).join(" ") || "Make and model not recorded"}
            <span aria-hidden="true"> · </span>
            {positionLabel(s.position)} sensor
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line" className="border-b pb-0 sm:w-full sm:justify-start">
            <TabsTrigger value="overview" className="flex-none px-2.5">
              <Aperture aria-hidden="true" /> Overview
            </TabsTrigger>
            <TabsTrigger value="references" className="flex-none px-2.5">
              <Images aria-hidden="true" /> Reference images
              <span className="font-mono text-xs text-muted-foreground">{formatNumber(s.reference_count ?? 0)}</span>
            </TabsTrigger>
            <TabsTrigger value="fingerprint" className="flex-none px-2.5">
              <FingerprintIcon aria-hidden="true" /> Fingerprint
            </TabsTrigger>
            <TabsTrigger value="quality" className="flex-none px-2.5">
              <TriangleAlert aria-hidden="true" /> Quality
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab sensor={s} onTab={setTab} />
        </TabsContent>
        <TabsContent value="references">
          <ReferencesTab sensor={s} onTab={setTab} />
        </TabsContent>
        <TabsContent value="fingerprint">
          <FingerprintTab sensor={s} onTab={setTab} />
        </TabsContent>
        <TabsContent value="quality">
          <QualityTab sensor={s} onTab={setTab} />
        </TabsContent>
      </Tabs>

      <EditSensorDialog sensor={s} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this sensor?"
        description={
          <>
            <span className="font-medium text-foreground">{s.name}</span> will be deleted together with its{" "}
            {pluralize(s.reference_count ?? 0, "reference image")} and every fingerprint version built from them.
            Completed analyses keep their recorded results. This cannot be undone.
          </>
        }
        confirmLabel="Delete sensor"
        typedConfirmation={s.name}
        onConfirm={async () => {
          setLeaving(true);
          try {
            await remove.mutateAsync(s.id);
          } catch (err) {
            setLeaving(false);
            throw err;
          }
          toastSuccess("Sensor deleted");
          router.replace(`/app/cameras/${s.device_id}`);
        }}
      />
    </>
  );
}

export function SensorProfile() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <SensorProfileInner />
    </Suspense>
  );
}
