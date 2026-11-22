import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const FIXTURES = path.join(__dirname, "fixtures");
export const fixture = (name: string) => path.join(FIXTURES, name);

export const REFERENCE_FILES = Array.from({ length: 8 }, (_, i) => fixture(`ref-a-${String(i + 1).padStart(2, "0")}.jpg`));
export const QUESTIONED_A = "questioned-a.jpg";
export const QUESTIONED_OTHER = "questioned-other.jpg";

/** Background jobs (fingerprints, comparisons, reports) can take up to a minute each. */
export const JOB_TIMEOUT = 180_000;

export const MATCH = "Evidence supports a match";

export interface Account {
  email: string;
  password: string;
}

/** A fresh account for every call, so runs never depend on earlier runs. */
export function newAccount(label: string): Account {
  const unique = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
  return {
    email: `e2e-${label}-${unique}@e2e-sensortrace.dev`,
    password: `Tr4ce-${unique}-Kestrel!`,
  };
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ account */

export async function fillRegistration(page: Page, account: Account) {
  await page.goto("/register");
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
}

/** Register through the UI and wait until the authenticated app shell is on screen. */
export async function registerAccount(page: Page, account: Account) {
  await fillRegistration(page, account);
  await page.getByRole("button", { name: "Create account" }).click();
  const menu = accountMenu(page, account);
  const refused = page.locator("form").getByRole("alert");
  await expect(menu.or(refused)).toBeVisible();
  if (await refused.isVisible()) {
    // Typically the API's sign-in/registration rate limit (20 requests per 15 minutes per client address).
    throw new Error(`Registration was refused: ${(await refused.innerText()).trim()}`);
  }
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

export function accountMenu(page: Page, account: Account): Locator {
  return page.getByRole("button", { name: `Account menu for ${account.email}` });
}

export async function signIn(page: Page, account: Account) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
  await expect(accountMenu(page, account)).toBeVisible();
}

export async function signOut(page: Page, account: Account) {
  await accountMenu(page, account).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).not.toHaveURL(/\/app(\/|$)/);
  await expect(accountMenu(page, account)).toHaveCount(0);
  // Signed out for real: the app sends the visitor to the sign-in page.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** Sidebar navigation (desktop widths). */
export async function goToSection(page: Page, name: "Dashboard" | "Cameras" | "Investigations" | "Compare" | "Reports", heading: string) {
  // The sidebar comes first in the document; the breadcrumb can repeat the same name for the current page.
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

/* ------------------------------------------------------------------ uploads */

/** Pick files through the dropzone's "Choose files" button, the way a user does. */
export async function chooseFiles(page: Page, files: string[]) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Choose files", exact: true }).click(),
  ]);
  await chooser.setFiles(files);
}

/* ------------------------------------------------------------------ cameras */

export const CAMERA_NAME = "Bench camera A";
export const SENSOR_NAME = "Main sensor 640x512";

