"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useCreateInvestigation, useUpdateInvestigation } from "@/lib/api/hooks";
import type { Investigation } from "@/lib/api/types";
import { toastSuccess } from "@/lib/toast";

import { RETENTION_EXPLANATION } from "./shared";

const schema = z.object({
  title: z.string().trim().min(1, "Give the investigation a title.").max(200, "Use at most 200 characters."),
  reference: z.string().trim().max(120, "Use at most 120 characters."),
  description: z.string().trim().max(20000, "Use at most 20,000 characters."),
  retention_days: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 3650), "Enter a whole number of days from 1 to 3,650, or leave empty."),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["title", "reference", "description", "retention_days"] as const;

export interface InvestigationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this investigation's details; omit to create a new one. */
  investigation?: Investigation;
  onCreated?: (investigation: Investigation) => void;
}

export function InvestigationFormDialog({ open, onOpenChange, investigation, onCreated }: InvestigationFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <Body investigation={investigation} onOpenChange={onOpenChange} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ investigation, onOpenChange, onCreated }: Omit<InvestigationFormDialogProps, "open">) {
  const editing = Boolean(investigation);
  const create = useCreateInvestigation();
  const update = useUpdateInvestigation(investigation?.id ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: investigation?.title ?? "",
      reference: investigation?.reference ?? "",
      description: investigation?.description ?? "",
      retention_days: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (investigation) {
        await update.mutateAsync({ title: values.title, reference: values.reference, description: values.description });
        toastSuccess("Investigation updated");
      } else {
        const created = await create.mutateAsync({
          title: values.title,
          reference: values.reference,
          description: values.description,
          ...(values.retention_days ? { retention_days: Number(values.retention_days) } : {}),
        });
        toastSuccess("Investigation created");
        if (onCreated) {
          // The caller navigates away; closing here as well would race that navigation.
          onCreated(created);
          return;
        }
      }
      onOpenChange(false);
    } catch (err) {
      let unmapped = !(err instanceof ApiError) || err.fieldIssues.length === 0;
      if (err instanceof ApiError) {
        for (const issue of err.fieldIssues) {
          const name = FIELDS.find((f) => f === issue.field);
          if (name) form.setError(name, { type: "server", message: issue.message });
          else unmapped = true;
        }
      }
      if (unmapped) setFormError(errorMessage(err));
    }
  });
  const pending = create.isPending || update.isPending;

  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit investigation" : "New investigation"}</DialogTitle>
          <DialogDescription>
            An investigation keeps the evidence images, comparisons, notes and processing history for one question together.
          </DialogDescription>
        </DialogHeader>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input autoFocus autoComplete="off" maxLength={200} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Reference <span className="font-normal text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input autoComplete="off" maxLength={120} className="font-mono" {...field} />
              </FormControl>
              <FormDescription>Your own case or file number.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={20000} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {editing ? null : (
          <FormField
            control={form.control}
            name="retention_days"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Retention period in days <span className="font-normal text-muted-foreground">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input inputMode="numeric" autoComplete="off" placeholder="No automatic deletion" className="max-w-56" {...field} />
                </FormControl>
                <FormDescription>{RETENTION_EXPLANATION}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {formError ? (
          <p role="alert" className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm">
            {formError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : editing ? "Save changes" : "Create investigation"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
