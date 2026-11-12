import { expect, test } from "@playwright/test";

const PUBLIC_PAGES = [
  { path: "/", heading: "Is this photograph consistent with this camera sensor?" },
  { path: "/product", heading: "A workspace for sensor fingerprint examinations" },
  { path: "/methodology", heading: "What SensorTrace computes, and where it stops being reliable" },
  { path: "/privacy", heading: "Your material stays yours, and the method has conditions" },
  { path: "/docs", heading: "Using SensorTrace" },
];

test.describe("public pages", () => {
  for (const { path, heading } of PUBLIC_PAGES) {
    test(`${path} renders its main heading`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    });
  }

  test("sign-in page renders its form", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  });

  test("register page renders its form", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("an unauthenticated visit to /app ends on the sign-in page", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
  });

  test("the home page makes no request to a third-party origin", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Scroll through the page so anything lazy-loaded is requested too.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");

    const network = requests.filter((url) => /^(https?|wss?):/.test(url));
    expect(network.length).toBeGreaterThan(0);
    const thirdParty = network.filter((url) => new URL(url).origin.replace(/^ws/, "http") !== origin);
    expect(thirdParty, "requests to other origins").toEqual([]);
  });
});
