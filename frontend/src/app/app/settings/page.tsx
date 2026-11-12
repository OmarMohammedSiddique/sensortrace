import { Settings } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Settings" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Account, security, data, usage, audit history and processing." />
      <EmptyState icon={Settings} title="This section is being built" description="The settings area is not available in this build yet." />
    </>
  );
}
