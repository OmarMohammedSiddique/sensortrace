"use client";

import { ErrorState } from "@/components/st/states";

/** Keeps the app shell on screen when a page throws while rendering. */
export default function AppRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="This page could not be displayed" error={error} onRetry={reset} />;
}
