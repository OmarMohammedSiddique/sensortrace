"use client";

import { Camera, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { DataTable, DataTablePagination, usePagination, type Column } from "@/components/st/data-table";
import { DemoBadge } from "@/components/st/demo-badge";
import { FormattedDate } from "@/components/st/formatted";
import { PageHeader } from "@/components/st/page-header";
import { EmptyState, ErrorState } from "@/components/st/states";
import { Button } from "@/components/ui/button";
import { useDevices } from "@/lib/api/hooks";
import type { Device } from "@/lib/api/types";
import { DEVICE_TYPE_LABELS } from "@/lib/domain";
import { humanize, pluralize } from "@/lib/format";

import { RegisterCameraDialog } from "./device-form";
import { PipelineBadge } from "./shared";

function makeModel(d: Pick<Device, "make" | "model">): string {
  return [d.make, d.model].filter(Boolean).join(" ");
}

function CamerasListInner() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const dialogOpen = search.get("new") === "1";
  const setDialogOpen = (open: boolean) => {
    const params = new URLSearchParams(search);
    if (open) params.set("new", "1");
    else params.delete("new");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const pagination = usePagination(25);
  const devices = useDevices(pagination.params);

  const columns: Column<Device>[] = [
    {
      id: "name",
      header: "Camera",
      skeleton: "w-40",
      cell: (d) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/app/cameras/${d.id}`} className="font-medium underline-offset-4 hover:underline">
              {d.name}
            </Link>
            <DemoBadge when={d.is_demo} />
          </span>
          <span className="text-xs text-muted-foreground md:hidden">
            {makeModel(d) || "Make and model not recorded"}
          </span>
        </div>
      ),
    },
    {
      id: "model",
      header: "Make and model",
      className: "hidden md:table-cell",
      cell: (d) => makeModel(d) || <span className="text-muted-foreground">Not recorded</span>,
    },
    {
      id: "type",
      header: "Type",
      className: "hidden lg:table-cell",
      cell: (d) => DEVICE_TYPE_LABELS[d.device_type] ?? humanize(d.device_type),
    },
    {
      id: "pipeline",
      header: "Pipeline",
      className: "hidden sm:table-cell",
      cell: (d) => <PipelineBadge value={d.pipeline_class} />,
    },
    {
      id: "sensors",
      header: "Sensors",
      cell: (d) => {
        const sensors = d.sensors ?? [];
        const ready = sensors.filter((s) => s.active_fingerprint).length;
        return sensors.length === 0 ? (
          <span className="text-muted-foreground">None yet</span>
        ) : (
          <span className="whitespace-nowrap">
            {pluralize(sensors.length, "sensor")}
            <span className="text-muted-foreground">, {ready} with a fingerprint</span>
          </span>
        );
      },
    },
    {
      id: "created",
      header: "Registered",
      className: "hidden lg:table-cell",
      cell: (d) => <FormattedDate value={d.created_at} mode="date" className="text-muted-foreground" />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Cameras"
        description="Register physical devices, enrol each of their sensors and build the fingerprints that questioned images are compared against."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden="true" />
            Register a camera
          </Button>
        }
      />
      <DataTable
        caption="Registered cameras"
        columns={columns}
        rows={devices.data?.items}
        rowKey={(d) => d.id}
        loading={devices.isPending}
        fetching={devices.isFetching}
        error={
          devices.isError ? (
            <ErrorState
              title="Could not load your cameras"
              error={devices.error}
              onRetry={() => void devices.refetch()}
              retrying={devices.isFetching}
            />
          ) : null
        }
        empty={
          <EmptyState
            icon={Camera}
            title="No cameras yet"
            description={
              <>
                A <strong className="font-medium text-foreground">camera</strong> is one physical device. Each lens on it
                has its own <strong className="font-medium text-foreground">sensor</strong>, and every sensor gets its
                own fingerprint built from reference images you take with it. A camera model is not a sensor: two
                phones of the same model have different fingerprints.
              </>
            }
            action={
              <Button onClick={() => setDialogOpen(true)}>
                <Plus aria-hidden="true" />
                Register a camera
              </Button>
            }
            secondaryAction={
              <Button asChild variant="outline">
                <Link href="/app/onboarding">Try the guided demo</Link>
              </Button>
            }
          />
        }
      />
      <DataTablePagination pagination={pagination} total={devices.data?.total} label="cameras" />
      <RegisterCameraDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(device) => router.push(`/app/cameras/${device.id}`)}
      />
    </>
  );
}

export function CamerasList() {
  return (
    <Suspense fallback={null}>
      <CamerasListInner />
    </Suspense>
  );
}
