import type { Metadata } from "next";
import { Suspense } from "react";

import { CompareLab } from "@/components/compare/compare-lab";

export const metadata: Metadata = { title: "Comparison laboratory" };

export default function ComparePage() {
  return (
    <Suspense>
      <CompareLab />
    </Suspense>
  );
}
