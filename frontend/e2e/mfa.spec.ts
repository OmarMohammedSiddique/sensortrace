import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { accountMenu, newAccount, registerAccount, signOut } from "./helpers";

/** RFC 6238 code for a base32 secret, `offset` steps of 30 seconds from now. */
function totp(secret: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac("sha1", key).update(counter).digest();
  const at = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("turn on two-step verification and sign in with a code", async ({ page }) => {
  const account = newAccount("mfa");
  await registerAccount(page, account);

  let secret = "";
  await test.step("turn it on from Settings", async () => {
    await page.goto("/app/settings?tab=security");
    const panel = page.locator("section, div").filter({ has: page.getByText("Two-step verification", { exact: true }) }).last();
    await expect(panel.getByText("Off", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Turn on" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Password").fill(account.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
    secret = (await dialog.getByLabel("Setup key").innerText()).trim();
    await dialog.getByLabel("Code from the app").fill(totp(secret));
    await dialog.getByRole("button", { name: "Turn on" }).click();
    await expect(dialog.getByRole("heading", { name: "Two-step verification is on" })).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
    await dialog.getByRole("button", { name: "I have saved the codes" }).click();
    await expect(page.getByText("Signing in needs your password and a code from your authenticator app.")).toBeVisible();
  });

  await signOut(page, account);

  await test.step("signing in asks for the code", async () => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const code = page.getByLabel("Authentication code");
    await expect(code).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    // The code used to turn the feature on may still be current, and codes cannot be reused: use the next one.
    await code.fill(totp(secret, 1));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page).toHaveURL(/\/app(\/|$)/);
    await expect(accountMenu(page, account)).toBeVisible();
  });
});
