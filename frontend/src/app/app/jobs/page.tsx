import { Activity } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Jobs" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function JobsPage() {
  return (
    <>
      <PageHeader title="Jobs" description="Background work: fingerprint estimation, comparisons and exports." />
      <EmptyState icon={Activity} title="This section is being built" description="The jobs page is not available in this build yet." />
    </>
  );
}
