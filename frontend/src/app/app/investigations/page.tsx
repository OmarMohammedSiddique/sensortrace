import { FolderSearch } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Investigations" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function InvestigationsPage() {
  return (
    <>
      <PageHeader title="Investigations" description="Cases that group evidence, comparisons, notes and history." />
      <EmptyState icon={FolderSearch} title="This section is being built" description="The investigations list is not available in this build yet." />
    </>
  );
}
