import { expect, test, type Page } from "@playwright/test";

import { buildWorkspace, dashboardMetric, expectNoHorizontalOverflow, expectResultLoaded, newAccount, QUESTIONED_A, registerAccount, settle, type Workspace } from "./helpers";

const PHONE = { width: 375, height: 812 };

test.describe("phone width: public pages", () => {
  test.use({ viewport: PHONE });

  test("home fits the viewport and the mobile navigation opens", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expectNoHorizontalOverflow(page, "home");

    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    const nav = page.getByRole("navigation", { name: "Mobile" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Methodology" })).toBeVisible();
    await nav.getByRole("link", { name: "Methodology" }).click();
    await expect(page).toHaveURL(/\/methodology$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page, "methodology");
  });
});

test.describe("phone width: the app", () => {
  const account = newAccount("responsive");
  let page: Page;
  let workspace: Workspace;

  test.beforeAll(async ({ browser }) => {
    // Build the data at desktop width, then look at it on a phone.
    page = await (await browser.newContext()).newPage();
    await registerAccount(page, account);
    workspace = await buildWorkspace(page, "Responsive case");
    await page.setViewportSize(PHONE);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("dashboard fits the viewport and the mobile navigation opens", async () => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(dashboardMetric(page, "Cameras")).toContainText(/^1/);
    await settle(page);
    await expectNoHorizontalOverflow(page, "dashboard");

    // The sidebar is off-canvas on a phone.
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "Cameras", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Investigations", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await drawer.getByRole("link", { name: "Cameras", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/cameras$/);
    await expect(page.getByRole("heading", { level: 1, name: "Cameras" })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("cameras fits the viewport", async () => {
    await page.goto("/app/cameras");
    await expect(page.getByRole("table", { name: "Registered cameras" }).getByRole("row")).toHaveCount(2);
    await settle(page);
    await expectNoHorizontalOverflow(page, "cameras");
  });

  test("comparison laboratory fits the viewport", async () => {
    await page.goto("/app/compare");
    await expect(page.getByRole("heading", { level: 1, name: "Comparison laboratory" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Recent comparisons" })).toBeVisible();
    await settle(page);
    await expectNoHorizontalOverflow(page, "comparison laboratory");
  });

  test("analysis result fits the viewport", async () => {
    await page.goto(workspace.analysisUrl);
    await expectResultLoaded(page, QUESTIONED_A);
    await settle(page);
    await expectNoHorizontalOverflow(page, "analysis result");
    // Still fits after scrolling through the whole result.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectNoHorizontalOverflow(page, "analysis result (scrolled)");
  });
});
