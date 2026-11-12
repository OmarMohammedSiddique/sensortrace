import { expect, test, type Page } from "@playwright/test";

import { buildWorkspace, dashboardMetric, expectNoSeriousA11yViolations, expectResultLoaded, newAccount, QUESTIONED_A, registerAccount, setTheme, settle, signOut, type Workspace } from "./helpers";

test.describe("accessibility: public pages", () => {
  test("home has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expectNoSeriousA11yViolations(page, "home");
  });

  test("sign-in has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email")).toBeVisible();
    await settle(page);
    await expectNoSeriousA11yViolations(page, "sign-in");
  });
});

test.describe("accessibility: the app", () => {
  const account = newAccount("a11y");
  let page: Page;
  let workspace: Workspace;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ colorScheme: "light" })).newPage();
    await registerAccount(page, account);
    workspace = await buildWorkspace(page, "Accessibility case");
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  const pages: { label: string; open: () => Promise<void>; dark?: boolean }[] = [
    {
      label: "dashboard",
      dark: true,
      open: async () => {
        await page.goto("/app");
        await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
        await expect(dashboardMetric(page, "Cameras")).toContainText(/^1/);
      },
    },
    {
      label: "cameras",
      open: async () => {
        await page.goto("/app/cameras");
        await expect(page.getByRole("table", { name: "Registered cameras" }).getByRole("row")).toHaveCount(2);
      },
    },
    {
      label: "investigation",
      open: async () => {
        await page.goto(workspace.investigationUrl);
        await expect(page.getByRole("heading", { level: 1, name: workspace.investigationTitle })).toBeVisible();
        await expect(page.getByRole("table", { name: "Evidence images in this investigation" })).toBeVisible();
      },
    },
    {
      label: "comparison laboratory",
      open: async () => {
        await page.goto("/app/compare");
        await expect(page.getByRole("heading", { level: 1, name: "Comparison laboratory" })).toBeVisible();
        await expect(page.getByRole("table", { name: "Recent comparisons" })).toBeVisible();
        await expect(page.getByRole("checkbox", { name: "Select all" })).toBeVisible();
      },
    },
    {
      label: "analysis result",
      dark: true,
      open: async () => {
        await page.goto(workspace.analysisUrl);
        await expectResultLoaded(page, QUESTIONED_A);
      },
    },
  ];

  for (const { label, open } of pages) {
    test(`${label} has no serious or critical axe violations (light theme)`, async () => {
      await open();
      await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      await settle(page);
      await expectNoSeriousA11yViolations(page, `${label} (light)`);
    });
  }

  for (const { label, open } of pages.filter((p) => p.dark)) {
    test(`${label} has no serious or critical axe violations (dark theme)`, async () => {
      await open();
      await setTheme(page, "Dark");
      try {
        // Reload so the page is rendered in dark from the start, as a returning user sees it.
        await open();
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        await settle(page);
        await expectNoSeriousA11yViolations(page, `${label} (dark)`);
      } finally {
        await setTheme(page, "Light");
      }
    });
  }

  test("the sign-in form works with the keyboard alone", async () => {
    await signOut(page, account);
    await page.goto("/sign-in");
    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");
    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(email).toBeVisible();

    // Tab from the top of the document until the email field has focus (it may be focused already).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await email.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "Tab reaches the email field").toBe(true);
    await page.keyboard.type(account.email);

    // Email -> password -> submit, one Tab each.
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await page.keyboard.type(account.password);
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();

    // Enter submits from a field.
    await page.keyboard.press("Shift+Tab");
    await expect(password).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app(\/|$)/);
    await expect(page.getByRole("button", { name: `Account menu for ${account.email}` })).toBeVisible();
  });
});
