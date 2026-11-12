import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s - SensorTrace" },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