/** Register a dedicated camera declared as a conventional pipeline. Ends on the camera page. */
export async function registerConventionalCamera(page: Page, name = CAMERA_NAME) {
  await goToSection(page, "Cameras", "Cameras");
  await page.getByRole("button", { name: "Register a camera" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Register a camera" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("combobox", { name: "Device type" }).click();
  await page.getByRole("option", { name: "Dedicated camera" }).click();
  await dialog.getByRole("radio", { name: /^Conventional/ }).check();
  await dialog.getByRole("button", { name: "Register camera" }).click();
  await expect(page).toHaveURL(/\/app\/cameras\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Add a sensor from the camera page. Ends on the sensor's reference-images tab. */
export async function addSensor(page: Page, name = SENSOR_NAME) {
  await page.getByRole("button", { name: "Add sensor" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a sensor" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add sensor" }).click();
  await expect(page).toHaveURL(/\/app\/sensors\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Reference images/ })).toHaveAttribute("aria-selected", "true");
}

export function fingerprintRow(page: Page, version = 1): Locator {
  return page.getByRole("table", { name: "Fingerprint versions for this sensor" }).getByRole("row", { name: new RegExp(`^v${version}\\b`) });
}

/** From the sensor page: start the first fingerprint and wait until the version is ready. */
export async function createFingerprint(page: Page) {
  await page.getByRole("tab", { name: "Fingerprint" }).click();
  await page.getByRole("button", { name: "Create fingerprint" }).click();
  await expect(fingerprintRow(page)).toContainText("Ready", { timeout: JOB_TIMEOUT });
}

/* ----------------------------------------------------------- investigations */

/** Create an investigation from the list page. Ends on its page; returns its URL. */
export async function createInvestigation(page: Page, title: string): Promise<string> {
  await goToSection(page, "Investigations", "Investigations");
  await page.getByRole("button", { name: "New investigation" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New investigation" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create investigation" }).click();
  await expect(page).toHaveURL(/\/app\/investigations\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.url().split("?")[0];
}

export function evidenceTable(page: Page): Locator {
  return page.getByRole("table", { name: "Evidence images in this investigation" });
}

/** On an investigation page: upload questioned images and wait until they are listed. */
export async function uploadEvidence(page: Page, names: string[]) {
  await chooseFiles(page, names.map(fixture));
  await expect(page.getByRole("status").filter({ hasText: "Upload finished" })).toHaveText(`Upload finished: ${names.length} accepted.`, { timeout: 60_000 });
  for (const name of names) await expect(evidenceTable(page).getByRole("row", { name: new RegExp(escapeRe(name)) })).toBeVisible();
}

/* ----------------------------------------------------------------- compare */

export function sessionRun(page: Page, filename: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ hasText: filename })
    .filter({ has: page.getByRole("link", { name: "Open full result" }) });
}

/**
 * In the comparison laboratory: select existing evidence and the sensor, run, and wait for
 * every result. Returns the result page URL (path) for each questioned image.
 */
export async function runComparison(page: Page, filenames: string[], sensorLabel = `${CAMERA_NAME} / ${SENSOR_NAME}`): Promise<Record<string, string>> {
  await goToSection(page, "Compare", "Comparison laboratory");
  await page.getByRole("tab", { name: "Choose existing" }).click();
  for (const name of filenames) await page.getByRole("checkbox", { name: new RegExp(escapeRe(name)) }).check();
  await expect(page.getByRole("heading", { name: `Selected ${filenames.length} of at most 20` })).toBeVisible();
  await page.getByRole("checkbox", { name: new RegExp(`^${escapeRe(sensorLabel)}`) }).check();
  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(page.getByRole("heading", { name: "This session's runs" })).toBeVisible();
  const urls: Record<string, string> = {};
  for (const name of filenames) {
    const link = sessionRun(page, name).getByRole("link", { name: "Open full result" });
    await expect(link).toBeVisible({ timeout: JOB_TIMEOUT });
    urls[name] = (await link.getAttribute("href")) ?? "";
    expect(urls[name]).toMatch(/^\/app\/analyses\/[0-9a-f-]{36}$/);
  }
  return urls;
}

/** Wait until a comparison result page shows its completed result. */
export async function expectResultLoaded(page: Page, filename: string) {
  await expect(page.getByRole("heading", { level: 1, name: filename })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible({ timeout: JOB_TIMEOUT });
  await expect(page.getByRole("table", { name: "Candidates ranked by adjusted statistic" })).toBeVisible();
}

/* ------------------------------------------------------------ whole journey */

export interface Workspace {
  investigationTitle: string;
  investigationUrl: string;
  analysisUrl: string;
}

/**
 * The shortest real journey to a completed comparison, through the UI: camera, sensor, eight
 * reference images, fingerprint, investigation, one questioned image, one comparison.
 * Used by the suites that need a populated account (privacy, accessibility, responsive).
 */
export async function buildWorkspace(page: Page, investigationTitle: string): Promise<Workspace> {
  await registerConventionalCamera(page);
  await addSensor(page);
  await chooseFiles(page, REFERENCE_FILES);
  await expect(page.getByRole("status").filter({ hasText: "Upload finished" })).toHaveText("Upload finished: 8 accepted.", { timeout: 60_000 });
  await createFingerprint(page);
  const investigationUrl = await createInvestigation(page, investigationTitle);
  await uploadEvidence(page, [QUESTIONED_A]);
  const urls = await runComparison(page, [QUESTIONED_A]);
  await expect(sessionRun(page, QUESTIONED_A)).toContainText(MATCH, { timeout: JOB_TIMEOUT });
  return { investigationTitle, investigationUrl, analysisUrl: urls[QUESTIONED_A] };
}

/* ---------------------------------------------------------------- dashboard */

/** The value shown on a dashboard metric tile ("Cameras", "Investigations", "Analyses", ...). */
export function dashboardMetric(page: Page, label: string): Locator {
  return page.getByRole("link", { name: label, exact: true }).locator("xpath=ancestor::div[dd][1]/dd");
}

/* --------------------------------------------------------------------- misc */

/** Wait for client data to arrive: no loading skeletons or app-shell placeholder left. */
export async function settle(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // Data skeletons only: a lazily loaded image below the fold keeps its own placeholder until it is scrolled to.
  await expect(page.locator('[data-slot="skeleton"]:not(img ~ [data-slot="skeleton"])')).toHaveCount(0);
  // Entry animations fade content in over 200 ms; half-transparent text would skew contrast checks.
  await page.waitForTimeout(400);
}

export async function setTheme(page: Page, theme: "Light" | "Dark") {
  await page.getByRole("button", { name: "Change colour theme" }).click();
  await page.getByRole("menuitemradio", { name: theme }).click();
  if (theme === "Dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
}

/** Run axe with the WCAG 2 A/AA rule sets and fail on serious or critical violations. */
export async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.replace(/\s+/g, " ").slice(0, 300)}`),
    }));
  expect(blocking, `serious or critical accessibility violations on ${label}`).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth, `${label}: page scrolls horizontally (scrollWidth ${size.scrollWidth}, clientWidth ${size.clientWidth})`).toBeLessThanOrEqual(size.clientWidth + 1);
}
