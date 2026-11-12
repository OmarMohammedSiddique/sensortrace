import { Aperture } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/st/page-header";
import { EmptyState } from "@/components/st/states";

export const metadata: Metadata = { title: "Sensor" };

// Placeholder: replace this file with the real page (see CONVENTIONS.md).
export default function SensorsSensoridPage() {
  return (
    <>
      <PageHeader title="Sensor" description="Reference images and fingerprint versions for one sensor." />
      <EmptyState icon={Aperture} title="This section is being built" description="The sensor page is not available in this build yet." />
    </>
  );
}
