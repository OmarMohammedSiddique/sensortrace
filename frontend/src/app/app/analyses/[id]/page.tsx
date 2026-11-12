import { ScanSearch } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Analysis" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function AnalysesIdPage() {
  return (
    <>
      <PageHeader title="Analysis" description="Ranked candidates with measurements, outcomes, reasons and caveats." />
      <EmptyState icon={ScanSearch} title="This section is being built" description="The analysis result page is not available in this build yet." />
    </>
  );
}
