import { FolderSearch } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Investigation" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function InvestigationsIdPage() {
  return (
    <>
      <PageHeader title="Investigation" description="Evidence, analyses, notes and processing history." />
      <EmptyState icon={FolderSearch} title="This section is being built" description="The investigation workspace is not available in this build yet." />
    </>
  );
}
