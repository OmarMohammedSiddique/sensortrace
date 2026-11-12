import { Camera } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Cameras" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function CamerasPage() {
  return (
    <>
      <PageHeader title="Cameras" description="Register devices, enrol their sensors and build fingerprints." />
      <EmptyState icon={Camera} title="This section is being built" description="The camera laboratory is not available in this build yet." />
    </>
  );
}
