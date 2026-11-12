import { cn } from "@/lib/utils";

/** Vertical rhythm for marketing pages: one Section per band. */
export function Section({
  children,
  className,
  band = false,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Tinted full-width band with hairlines. */
  band?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-14 sm:py-20", band && "border-y bg-surface", className)}>
      <div className="container-page">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow ? <p className="eyebrow mb-3 text-brand">{eyebrow}</p> : null}
      <Tag
        className={cn(
          "font-semibold tracking-tight",
          Tag === "h1" ? "text-3xl leading-[1.15] sm:text-4xl" : "text-2xl leading-tight sm:text-[1.75rem]",
        )}
      >
        {title}
      </Tag>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** Header band for the secondary public pages. */
export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: React.ReactNode }) {
  return (
    <div className="border-b bg-surface">
      <div className="container-page animate-fade-up py-12 sm:py-16">
        <SectionHeading as="h1" eyebrow={eyebrow} title={title} description={description} />
      </div>
    </div>
  );
}

/** Two-column documentation layout: sticky table of contents + content. */
export function DocLayout({ toc, children }: { toc: { id: string; label: string }[]; children: React.ReactNode }) {
  return (
    <div className="container-page grid gap-10 py-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16 lg:py-16">
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-24">
          <p className="eyebrow mb-3">On this page</p>
          <ul className="flex flex-col gap-2 border-l text-sm">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="-ml-px block border-l border-transparent pl-4 text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="flex min-w-0 max-w-3xl flex-col gap-14">{children}</div>
    </div>
  );
}

export function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="prose-st mt-4">{children}</div>
    </section>
  );
}

/** Displayed formula. Plain HTML (no math library); `label` is the spoken form. */
export function Formula({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="math"
      aria-label={label}
      className="overflow-x-auto rounded-lg border bg-card px-4 py-3.5 font-mono text-[0.875rem] leading-relaxed whitespace-nowrap text-foreground"
    >
      {children}
    </div>
  );
}
