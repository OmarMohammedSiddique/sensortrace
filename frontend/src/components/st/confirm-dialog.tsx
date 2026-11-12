"use client";

import { useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Say exactly what will be removed and that it cannot be undone. */
  description: React.ReactNode;
  /** Verb on the confirm button, e.g. "Delete camera". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling (default true). */
  destructive?: boolean;
  /**
   * When set, the user must type this exact text before the confirm button enables.
   * Use for irreversible, wide-reaching actions (deleting a device with its fingerprints,
   * an investigation, the account).
   */
  typedConfirmation?: string;
  /**
   * Runs on confirm. If it returns a promise the dialog shows a pending state, closes when
   * it resolves, and stays open showing the error message when it rejects.
   */
  onConfirm: () => void | Promise<unknown>;
  /** Extra content between the description and the buttons. */
  children?: React.ReactNode;
}

/** Confirmation for destructive actions, built on AlertDialog (focus-trapped, Esc to cancel). */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // Remount the body each time the dialog opens so typed text and errors reset.
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>{props.open ? <ConfirmBody {...props} /> : null}</AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  typedConfirmation,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !typedConfirmation || typed.trim() === typedConfirmation;

  const confirm = async () => {
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form method="post"
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {typedConfirmation ? (
        <div className="grid gap-1.5">
          <Label htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
            <span>
              Type <span className="font-mono font-medium text-foreground select-all">{typedConfirmation}</span> to confirm
            </span>
          </Label>
          <Input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-subtle px-2.5 py-1.5 text-sm">
          {error}
        </p>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!ready || pending}>
          {pending ? "Working" : confirmLabel}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
