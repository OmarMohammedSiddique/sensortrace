import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Reports" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="PDF reports generated from analyses and investigations." />
      <EmptyState icon={FileText} title="This section is being built" description="The reports list is not available in this build yet." />
    </>
  );
}
