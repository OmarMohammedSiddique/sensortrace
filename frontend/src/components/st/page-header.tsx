import Link from "next/link";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Omit for the current page (last crumb). */
  href?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons etc., right-aligned on desktop, wrapped under the title on mobile. */
  actions?: React.ReactNode;
  /**
   * In-page breadcrumb for pages whose trail needs dynamic names (a device or case title).
   * The app top bar already shows a static trail derived from the URL.
   */
  breadcrumb?: Crumb[];
  /** Badges rendered right after the title (DemoBadge, status). */
  badges?: React.ReactNode;
  /** Small line above the title (e.g. a case reference). */
  eyebrow?: React.ReactNode;
  className?: string;
}

/** The single `<h1>` of a page, with description, actions and an optional breadcrumb. */
export function PageHeader({ title, description, actions, breadcrumb, badges, eyebrow, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:mb-8", className)}>
      {breadcrumb?.length ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumb.map((crumb, i) => (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="max-w-[40ch] truncate">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">{title}</h1>
            {badges}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
