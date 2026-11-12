import type { Metadata } from "next";

import { CamerasList } from "@/components/cameras/cameras-list";

export const metadata: Metadata = { title: "Cameras" };

export default function CamerasPage() {
  return <CamerasList />;
}
