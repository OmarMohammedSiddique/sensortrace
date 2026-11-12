import type { Metadata } from "next";

import { DeviceDetail } from "@/components/cameras/device-detail";

export const metadata: Metadata = { title: "Camera" };

export default function DevicePage() {
  return <DeviceDetail />;
}
