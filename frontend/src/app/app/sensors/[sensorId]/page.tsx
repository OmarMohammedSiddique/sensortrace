import type { Metadata } from "next";

import { SensorProfile } from "@/components/cameras/sensor-profile";

export const metadata: Metadata = { title: "Sensor" };

export default function SensorPage() {
  return <SensorProfile />;
}
