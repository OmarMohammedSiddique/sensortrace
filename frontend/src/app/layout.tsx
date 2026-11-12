import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Providers } from "@/components/providers";
import { Telemetry } from "@/components/telemetry";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SensorTrace - Camera sensor fingerprint analysis",
    template: "%s - SensorTrace",
  },
  description:
    "SensorTrace tests whether a questioned photograph is consistent with the sensor pattern noise of a camera you have enrolled, and reports the statistic with its reasons and limits.",
  applicationName: "SensorTrace",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        {/* Aggregate, cookieless page-view and performance measurement: hosted deployment only. */}
        {process.env.VERCEL ? <Telemetry /> : null}
      </body>
    </html>
  );
}
