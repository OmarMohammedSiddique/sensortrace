"use client";

import { Aperture, Camera, ChevronRight, Info, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-context";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteDevice, useDevice, useDevices } from "@/lib/api/hooks";
import type { Device, Sensor } from "@/lib/api/types";
import { DEVICE_TYPE_LABELS, PIPELINE_DESCRIPTIONS } from "@/lib/domain";
import { humanize, pluralize } from "@/lib/format";
import { toastSuccess } from "@/lib/toast";

import { EditCameraForm, RegisterCameraDialog } from "./device-form";
import { AddSensorDialog } from "./sensor-dialog";
import { Detail, isFingerprintBuilding, isNotFound, modelKey, needsControls, Notice, Panel, PipelineBadge, positionLabel, SensorStatus, useFingerprintVersions } from "./shared";

/* ---------------------------------------------------------------- sensors */

function SensorRow({ sensor }: { sensor: Sensor }) {
  // The sensor object does not say whether a fingerprint is being built; its version list does.
  const fingerprints = useFingerprintVersions(sensor.id);
  const building = fingerprints.data?.some(isFingerprintBuilding) ?? false;
  return (
    <li>
      <Link
        href={`/app/sensors/${sensor.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Aperture aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{sensor.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{positionLabel(sensor.position)}</span>
            <span aria-hidden="true">·</span>
            <SensorStatus sensor={sensor} building={building} />
            {building || !sensor.active_fingerprint ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{pluralize(sensor.reference_count ?? 0, "reference")}</span>
              </>
            )}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/* -------------------------------------------------- same-model controls */

function ControlsPanel({ device, onEnrol }: { device: Device; onEnrol: () => void }) {
  const all = useDevices({ limit: 200 });
  const key = modelKey(device.make, device.model);
  const controls = key
    ? (all.data?.items ?? []).filter((d) => d.id !== device.id && modelKey(d.make, d.model) === key)
    : [];
  const withFingerprint = controls.filter((d) => (d.sensors ?? []).some((s) => s.active_fingerprint));
  const required = needsControls(device.pipeline_class);

  return (
    <Panel title="Same-model controls" icon={ShieldCheck}>
      {all.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading control devices">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : all.isError ? (
        <ErrorState variant="inline" title="Could not check for control devices" error={all.error} onRetry={() => void all.refetch()} retrying={all.isFetching} />
      ) : !key ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Record this camera&apos;s make and model so other devices of the same model can be recognised as controls.
          </p>
          {required ? (
            <Notice tone="warning" title="Controls cannot be matched yet">
              For this image pipeline a match is only supported when a same-model control device is enrolled, and
              controls are found by make and model.
            </Notice>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Other devices in your account recorded as{" "}
            <span className="font-medium text-foreground">
              {device.make} {device.model}
            </span>
            . They show whether a high statistic belongs to this individual sensor or to every device of the model.
          </p>
          {controls.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {controls.map((d) => {
                const ready = (d.sensors ?? []).filter((s) => s.active_fingerprint).length;
                return (
                  <li key={d.id}>
                    <Link href={`/app/cameras/${d.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/60">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-medium">{d.name}</span>
                        <DemoBadge when={d.is_demo} />
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ready > 0 ? `${pluralize(ready, "fingerprint")} ready` : "No fingerprint yet"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {controls.length === 0 && required ? (
            <Notice tone="warning" title="No control device enrolled">
              This camera is not declared as a conventional pipeline. Devices like this apply processing that can
              leave the same traces in photos from every unit of the model, so a high statistic alone cannot be
              attributed to this individual sensor. Enrol a second {device.make} {device.model} and build its
              fingerprint: comparisons will then check the control as well.
            </Notice>
          ) : controls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None enrolled. This camera is declared as a conventional pipeline, so controls are optional, though they
              still strengthen a result.
            </p>
          ) : withFingerprint.length === 0 ? (
            <Notice tone={required ? "warning" : "info"} title="Controls have no fingerprint yet">
              A control only takes part in comparisons once one of its sensors has a ready fingerprint.
            </Notice>
          ) : null}
          <div>
            <Button variant="outline" size="sm" onClick={onEnrol}>
              <Plus aria-hidden="true" />
              Enrol a same-model device
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- page */

function DeviceSkeleton() {
  return (
    <div role="status" aria-label="Loading camera" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function DeviceDetail() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const router = useRouter();
  const device = useDevice(deviceId);
  const remove = useDeleteDevice();
  useBreadcrumbLabel(device.data?.name);

  const [editing, setEditing] = useState(false);
  const [addSensor, setAddSensor] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [enrolControl, setEnrolControl] = useState(false);
  // Set while the camera is being deleted so the refetch that follows does not flash "not found".
  const [leaving, setLeaving] = useState(false);

  if (device.isPending || (leaving && !device.data)) return <DeviceSkeleton />;
  if (device.isError && !device.data) {
    return isNotFound(device.error) ? (
      <EmptyState
        icon={Camera}
        title="Camera not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild>
            <Link href="/app/cameras">Back to cameras</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState title="Could not load this camera" error={device.error} onRetry={() => void device.refetch()} retrying={device.isFetching} />
    );
  }

  const d = device.data;
  const sensors = d.sensors ?? [];
  const makeModel = [d.make, d.model].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader
        title={d.name}
        badges={
          <>
            <DemoBadge when={d.is_demo} />
            <PipelineBadge value={d.pipeline_class} />
          </>
        }
        description={
          <>
            {makeModel || "Make and model not recorded"}
            <span aria-hidden="true"> · </span>
            {DEVICE_TYPE_LABELS[d.device_type] ?? humanize(d.device_type)}
            <span aria-hidden="true"> · </span>
            {pluralize(sensors.length, "sensor")}
          </>
        }
        actions={
          <>
            <Button onClick={() => setAddSensor(true)}>
              <Plus aria-hidden="true" />
              Add sensor
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Sensors"
            icon={Aperture}
            flush
            action={
              sensors.length > 0 ? (
                <Button variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground" onClick={() => setAddSensor(true)}>
                  <Plus aria-hidden="true" />
                  Add sensor
                </Button>
              ) : null
            }
          >
            {sensors.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={Aperture}
                title="No sensors yet"
                description="Add one entry for each lens, resolution and capture mode you want to test. Each gets its own reference images and fingerprint."
                action={
                  <Button onClick={() => setAddSensor(true)}>
                    <Plus aria-hidden="true" />
                    Add sensor
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {sensors.map((s) => (
                  <SensorRow key={s.id} sensor={s} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Camera details"
            icon={Info}
            action={
              editing ? null : (
                <Button variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              )
            }
          >
            {editing ? (
              <EditCameraForm device={d} onDone={() => setEditing(false)} />
            ) : (
              <dl className="-my-2 divide-y">
                <Detail label="Name">{d.name}</Detail>
                <Detail label="Make">{d.make || <span className="text-muted-foreground">Not recorded</span>}</Detail>
                <Detail label="Model">{d.model || <span className="text-muted-foreground">Not recorded</span>}</Detail>
                <Detail label="Device type">{DEVICE_TYPE_LABELS[d.device_type] ?? humanize(d.device_type)}</Detail>
                <Detail label="Image pipeline">
                  <PipelineBadge value={d.pipeline_class} />
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {PIPELINE_DESCRIPTIONS[d.pipeline_class] ?? null}
                  </span>
                </Detail>
                <Detail label="Firmware or OS">{d.firmware || <span className="text-muted-foreground">Not recorded</span>}</Detail>
                <Detail label="Serial number">
                  {d.serial_number ? <span className="font-mono text-xs">{d.serial_number}</span> : <span className="text-muted-foreground">Not recorded</span>}
                </Detail>
                <Detail label="Notes">
                  {d.notes ? <span className="whitespace-pre-wrap">{d.notes}</span> : <span className="text-muted-foreground">None</span>}
                </Detail>
                <Detail label="Registered">
                  <FormattedDate value={d.created_at} />
                </Detail>
              </dl>
            )}
          </Panel>
        </div>

        <ControlsPanel device={d} onEnrol={() => setEnrolControl(true)} />
      </div>

      <AddSensorDialog
        deviceId={d.id}
        open={addSensor}
        onOpenChange={setAddSensor}
        onCreated={(sensor) => router.push(`/app/sensors/${sensor.id}?tab=references`)}
      />
      <RegisterCameraDialog
        open={enrolControl}
        onOpenChange={setEnrolControl}
        defaults={{ make: d.make, model: d.model, firmware: d.firmware, device_type: d.device_type as never, pipeline_class: d.pipeline_class as never }}
        onCreated={(created) => router.push(`/app/cameras/${created.id}`)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this camera?"
        description={
          <>
            <span className="font-medium text-foreground">{d.name}</span> will be deleted together with{" "}
            {sensors.length > 0 ? `its ${pluralize(sensors.length, "sensor")}` : "any sensors"}, every reference image
            and every fingerprint built from them. Completed analyses keep their recorded results, but the sensor can
            no longer be compared against. This cannot be undone.
          </>
        }
        confirmLabel="Delete camera"
        typedConfirmation={d.name}
        onConfirm={async () => {
          setLeaving(true);
          try {
            await remove.mutateAsync(d.id);
          } catch (err) {
            setLeaving(false);
            throw err;
          }
          toastSuccess("Camera deleted");
          router.replace("/app/cameras");
        }}
      />
    </>
  );
}
