"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { redactUrl } from "@/lib/telemetry";

/**
 * Aggregate, cookieless page-view and performance measurement for the hosted deployment.
 * Every reported address passes through `redactUrl`, so no record identifier or query string is sent.
 */
export function Telemetry() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: redactUrl(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: redactUrl(event.url) })} />
    </>
  );
}
