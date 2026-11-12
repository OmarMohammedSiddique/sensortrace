import { GitCompareArrows } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Compare" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function ComparePage() {
  return (
    <>
      <PageHeader title="Compare" description="Test a questioned image against enrolled sensor fingerprints." />
      <EmptyState icon={GitCompareArrows} title="This section is being built" description="The comparison laboratory is not available in this build yet." />
    </>
  );
}
