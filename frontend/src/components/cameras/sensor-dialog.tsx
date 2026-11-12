"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSensor, useUpdateSensor } from "@/lib/api/hooks";
import type { Sensor } from "@/lib/api/types";
import { toastSuccess } from "@/lib/toast";

import { applyApiError, FormError, Notice, POSITION_OPTIONS } from "./shared";

const sensorSchema = z.object({
  name: z.string().trim().min(1, "Give the sensor a name.").max(160, "At most 160 characters."),
  position: z.string().min(1).max(40),
  notes: z.string().trim().max(5000, "At most 5,000 characters."),
});
type SensorValues = z.infer<typeof sensorSchema>;
const FIELDS = ["name", "position", "notes"] as const;

function SensorFields({ form, extraPosition }: { form: UseFormReturn<SensorValues>; extraPosition?: string }) {
  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input autoFocus autoComplete="off" placeholder="e.g. Main camera, 12 MP, photo mode" {...field} />
            </FormControl>
            <FormDescription>Include the lens, resolution and mode so it cannot be confused with another entry.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="position"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Position</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full sm:w-64" onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {POSITION_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                {extraPosition && !POSITION_OPTIONS.some((p) => p.value === extraPosition) ? (
                  <SelectItem value={extraPosition}>{extraPosition}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea rows={3} placeholder="Capture settings used for the reference images." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- add */

export function AddSensorDialog({
  deviceId,
  open,
  onOpenChange,
  onCreated,
}: {
  deviceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (sensor: Sensor) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <AddSensorForm deviceId={deviceId} onCancel={() => onOpenChange(false)} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddSensorForm({
  deviceId,
  onCancel,
  onCreated,
}: {
  deviceId: string;
  onCancel: () => void;
  onCreated?: (sensor: Sensor) => void;
}) {
  const create = useCreateSensor(deviceId);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SensorValues>({
    resolver: zodResolver(sensorSchema),
    defaultValues: { name: "", position: "main", notes: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const sensor = await create.mutateAsync(values);
      toastSuccess("Sensor added", "Upload reference images taken with this sensor next.");
      onCancel();
      onCreated?.(sensor);
    } catch (err) {
      setFormError(applyApiError(err, form.setError, FIELDS));
    }
  });
  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Add a sensor</DialogTitle>
          <DialogDescription>A sensor is one imaging chip behind one lens, used in one capture configuration.</DialogDescription>
        </DialogHeader>
        <Notice tone="info" title="One entry per lens, resolution and capture mode">
          Each lens has a different physical sensor, and a different resolution or mode produces a differently
          processed image. Their noise patterns do not line up, so they must never be mixed in one entry: add a
          separate sensor for each combination you need to test.
        </Notice>
        <FormError message={formError} />
        <SensorFields form={form} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Adding" : "Add sensor"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/* ------------------------------------------------------------------ edit */

export function EditSensorDialog({
  sensor,
  open,
  onOpenChange,
}: {
  sensor: Sensor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <EditSensorForm sensor={sensor} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditSensorForm({ sensor, onDone }: { sensor: Sensor; onDone: () => void }) {
  const update = useUpdateSensor(sensor.id);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SensorValues>({
    resolver: zodResolver(sensorSchema),
    defaultValues: { name: sensor.name, position: sensor.position || "main", notes: sensor.notes ?? "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync(values);
      toastSuccess("Sensor details saved");
      onDone();
    } catch (err) {
      setFormError(applyApiError(err, form.setError, FIELDS));
    }
  });
  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Edit sensor</DialogTitle>
          <DialogDescription>
            These details describe the sensor. They do not change its reference images or fingerprints.
          </DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <SensorFields form={form} extraPosition={sensor.position} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending ? "Saving" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
