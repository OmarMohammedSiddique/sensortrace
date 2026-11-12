/**
 * Checks for the frontend findings of the security audit (audit/SECURITY_AUDIT.md).
 * These exercise pure functions and need neither a browser nor a running stack:
 *   npx playwright test e2e/audit-security.spec.ts
 */
import { expect, test } from "@playwright/test";

import { safeNextPath } from "../src/lib/navigation-safety";
import { redactUrl } from "../src/lib/telemetry";

test("F-05: the post-sign-in destination cannot leave the site", () => {
  const origin = "https://sensortrace.example";
  const hostile = [
    "/\t/evil.example/owned", // what ?next=/%09/evil.example/owned decodes to
    "/\n/evil.example",
    "/\r/evil.example",
    "/\t\\evil.example",
    "/.//evil.example",
    "/app/..//evil.example",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
    null,
  ];
  for (const next of hostile) {
    const accepted = safeNextPath(next);
    expect(accepted, JSON.stringify(next)).toBe("/app");
    expect(new URL(accepted, origin).origin).toBe(origin);
  }
  for (const next of ["/app", "/app/investigations/123?tab=notes", "/app/settings?tab=data#exports"]) {
    expect(safeNextPath(next)).toBe(next);
    expect(new URL(safeNextPath(next), origin).origin).toBe(origin);
  }
});

test("F-06: addresses reported to page analytics carry no record identifier or query string", () => {
  const id = "5bce1681-db54-4c08-b4c5-62a7dd4cd8c5";
  expect(redactUrl(`https://sensortrace.vercel.app/app/investigations/${id}?tab=evidence#x`)).toBe(
    "https://sensortrace.vercel.app/app/investigations/[id]",
  );
  expect(redactUrl(`https://sensortrace.vercel.app/app/sensors/${id.toUpperCase()}`)).toBe("https://sensortrace.vercel.app/app/sensors/[id]");
  expect(redactUrl("https://sensortrace.vercel.app/sign-in?next=%2Fapp%2Fanalyses%2F" + id)).toBe("https://sensortrace.vercel.app/sign-in");
  expect(redactUrl("https://sensortrace.vercel.app/app/cameras/1234567")).toBe("https://sensortrace.vercel.app/app/cameras/[id]");
  expect(redactUrl("https://sensortrace.vercel.app/methodology")).toBe("https://sensortrace.vercel.app/methodology");
  expect(redactUrl("not a url")).toBe("");
  for (const url of [`https://h.example/app/analyses/${id}`, `https://h.example/app/cameras/${id}/x?q=${id}`]) {
    expect(redactUrl(url)).not.toContain(id);
  }
});
