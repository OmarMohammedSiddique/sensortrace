"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Keeps the selected tab in the URL (`?tab=`), so a tab can be linked to and survives a
 * reload. The component calling this must be inside a `<Suspense>` boundary.
 *
 *   const [tab, setTab] = useUrlTab(["overview", "references"] as const, "overview");
 *   <Tabs value={tab} onValueChange={setTab}>
 */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T, param = "tab"): [T, (tab: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const raw = search.get(param);
  const current = (tabs as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const setTab = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(window.location.search);
      if (tab === fallback) params.delete(param);
      else params.set(param, tab);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [fallback, param, pathname, router],
  );
  return [current, setTab];
}
