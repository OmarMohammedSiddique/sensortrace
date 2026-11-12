"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, type FieldPath, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useMeta } from "@/lib/api/hooks";
import { safeNextPath, useAuth } from "@/lib/auth";

function AuthCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div>
      <div className="rounded-xl bg-card p-6 shadow-xs ring-1 ring-foreground/10 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-sm">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>{message}</span>
    </div>
  );
}

/** Map API validation issues onto form fields; returns the message to show at form level. */
function applyApiError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly FieldPath<T>[]): string | null {
  if (err instanceof ApiError && err.fieldIssues.length > 0) {
    let mapped = 0;
    for (const issue of err.fieldIssues) {
      const name = fields.find((f) => f === issue.field);
      if (name) {
        setError(name, { type: "server", message: issue.message });
        mapped += 1;
      }
    }
    if (mapped === err.fieldIssues.length) return null;
  }
  return errorMessage(err);
}

/** Where to go after authenticating, and a redirect away if a session already exists. */
function useAuthRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();
  const next = safeNextPath(params.get("next"));
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);
  return { next, rawNext: params.get("next"), router, status };
}

/* ------------------------------------------------------------------ sign in */

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(320),
  password: z.string().min(1, "Enter your password.").max(256),
});
type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm() {
  const { signIn } = useAuth();
  const { next, rawNext, router } = useAuthRedirect();
  const meta = useMeta();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values);
      router.replace(next);
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["email", "password"]));
    }
  });
  const registerHref = rawNext ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to your SensorTrace workspace."
      footer={
        meta.data?.registration_open === false ? (
          "Registration is closed on this server."
        ) : (
          <>
            New to SensorTrace?{" "}
            <Link href={registerHref} className="font-medium text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </>
        )
      }
    >
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} autoFocus className="h-9" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" className="h-9" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="mt-1 h-9" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {form.formState.isSubmitting ? "Signing in" : "Sign in"}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}

/* ----------------------------------------------------------------- register */

const registerSchema = z.object({
  display_name: z.string().trim().max(120, "Use 120 characters or fewer."),
  email: z.string().trim().min(1, "Enter your email address.").max(320).email("Enter a valid email address."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(256, "Use 256 characters or fewer."),
});
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const { register } = useAuth();
  const { next, rawNext, router } = useAuthRedirect();
  const meta = useMeta();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await register(values);
      router.replace(rawNext ? next : user.onboarding_completed ? "/app" : "/app/onboarding");
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["display_name", "email", "password"]));
    }
  });
  const signInLink = (
    <>
      Already have an account?{" "}
      <Link href={rawNext ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"} className="font-medium text-foreground underline underline-offset-4">
        Sign in
      </Link>
    </>
  );

  if (meta.isPending) {
    return (
      <AuthCard title="Create your account" description="Checking whether this server accepts registrations." footer={signInLink}>
        <div className="flex flex-col gap-4" role="status" aria-label="Loading">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </AuthCard>
    );
  }
  if (meta.data?.registration_open === false) {
    return (
      <AuthCard
        title="Registration is closed"
        description="This SensorTrace server is not accepting new accounts. Ask its administrator to create one for you."
        footer={signInLink}
      >
        <Button asChild size="lg" variant="outline" className="h-9 w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Your images, fingerprints and results are private to your account."
      footer={signInLink}
    >
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />
          <FormField
            control={form.control}
            name="display_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Name <span className="font-normal text-muted-foreground">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="name" autoFocus className="h-9" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} className="h-9" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" className="h-9" {...field} />
                </FormControl>
                <FormDescription>At least 10 characters. Easily guessed passwords are refused.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="mt-1 h-9" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {form.formState.isSubmitting ? "Creating account" : "Create account"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            By creating an account you agree to use SensorTrace only on material you are authorised to examine. See{" "}
            <Link href="/privacy#authorised" className="underline underline-offset-4">
              responsible use
            </Link>
            .
          </p>
        </form>
      </Form>
    </AuthCard>
  );
}

export function AuthFormFallback() {
  return (
    <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-7" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="mt-3 h-4 w-56" />
      <div className="mt-6 flex flex-col gap-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    </div>
  );
}
