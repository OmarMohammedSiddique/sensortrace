import Link from "next/link";

import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Logo } from "@/components/st/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface">
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,black,transparent)]" />
      <header className="relative container-page flex h-14 items-center justify-between">
        <Link href="/" aria-label="SensorTrace home" className="rounded-md">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </main>
      <footer className="relative container-page pb-6 text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline-offset-4 hover:underline">Privacy and responsible use</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/methodology" className="underline-offset-4 hover:underline">Methodology</Link>
      </footer>
    </div>
  );
}
