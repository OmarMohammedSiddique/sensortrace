"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateDevice, useUpdateDevice } from "@/lib/api/hooks";
import type { Device, DeviceIn } from "@/lib/api/types";
import { DEVICE_TYPE_LABELS } from "@/lib/domain";
import { toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { applyApiError, FormError } from "./shared";

const DEVICE_TYPES = ["smartphone", "tablet", "dedicated_camera", "action_camera", "drone", "webcam", "other"] as const;
const PIPELINES = ["conventional", "computational", "unknown"] as const;

export const deviceSchema = z.object({
  name: z.string().trim().min(1, "Give the camera a name.").max(160, "At most 160 characters."),
  make: z.string().trim().max(120, "At most 120 characters."),
  model: z.string().trim().max(120, "At most 120 characters."),
  device_type: z.enum(DEVICE_TYPES),
  pipeline_class: z.enum(PIPELINES),
  firmware: z.string().trim().max(120, "At most 120 characters."),
  serial_number: z.string().trim().max(120, "At most 120 characters."),
  notes: z.string().trim().max(5000, "At most 5,000 characters."),
});
export type DeviceValues = z.infer<typeof deviceSchema>;

const FIELDS = ["name", "make", "model", "device_type", "pipeline_class", "firmware", "serial_number", "notes"] as const;

function asEnum<T extends string>(value: string | undefined | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

export function deviceDefaults(device?: Device): DeviceValues {
  return {
    name: device?.name ?? "",
    make: device?.make ?? "",
    model: device?.model ?? "",
    device_type: asEnum(device?.device_type, DEVICE_TYPES, "smartphone"),
    pipeline_class: asEnum(device?.pipeline_class, PIPELINES, "unknown"),
    firmware: device?.firmware ?? "",
    serial_number: device?.serial_number ?? "",
    notes: device?.notes ?? "",
  };
}

const PIPELINE_CHOICES: { value: (typeof PIPELINES)[number]; title: string; body: string }[] = [
  {
    value: "conventional",
    title: "Conventional",
    body: "Dedicated cameras, and phones that do not merge multiple frames into one photo.",
  },
  {
    value: "computational",
    title: "Computational",
    body: "Modern smartphones: multi-frame capture, HDR, portrait and similar processing.",
  },
  {
    value: "unknown",
    title: "Unknown",
    body: "Not sure. Treated the same as computational.",
  },
];

/** The shared field set for registering and editing a camera. */
export function DeviceFields({ form, autoFocus = false }: { form: UseFormReturn<DeviceValues>; autoFocus?: boolean }) {
  const pipeline = useWatch({ control: form.control, name: "pipeline_class" });
  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input autoFocus={autoFocus} autoComplete="off" placeholder="e.g. Evidence phone 3" {...field} />
            </FormControl>
            <FormDescription>How you refer to this physical device.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="make"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Make</FormLabel>
              <FormControl>
                <Input autoComplete="off" placeholder="Manufacturer" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Model</FormLabel>
              <FormControl>
                <Input autoComplete="off" placeholder="Model name or number" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="device_type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Device type</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full sm:w-64" onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {DEVICE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DEVICE_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="pipeline_class"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Image pipeline</FormLabel>
            <FormDescription>How the device turns sensor data into a photo. This changes how results are interpreted.</FormDescription>
            <FormControl>
              <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-3">
                {PIPELINE_CHOICES.map((choice) => {
                  const id = `pipeline-${choice.value}`;
                  return (
                    <label
                      key={choice.value}
                      htmlFor={id}
                      className={cn(
                        "flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors hover:bg-accent/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                        field.value === choice.value && "border-brand-border bg-brand-subtle",
                      )}
                    >
                      <RadioGroupItem id={id} value={choice.value} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{choice.title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{choice.body}</span>
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            </FormControl>
            <p aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {pipeline === "conventional"
                ? "For a conventional device a high statistic can support a match with this individual sensor on its own."
                : "For this class a match is only supported once another device of the same make and model is enrolled as a control. Without one, a high statistic could come from processing shared by every device of that model, not from this individual sensor."}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="firmware"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Firmware or OS version</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="serial_number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Serial number</FormLabel>
              <FormControl>
                <Input autoComplete="off" spellCheck={false} className="font-mono" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea rows={3} placeholder="Where the device came from, who holds it, anything relevant." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

/* --------------------------------------------------------- create dialog */

export function RegisterCameraDialog({
  open,
  onOpenChange,
  onCreated,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (device: Device) => void;
  /** Prefill (used when enrolling a same-model control device). */
  defaults?: Partial<DeviceValues>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        {open ? <RegisterCameraForm onCreated={onCreated} onCancel={() => onOpenChange(false)} defaults={defaults} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RegisterCameraForm({
  onCreated,
  onCancel,
  defaults,
}: {
  onCreated: (device: Device) => void;
  onCancel: () => void;
  defaults?: Partial<DeviceValues>;
}) {
  const create = useCreateDevice();
  const [formError, setFormError] = useState<string | null>(null);
  // Stays true after success so the form cannot be submitted twice while the next page loads.
  const [created, setCreated] = useState(false);
  const form = useForm<DeviceValues>({
    resolver: zodResolver(deviceSchema),
    defaultValues: { ...deviceDefaults(), ...defaults },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const device = await create.mutateAsync(values satisfies DeviceIn);
      setCreated(true);
      toastSuccess("Camera registered", "Add a sensor next, then upload its reference images.");
      onCreated(device);
    } catch (err) {
      setFormError(applyApiError(err, form.setError, FIELDS));
    }
  });
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Register a camera</DialogTitle>
          <DialogDescription>
            A camera is one physical device. Its sensors (main, ultrawide, front and so on) are added afterwards, each
            with its own fingerprint.
          </DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <DeviceFields form={form} autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || created}>
            {create.isPending ? "Registering" : created ? "Opening camera" : "Register camera"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/* ----------------------------------------------------------- inline edit */

/** Inline editor for the camera details panel (PATCH /devices/{id}). */
export function EditCameraForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const update = useUpdateDevice(device.id);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<DeviceValues>({ resolver: zodResolver(deviceSchema), defaultValues: deviceDefaults(device) });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await update.mutateAsync(values);
      toastSuccess("Camera details saved");
      onDone();
    } catch (err) {
      setFormError(applyApiError(err, form.setError, FIELDS));
    }
  });
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Edit camera details">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Changing the make, model or image pipeline affects how future comparisons against this camera are
          interpreted. Completed analyses keep the details they were run with.
        </p>
        <FormError message={formError} />
        <DeviceFields form={form} autoFocus />
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onDone} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending ? "Saving" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
