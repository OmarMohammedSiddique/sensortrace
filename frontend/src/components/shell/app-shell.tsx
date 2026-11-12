"use client";

import { BookOpen, Rocket } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, type ReactNode } from "react";

import { BreadcrumbLabelProvider, useBreadcrumbLabelValue } from "@/components/shell/breadcrumb-context";
import { JobsIndicator } from "@/components/shell/jobs-indicator";
import { APP_NAV, isNavActive, trailFor } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { Logo, LogoMark } from "@/components/st/logo";
import { ErrorState } from "@/components/st/states";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { signInHref, useAuth } from "@/lib/auth";

/** Authenticated application frame: sidebar, top bar and the page content area. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, error, refresh } = useAuth();
  const router = useRouter();

  // "unauthenticated" may come from the public-page shortcut (no session hint cookie), so
  // confirm with the API once before sending the visitor to the sign-in page.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    let cancelled = false;
    refresh()
      .then((hasSession) => {
        if (!cancelled && !hasSession) router.replace(signInHref(window.location.pathname + window.location.search));
      })
      .catch(() => {
        if (!cancelled) router.replace(signInHref(window.location.pathname + window.location.search));
      });
    return () => {
      cancelled = true;
    };
  }, [status, refresh, router]);

  if (status === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <ErrorState
          title="Could not check your session"
          error={error}
          onRetry={() => void refresh()}
          className="w-full max-w-md"
        />
      </div>
    );
  }
  if (status !== "authenticated") return <ShellSkeleton />;

  return (
    <BreadcrumbLabelProvider>
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <TopBar />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            <div className="container-page animate-fade-up py-6 sm:py-8">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbLabelProvider>
  );
}

function AppSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3">
        <Link
          href="/app"
          onClick={close}
          aria-label="SensorTrace dashboard"
          className="flex items-center rounded-md text-sidebar-accent-foreground"
        >
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <LogoMark className="hidden group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {APP_NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isNavActive(item, pathname);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} onClick={close} aria-current={active ? "page" : undefined}>
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {user && !user.onboarding_completed ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/app/onboarding"} tooltip="Getting started">
                <Link href="/app/onboarding" onClick={close}>
                  <Rocket aria-hidden="true" />
                  <span>Getting started</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <Link href="/docs" onClick={close}>
                <BookOpen aria-hidden="true" />
                <span>Documentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function TopBar() {
  const pathname = usePathname();
  const dynamicLabel = useBreadcrumbLabelValue();
  const trail = trailFor(pathname);
  const crumbs = [
    ...(pathname === "/app" ? [] : [{ label: "Dashboard", href: "/app" }]),
    ...trail.map((c, i) => (i === trail.length - 1 && dynamicLabel ? { ...c, label: dynamicLabel } : c)),
  ];

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-sm sm:px-4">
      <SidebarTrigger aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <BreadcrumbSeparator className={last ? undefined : "hidden sm:block"} /> : null}
                <BreadcrumbItem className={last ? "min-w-0" : "hidden sm:inline-flex"}>
                  {last || !crumb.href ? (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-0.5">
        <JobsIndicator />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" role="status" aria-label="Loading SensorTrace">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r bg-sidebar p-3 md:flex">
        <Skeleton className="mb-4 h-7 w-32" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex-1">
        <div className="flex h-14 items-center border-b px-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="container-page flex flex-col gap-4 py-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
