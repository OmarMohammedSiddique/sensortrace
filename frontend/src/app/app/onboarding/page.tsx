import { Rocket } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Getting started" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function OnboardingPage() {
  return (
    <>
      <PageHeader title="Getting started" description="A short guide to your first camera and comparison." />
      <EmptyState icon={Rocket} title="This section is being built" description="The getting-started guide is not available in this build yet." />
    </>
  );
}
