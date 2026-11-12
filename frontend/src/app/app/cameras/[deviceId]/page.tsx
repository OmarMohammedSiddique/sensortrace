import { Camera } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Camera" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function CamerasDeviceidPage() {
  return (
    <>
      <PageHeader title="Camera" description="Device details and its sensors." />
      <EmptyState icon={Camera} title="This section is being built" description="The camera detail page is not available in this build yet." />
    </>
  );
}
