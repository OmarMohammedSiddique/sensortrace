import type { Metadata } from "next";
import { Suspense } from "react";

import { InvestigationsList } from "@/components/investigations/investigations-list";

export const metadata: Metadata = { title: "Investigations" };

export default function InvestigationsPage() {
  return (
    <Suspense>
      <InvestigationsList />
    </Suspense>
  );
}
