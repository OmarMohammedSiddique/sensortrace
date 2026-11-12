"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  label: string | null;
  setLabel: (label: string | null) => void;
}
const BreadcrumbLabelContext = createContext<Ctx | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbLabelContext.Provider value={value}>{children}</BreadcrumbLabelContext.Provider>;
}

export function useBreadcrumbLabelValue(): string | null {
  return useContext(BreadcrumbLabelContext)?.label ?? null;
}

/**
 * Replace the last crumb of the top-bar trail with a dynamic name on detail pages:
 *   useBreadcrumbLabel(device?.name)
 * The label is cleared automatically when the page unmounts.
 */
export function useBreadcrumbLabel(label: string | null | undefined): void {
  const setLabel = useContext(BreadcrumbLabelContext)?.setLabel;
  useEffect(() => {
    if (!setLabel) return;
    setLabel(label || null);
    return () => setLabel(null);
  }, [label, setLabel]);
}
