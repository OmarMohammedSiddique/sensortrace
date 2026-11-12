"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface AcquisitionValues {
  source: string;
  acquired_at: string;
  acquired_by: string;
  method: string;
  notes: string;
}

export const EMPTY_ACQUISITION: AcquisitionValues = { source: "", acquired_at: "", acquired_by: "", method: "", notes: "" };

export function toAcquisitionValues(a: Partial<AcquisitionValues> | null | undefined): AcquisitionValues {
  return {
    source: a?.source ?? "",
    acquired_at: a?.acquired_at ?? "",
    acquired_by: a?.acquired_by ?? "",
    method: a?.method ?? "",
    notes: a?.notes ?? "",
  };
}

export function hasAcquisition(a: Partial<AcquisitionValues> | null | undefined): boolean {
  return Boolean(a && (a.source || a.acquired_at || a.acquired_by || a.method || a.notes));
}

/** ISO timestamp -> value for <input type="datetime-local"> in the viewer's time zone. */
function toLocalInput(iso: string): string | null {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** The five acquisition fields the API stores with an evidence image. All optional. */
export function AcquisitionFields({
  value,
  onChange,
  disabled,
}: {
  value: AcquisitionValues;
  onChange: (next: AcquisitionValues) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const set = (key: keyof AcquisitionValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [key]: e.target.value });
  const local = toLocalInput(value.acquired_at);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-source`}>Source</Label>
        <Input id={`${id}-source`} value={value.source} onChange={set("source")} maxLength={300} disabled={disabled} placeholder="Where the file came from, e.g. a device, a person, a URL" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-at`}>Acquired at</Label>
        {local === null ? (
          <Input id={`${id}-at`} value={value.acquired_at} onChange={set("acquired_at")} maxLength={40} disabled={disabled} />
        ) : (
          <Input
            id={`${id}-at`}
            type="datetime-local"
            value={local}
            onChange={(e) => onChange({ ...value, acquired_at: fromLocalInput(e.target.value) })}
            disabled={disabled}
          />
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-by`}>Acquired by</Label>
        <Input id={`${id}-by`} value={value.acquired_by} onChange={set("acquired_by")} maxLength={200} disabled={disabled} autoComplete="off" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-method`}>Method</Label>
        <Input id={`${id}-method`} value={value.method} onChange={set("method")} maxLength={300} disabled={disabled} placeholder="How it was obtained, e.g. file copy over USB, download, forensic image" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} value={value.notes} onChange={set("notes")} maxLength={5000} rows={3} disabled={disabled} />
      </div>
    </div>
  );
}
