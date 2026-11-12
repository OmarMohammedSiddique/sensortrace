import { expect, test } from "@playwright/test";

import { accountMenu, fillRegistration, newAccount, registerAccount, signIn, signOut } from "./helpers";

test.describe("authentication", () => {
  // Serial: the wrong-password test signs in to the account registered by the first test. Sharing it
  // keeps the number of auth requests down, which the API rate-limits per client address.
  test.describe.configure({ mode: "serial" });
  const account = newAccount("auth");

  test("register, land in the app, sign out and sign back in", async ({ page }) => {
    await registerAccount(page, account);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await signOut(page, account);

    await signIn(page, account);
    await page.getByRole("link", { name: "Dashboard", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(accountMenu(page, account)).toBeVisible();
  });

  test("a wrong password shows an error and does not sign in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(`${account.password}-wrong`);
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("registration password rules", () => {
  test("a password that is too short is rejected on registration", async ({ page }) => {
    const account = { ...newAccount("short"), password: "Sh0rt!" };
    await fillRegistration(page, account);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/register/);

    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("a long but easily guessed password is refused by the server with a visible message", async ({ page }) => {
    // Twelve characters, so it passes the length rule, but only one distinct character.
    const account = { ...newAccount("weak"), password: "aaaaaaaaaaaa" };
    await fillRegistration(page, account);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText("Password must contain at least 5 different characters.");
    await expect(page).toHaveURL(/\/register/);

    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
