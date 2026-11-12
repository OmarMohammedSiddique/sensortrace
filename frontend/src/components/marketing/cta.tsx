"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMeta } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth";

/**
 * Primary call to action for public pages. Adapts to the session and to whether the
 * server accepts registrations (GET /meta `registration_open`).
 */
export function GetStarted({ secondary }: { secondary?: { href: string; label: string } }) {
  const { status } = useAuth();
  const meta = useMeta();
  const registrationOpen = meta.data?.registration_open !== false;

  const primary =
    status === "authenticated"
      ? { href: "/app", label: "Open the app" }
      : registrationOpen
        ? { href: "/register", label: "Create an account" }
        : { href: "/sign-in", label: "Sign in" };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg" className="h-10 px-4">
          <Link href={primary.href}>
            {primary.label} <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
        {secondary ? (
          <Button asChild size="lg" variant="outline" className="h-10 px-4">
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        ) : null}
      </div>
      {status !== "authenticated" && !registrationOpen ? (
        <p className="text-sm text-muted-foreground">
          Registration is closed on this server. Ask its administrator for an account.
        </p>
      ) : null}
    </div>
  );
}
