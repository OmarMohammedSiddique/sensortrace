"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Download, KeyRound, Laptop, Lock, Plus, ShieldCheck, TerminalSquare } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { applyApiError, FormError, Notice, Panel } from "@/components/cameras/shared";
import { CodeBlock } from "@/components/marketing/code-block";
import { ConfirmDialog } from "@/components/st/confirm-dialog";
import { CopyButton } from "@/components/st/copy-button";
import { FormattedDate } from "@/components/st/formatted";
import { EmptyState, ErrorState, LoadingRows } from "@/components/st/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  useChangePassword,
  useCreateToken,
  useDisableMfa,
  useEnableMfa,
  useReplaceRecoveryCodes,
  useRevokeSession,
  useRevokeToken,
  useSessions,
  useStartMfa,
  useTokens,
} from "@/lib/api/account-hooks";
import type { MfaSetupOut, SessionOut, TokenCreated, TokenOut } from "@/lib/api/types";
import { useUser } from "@/lib/auth";
import { toastSuccess } from "@/lib/toast";

/* --------------------------------------------------------------- password */

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password.").max(256),
    new_password: z.string().min(10, "Use at least 10 characters.").max(256, "At most 256 characters."),
    confirm: z.string().min(1, "Type the new password again."),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two new passwords do not match." })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Choose a password different from the current one." });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordForm() {
  const user = useUser();
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await change.mutateAsync({ current_password: values.current_password, new_password: values.new_password });
      form.reset();
      toastSuccess("Password changed", "Every other session has been signed out.");
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["current_password", "new_password"]));
    }
  });
  return (
    <Panel title="Password" icon={Lock}>
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Changing your password signs out every other session, so a session opened on another device does not
            survive the change. This browser stays signed in. API tokens keep working until you revoke them.
          </p>
          <FormError message={formError} />
          {/* Lets password managers associate the new password with the account. */}
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <FormField
            control={form.control}
            name="current_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="new_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>At least 10 characters. Common or easily guessed passwords are refused.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Changing" : "Change password"}
            </Button>
          </div>
        </form>
      </Form>
    </Panel>
  );
}

/* ---------------------------------------------------- two-step verification */

const codeField = z.string().trim().min(1, "Enter a code.").max(32, "At most 32 characters.");

