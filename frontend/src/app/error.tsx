"use client";

import { ErrorState } from "@/components/st/states";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <ErrorState title="Something went wrong on this page" error={error} onRetry={reset} className="w-full max-w-md" />
    </main>
  );
}
