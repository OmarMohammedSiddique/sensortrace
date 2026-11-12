"use client";

import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { MARKETING_NAV } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Logo } from "@/components/st/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMeta } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Sign in / Create account, or "Open app" when a session exists. */
function AuthActions({ stacked = false, onNavigate }: { stacked?: boolean; onNavigate?: () => void }) {
  const { status } = useAuth();
  const meta = useMeta();
  const registrationOpen = meta.data?.registration_open !== false;
  const size = stacked ? "lg" : "default";

  if (status === "loading") return <div aria-hidden="true" className={cn("h-8", stacked ? "w-full" : "w-40")} />;
  if (status === "authenticated") {
    return (
      <Button asChild size={size} className={cn(stacked && "w-full")}>
        <Link href="/app" onClick={onNavigate}>
          Open app <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
    );
  }
  return (
    <div className={cn("flex gap-2", stacked ? "flex-col" : "items-center")}>
      <Button asChild variant={stacked ? "outline" : "ghost"} size={size}>
        <Link href="/sign-in" onClick={onNavigate}>
          Sign in
        </Link>
      </Button>
      {registrationOpen ? (
        <Button asChild size={size}>
          <Link href="/register" onClick={onNavigate}>
            Create account
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function MarketingHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-sm">
      <div className="container-page flex h-14 items-center gap-6">
        <Link href="/" aria-label="SensorTrace home" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {MARKETING_NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <div className="hidden md:block">
            <AuthActions />
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(20rem,85vw)]">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col px-4">
                {MARKETING_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={pathname === item.href ? "page" : undefined}
                    className="border-b py-3 text-sm font-medium last:border-b-0"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto p-4">
                <AuthActions stacked onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const meta = useMeta();
  return (
    <footer className="mt-auto border-t bg-surface">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Sensor pattern noise analysis for testing whether a photograph is consistent with a camera you have
            enrolled. A statistical indication with stated limits, not proof of origin.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="eyebrow">Product</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li><Link className="text-muted-foreground hover:text-foreground" href="/product">Overview</Link></li>
            <li><Link className="text-muted-foreground hover:text-foreground" href="/methodology">Methodology</Link></li>
            <li><Link className="text-muted-foreground hover:text-foreground" href="/docs">Documentation</Link></li>
          </ul>
        </nav>
        <nav aria-label="Trust">
          <h2 className="eyebrow">Trust</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li><Link className="text-muted-foreground hover:text-foreground" href="/privacy">Privacy and responsible use</Link></li>
            <li><Link className="text-muted-foreground hover:text-foreground" href="/methodology#limitations">Limitations</Link></li>
            <li><Link className="text-muted-foreground hover:text-foreground" href="/methodology#references">References</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <div className="container-page flex flex-col gap-1 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>No telemetry, no analytics, no third-party requests.</p>
          {meta.data ? (
            <p className="font-mono">
              engine {meta.data.engine_version} · {meta.data.algorithm_version} · {meta.data.decision_policy_version}
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