function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`SensorTrace recovery codes\nEach code signs in once.\n\n${text}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "sensortrace-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-4">
      <Notice tone="warning" title="These codes will not be shown again" role="alert">
        Each code signs in once in place of an authenticator code. Keep them somewhere safe, such as a password manager.
        If you lose your device and these codes, an administrator has to turn two-step verification off for you.
      </Notice>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy recovery codes" size="sm" variant="outline">
          Copy
        </CopyButton>
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download aria-hidden="true" /> Download
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={onDone}>{doneLabel}</Button>
      </DialogFooter>
    </div>
  );
}

function QrImage({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { margin: 1, width: 192 }).then((url) => live && setSrc(url), () => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);
  if (!src) return <div className="size-48 rounded-md bg-muted" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise
  return <img src={src} alt="QR code for your authenticator app" width={192} height={192} className="rounded-md bg-white p-1" />;
}

const passwordStepSchema = z.object({ password: z.string().min(1, "Enter your password.").max(256) });
const confirmStepSchema = z.object({ code: codeField });

function EnableMfaBody({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const start = useStartMfa();
  const enable = useEnableMfa();
  const [setup, setSetup] = useState<MfaSetupOut | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const passwordForm = useForm<z.infer<typeof passwordStepSchema>>({ resolver: zodResolver(passwordStepSchema), defaultValues: { password: "" } });
  const codeForm = useForm<z.infer<typeof confirmStepSchema>>({ resolver: zodResolver(confirmStepSchema), defaultValues: { code: "" } });

  if (codes) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Two-step verification is on</DialogTitle>
          <DialogDescription>Every other session has been signed out. Save your recovery codes before you continue.</DialogDescription>
        </DialogHeader>
        <RecoveryCodes codes={codes} onDone={onClose} doneLabel="I have saved the codes" />
      </div>
    );
  }

  if (setup) {
    const onConfirm = codeForm.handleSubmit(async ({ code }) => {
      setFormError(null);
      try {
        setCodes((await enable.mutateAsync(code)).codes);
      } catch (err) {
        setFormError(applyApiError(err, codeForm.setError, ["code"]));
      }
    });
    return (
      <Form {...codeForm}>
        <form method="post" onSubmit={onConfirm} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Scan the code with your authenticator app</DialogTitle>
            <DialogDescription>
              Use an app such as a password manager or an authenticator app. If you cannot scan, enter the key by hand.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <QrImage uri={setup.otpauth_uri} />
            <div className="flex w-full items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code aria-label="Setup key" className="min-w-0 flex-1 font-mono text-xs break-all select-all">
                {setup.secret}
              </code>
              <CopyButton value={setup.secret} label="Copy setup key" size="sm" variant="outline">
                Copy
              </CopyButton>
            </div>
          </div>
          <FormError message={formError} />
          <FormField
            control={codeForm.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code from the app</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" autoComplete="one-time-code" className="w-40 font-mono" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={enable.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={enable.isPending}>
              {enable.isPending ? "Checking" : "Turn on"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    );
  }

  const onPassword = passwordForm.handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      setSetup(await start.mutateAsync(password));
    } catch (err) {
      setFormError(applyApiError(err, passwordForm.setError, ["password"]));
    }
  });
  return (
    <Form {...passwordForm}>
      <form method="post" onSubmit={onPassword} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Turn on two-step verification</DialogTitle>
          <DialogDescription>Confirm your password to continue.</DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <FormField
          control={passwordForm.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? "Checking" : "Continue"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

const disableSchema = z.object({ password: z.string().min(1, "Enter your password.").max(256), code: codeField });

function DisableMfaBody({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const disable = useDisableMfa();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof disableSchema>>({ resolver: zodResolver(disableSchema), defaultValues: { password: "", code: "" } });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await disable.mutateAsync(values);
      toastSuccess("Two-step verification turned off");
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["password", "code"]));
    }
  });
  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Turn off two-step verification?</DialogTitle>
          <DialogDescription>Signing in will need only your password again. Your recovery codes stop working.</DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Authentication code</FormLabel>
              <FormControl>
                <Input autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} className="font-mono" {...field} />
              </FormControl>
              <FormDescription>From your authenticator app, or one of your recovery codes.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={disable.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={disable.isPending}>
            {disable.isPending ? "Turning off" : "Turn off"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ReplaceCodesBody({ onClose }: { onClose: () => void }) {
  const replace = useReplaceRecoveryCodes();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof confirmStepSchema>>({ resolver: zodResolver(confirmStepSchema), defaultValues: { code: "" } });
  if (codes) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>New recovery codes</DialogTitle>
          <DialogDescription>Your previous recovery codes no longer work.</DialogDescription>
        </DialogHeader>
        <RecoveryCodes codes={codes} onDone={onClose} doneLabel="I have saved the codes" />
      </div>
    );
  }
  const onSubmit = form.handleSubmit(async ({ code }) => {
    setFormError(null);
    try {
      setCodes((await replace.mutateAsync(code)).codes);
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["code"]));
    }
  });
  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Replace recovery codes</DialogTitle>
          <DialogDescription>Enter a code from your authenticator app. Your current recovery codes will stop working.</DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code from the app</FormLabel>
              <FormControl>
                <Input inputMode="numeric" autoComplete="one-time-code" className="w-40 font-mono" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={replace.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={replace.isPending}>
            {replace.isPending ? "Checking" : "Replace codes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

type MfaDialog = "enable" | "disable" | "codes" | null;

function TwoStepVerification() {
  const user = useUser();
  const [dialog, setDialog] = useState<MfaDialog>(null);
  const close = () => setDialog(null);
  return (
    <Panel title="Two-step verification" icon={ShieldCheck}>
      <div className="grid max-w-xl gap-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={user.mfa_enabled ? "outline" : "secondary"}>{user.mfa_enabled ? "On" : "Off"}</Badge>
          <span className="text-muted-foreground">
            {user.mfa_enabled
              ? "Signing in needs your password and a code from your authenticator app."
              : "Add an authenticator app so that a stolen password alone cannot open your account."}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {user.mfa_enabled ? (
            <>
              <Button variant="outline" onClick={() => setDialog("codes")}>
                Replace recovery codes
              </Button>
              <Button variant="outline" onClick={() => setDialog("disable")}>
                Turn off
              </Button>
            </>
          ) : (
            <Button onClick={() => setDialog("enable")}>Turn on</Button>
          )}
        </div>
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
          {dialog === "enable" ? <EnableMfaBody onClose={close} /> : null}
          {dialog === "disable" ? <DisableMfaBody onClose={close} /> : null}
          {dialog === "codes" ? <ReplaceCodesBody onClose={close} /> : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* --------------------------------------------------------------- sessions */

/** A short readable name for a user-agent string; the full string stays available as a title. */
function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown client";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser) return os ? `${browser} on ${os}` : browser;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

function Sessions() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const [toRevoke, setToRevoke] = useState<SessionOut | null>(null);
  return (
    <Panel title="Active sessions" icon={Laptop} flush>
      {sessions.isPending ? (
        <LoadingRows rows={2} className="p-4" />
      ) : sessions.isError ? (
        <div className="p-4">
          <ErrorState variant="inline" title="Could not load sessions" error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
        </div>
      ) : (
        <ul className="divide-y">
          {sessions.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span title={s.user_agent ?? undefined}>{describeAgent(s.user_agent)}</span>
                  {s.current ? <Badge variant="secondary">This session</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.ip ? (
                    <>
                      <span className="font-mono">{s.ip}</span>
                      <span aria-hidden="true"> · </span>
                    </>
                  ) : null}
                  Last active <FormattedDate value={s.last_seen_at} mode="relative" />
                  <span aria-hidden="true"> · </span>
                  Signed in <FormattedDate value={s.created_at} />
                  <span aria-hidden="true"> · </span>
                  Expires <FormattedDate value={s.expires_at} />
                </p>
              </div>
              {s.current ? null : (
                <Button variant="outline" size="sm" onClick={() => setToRevoke(s)}>
                  Sign out<span className="sr-only"> session {describeAgent(s.user_agent)}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(open) => (open ? null : setToRevoke(null))}
        title="Sign out this session?"
        description={
          <>
            The session on <span className="font-medium text-foreground">{describeAgent(toRevoke?.user_agent)}</span>
            {toRevoke?.ip ? <> from <span className="font-mono">{toRevoke.ip}</span></> : null} will be signed out
            immediately. Whoever is using it has to sign in again.
          </>
        }
        confirmLabel="Sign out session"
        onConfirm={async () => {
          if (!toRevoke) return;
          await revoke.mutateAsync(toRevoke.id);
          toastSuccess("Session signed out");
        }}
      />
    </Panel>
  );
}

/* ----------------------------------------------------------------- tokens */

const tokenSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(120, "At most 120 characters."),
  expires: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), "Enter a whole number of days, or leave empty.")
    .refine((v) => v === "" || (Number(v) >= 1 && Number(v) <= 3650), "Between 1 and 3,650 days."),
});
type TokenValues = z.infer<typeof tokenSchema>;

function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        {open ? <CreateTokenBody onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateTokenBody({ onClose }: { onClose: () => void }) {
  const create = useCreateToken();
  const [created, setCreated] = useState<TokenCreated | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TokenValues>({ resolver: zodResolver(tokenSchema), defaultValues: { name: "", expires: "90" } });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      setCreated(await create.mutateAsync({ name: values.name, expires_in_days: values.expires === "" ? null : Number(values.expires) }));
    } catch (err) {
      setFormError(applyApiError(err, form.setError, ["name"]));
    }
  });

  if (created) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Copy your new token now</DialogTitle>
          <DialogDescription>
            Token <span className="font-medium text-foreground">{created.name}</span> was created.
          </DialogDescription>
        </DialogHeader>
        <Notice tone="warning" title="This token will not be shown again" role="alert">
          Only a short prefix is kept for identification. Store the token somewhere safe, such as a password manager.
          If you lose it, revoke it and create a new one.
        </Notice>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code aria-label="New API token" className="min-w-0 flex-1 font-mono text-xs break-all select-all">
            {created.token}
          </code>
          <CopyButton value={created.token} label="Copy token" size="sm" variant="outline">
            Copy
          </CopyButton>
        </div>
        <p className="text-xs text-muted-foreground">
          {created.expires_at ? (
            <>
              Expires <FormattedDate value={created.expires_at} />.
            </>
          ) : (
            "This token does not expire. Revoke it when it is no longer needed."
          )}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>I have stored the token</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Create an API token</DialogTitle>
          <DialogDescription>
            A token lets a script act as you through the API. It can read and change your data, but it cannot change
            your password, create further tokens or delete the account: those need an interactive session.
          </DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoFocus autoComplete="off" placeholder="e.g. Lab workstation script" {...field} />
              </FormControl>
              <FormDescription>Say where it will be used, so you know which one to revoke later.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="expires"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expires after</FormLabel>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input inputMode="numeric" autoComplete="off" className="w-28 font-mono" {...field} />
                </FormControl>
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <FormDescription>Optional. Leave empty for a token that never expires.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating" : "Create token"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function tokenState(t: TokenOut, now: number): { label: string; live: boolean } {
  if (t.revoked_at) return { label: "Revoked", live: false };
  if (t.expires_at && new Date(t.expires_at).getTime() <= now) return { label: "Expired", live: false };
  return { label: "Active", live: true };
}

const noopSubscribe = () => () => {};

function Tokens() {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const [creating, setCreating] = useState(false);
  const [toRevoke, setToRevoke] = useState<TokenOut | null>(null);
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "https://your-sensortrace-host",
  );
  // The fetch time is a stable reference point for "has this token expired".
  const now = tokens.dataUpdatedAt;
  const example = `curl -sS "${origin}/api/v1/sensors?ready=true" \\\n  -H "Authorization: Bearer $SENSORTRACE_TOKEN"`;

  return (
    <Panel
      title="API tokens"
      icon={KeyRound}
      flush
      action={
        <Button variant="ghost" size="xs" className="-mr-1.5 text-muted-foreground" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" /> New token
        </Button>
      }
    >
      {tokens.isPending ? (
        <LoadingRows rows={2} className="p-4" />
      ) : tokens.isError ? (
        <div className="p-4">
          <ErrorState variant="inline" title="Could not load API tokens" error={tokens.error} onRetry={() => void tokens.refetch()} retrying={tokens.isFetching} />
        </div>
      ) : tokens.data.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={KeyRound}
          title="No API tokens"
          description="Create a token to use SensorTrace from scripts and other tools without your password."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> Create a token
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {tokens.data.map((t) => {
            const state = tokenState(t, now);
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className={state.live ? undefined : "text-muted-foreground line-through"}>{t.name}</span>
                    <Badge variant={state.live ? "outline" : "secondary"}>{state.label}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono" title="Token prefix">
                      {t.prefix}…
                    </span>
                    <span aria-hidden="true"> · </span>
                    Created <FormattedDate value={t.created_at} mode="date" />
                    <span aria-hidden="true"> · </span>
                    {t.last_used_at ? (
                      <>
                        Last used <FormattedDate value={t.last_used_at} mode="relative" />
                      </>
                    ) : (
                      "Never used"
                    )}
                    <span aria-hidden="true"> · </span>
                    {t.revoked_at ? (
                      <>
                        Revoked <FormattedDate value={t.revoked_at} mode="date" />
                      </>
                    ) : t.expires_at ? (
                      <>
                        {state.live ? "Expires" : "Expired"} <FormattedDate value={t.expires_at} mode="date" />
                      </>
                    ) : (
                      "No expiry"
                    )}
                  </p>
                </div>
                {t.revoked_at ? null : (
                  <Button variant="outline" size="sm" onClick={() => setToRevoke(t)}>
                    Revoke<span className="sr-only"> token {t.name}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <TerminalSquare aria-hidden="true" className="size-4 text-muted-foreground" /> Using a token
        </h3>
        <p className="mt-1 mb-3 text-sm leading-relaxed text-muted-foreground">
          Send it as a bearer token. Keep it in an environment variable rather than in the script itself. The full
          API reference is at{" "}
          <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
            /api/v1/docs
          </a>
          .
        </p>
        <CodeBlock code={example} label="Copy curl example" />
      </div>
      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(open) => (open ? null : setToRevoke(null))}
        title="Revoke this token?"
        description={
          <>
            <span className="font-medium text-foreground">{toRevoke?.name}</span> (<span className="font-mono">{toRevoke?.prefix}…</span>)
            stops working immediately. Anything still using it will receive authentication errors. This cannot be
            undone.
          </>
        }
        confirmLabel="Revoke token"
        onConfirm={async () => {
          if (!toRevoke) return;
          await revoke.mutateAsync(toRevoke.id);
          toastSuccess("Token revoked");
        }}
      />
    </Panel>
  );
}

export function SecurityTab() {
  return (
    <div className="flex flex-col gap-6">
      <PasswordForm />
      <TwoStepVerification />
      <Sessions />
      <Tokens />
    </div>
  );
}
