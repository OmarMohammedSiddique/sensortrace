import Link from "next/link";

import { Logo } from "@/components/st/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Link href="/" aria-label="SensorTrace home">
        <Logo />
      </Link>
      <div>
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          The page does not exist, or it was removed. Items you delete are gone for good, including their links.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/app">Open the app</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
