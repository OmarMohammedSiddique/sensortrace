"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, UserRound } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { applyApiError, FormError, Panel } from "@/components/cameras/shared";
import { CopyButton } from "@/components/st/copy-button";
import { FormattedDate } from "@/components/st/formatted";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateProfile } from "@/lib/api/hooks";
import { useUser } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { toastSuccess } from "@/lib/toast";

const profileSchema = z.object({
  display_name: z.string().trim().max(120, "At most 120 characters."),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileForm() {
  const user = useUser();
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { display_name: user.display_name ?? "" } });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await update.mutateAsync({ display_name: values.display_name });
      form.reset({ display_name: saved.display_name ?? "" });
      toastSuccess("Profile saved");
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["display_name"]));
    }
  });
  return (
    <Panel title="Profile" icon={UserRound}>
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
          <FormError message={formError} />
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormDescription>How you are addressed in the app.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="account-email">Email</Label>
            <div className="flex items-center gap-2">
              <Input id="account-email" value={user.email} readOnly aria-describedby="account-email-hint" className="bg-muted/40 text-muted-foreground" />
              <CopyButton value={user.email} label="Copy email address" size="icon-sm" variant="outline" />
            </div>
            <p id="account-email-hint" className="text-xs text-muted-foreground">
              Your sign-in address. It cannot be changed here.
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <dt>Role:</dt>
              <dd className="text-foreground">{humanize(user.role)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Member since:</dt>
              <dd className="text-foreground">
                <FormattedDate value={user.created_at} mode="date" />
              </dd>
            </div>
          </dl>
          <div>
            <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
              {update.isPending ? "Saving" : "Save profile"}
            </Button>
          </div>
        </form>
      </Form>
    </Panel>
  );
}

const retentionSchema = z.object({
  days: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number of days.")
    .refine((v) => Number(v) <= 3650, "At most 3,650 days (10 years)."),
});
type RetentionValues = z.infer<typeof retentionSchema>;

function currentRetention(settings: unknown): number {
  const v = (settings as { default_retention_days?: unknown } | null)?.default_retention_days;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function RetentionForm() {
  const user = useUser();
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const saved = currentRetention(user.settings);
  const form = useForm<RetentionValues>({ resolver: zodResolver(retentionSchema), defaultValues: { days: String(saved) } });
  const typed = useWatch({ control: form.control, name: "days" });
  const preview = /^\d+$/.test(typed.trim()) ? Number(typed) : null;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await update.mutateAsync({ default_retention_days: Number(values.days) });
      form.reset({ days: String(currentRetention(result.settings)) });
      toastSuccess("Default retention saved", "It applies to investigations you create from now on.");
    } catch (err) {
      const message = applyApiError(err, form.setError, []);
      setFormError(message);
    }
  });
  return (
    <Panel title="Default retention for new investigations" icon={CalendarClock}>
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
          <FormError message={formError} />
          <FormField
            control={form.control}
            name="days"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Retention period</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input inputMode="numeric" autoComplete="off" className="w-28 font-mono" {...field} />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <FormDescription>
                  How long a new investigation is kept before it is deleted automatically, together with its evidence,
                  analyses and reports. Enter 0 to keep investigations until you delete them yourself. You can still
                  change the period on each investigation; existing investigations are not affected.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <p aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {preview === null
              ? "Enter a number of days."
              : preview === 0
                ? "New investigations will be kept until you delete them."
                : `New investigations will be deleted automatically ${preview === 1 ? "1 day" : `${preview.toLocaleString()} days`} after they are created.`}
          </p>
          <div>
            <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
              {update.isPending ? "Saving" : "Save retention"}
            </Button>
          </div>
        </form>
      </Form>
    </Panel>
  );
}

export function AccountTab() {
  return (
    <div className="flex flex-col gap-6">
      <ProfileForm />
      <RetentionForm />
    </div>
  );
}
