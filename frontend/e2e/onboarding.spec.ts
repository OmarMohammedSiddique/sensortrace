import { expect, test } from "@playwright/test";

import { accountMenu, dashboardMetric, fillRegistration, goToSection, JOB_TIMEOUT, MATCH, newAccount } from "./helpers";

const DEMO_NOTICE = "Everything in this guide is synthetic";

test("a fresh account completes the guided onboarding with the synthetic demo data", async ({ page }) => {
  const account = newAccount("onboarding");
  const step = (name: string) => page.getByRole("region", { name });
  const stepNav = page.getByRole("navigation", { name: "Guide steps" });

  await test.step("a newly registered account is taken to the guide", async () => {
    await fillRegistration(page, account);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(accountMenu(page, account)).toBeVisible();
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  });

  await test.step("step 1: what the tool does and does not tell you", async () => {
    const region = step("What SensorTrace does, and what it does not");
    await expect(region.getByText("Step 1 of 6")).toBeVisible();
    await expect(region.getByText("Synthetic demo", { exact: true })).toBeVisible();
    await expect(region.getByText(DEMO_NOTICE)).toBeVisible();
    await expect(region.getByText("A statistical indication, not proof")).toBeVisible();
    await expect(stepNav.getByRole("button", { name: /Compare images/ })).toBeDisabled();
    await region.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("step 2: create the demo cameras and wait for both fingerprints", async () => {
    const region = step("Create two demo cameras and enrol them");
    await expect(region.getByText("Step 2 of 6")).toBeVisible();
    await expect(region.getByRole("button", { name: "Waiting for both fingerprints" })).toBeDisabled();
    await region.getByRole("button", { name: "Create demo cameras" }).click();

    const enrolment = region.getByRole("list", { name: "Demo sensor enrolment" });
    for (const camera of ["Demo camera A (synthetic) / Main sensor", "Demo camera B (synthetic) / Main sensor"]) {
      const item = enrolment.getByRole("listitem").filter({ hasText: camera });
      await expect(item).toContainText("Ready", { timeout: JOB_TIMEOUT });
      await expect(item).toContainText(/Fingerprint v1 built from \d+ reference images/);
    }
    await region.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("step 3: look at a fingerprint", async () => {
    const region = step("Look at a fingerprint");
    await expect(region.getByText("Step 3 of 6")).toBeVisible();
    await expect(region.getByText("Synthetic demo", { exact: true }).first()).toBeVisible();
    await expect(region.getByRole("img", { name: /noise pattern of Demo camera A \(synthetic\)/ })).toBeVisible();
    await expect(region.getByRole("code")).toContainText(/[0-9a-f]{64}/);
    await expect(region.getByText(/^Contrast-enhanced visualisation\./)).toBeVisible();
    await region.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("step 4: run the demo comparison and read the outcomes", async () => {
    const region = step("Compare the three questioned images");
    await expect(region.getByText("Step 4 of 6")).toBeVisible();
    await expect(region.getByRole("button", { name: "Continue" })).toBeDisabled();
    await region.getByRole("button", { name: "Compare the three questioned images" }).click();

    const results = region.getByRole("list", { name: "Questioned images and their results" });
    const result = (file: string) => results.locator("> li").filter({ hasText: file });
    await expect(results.locator("> li")).toHaveCount(3);

    const a = result("demo-questioned-A.jpg");
    await expect(a.getByRole("link", { name: "Open the full analysis" })).toBeVisible({ timeout: JOB_TIMEOUT });
    await expect(a).toContainText("Synthetic demo");
    await expect(a).toContainText("The evidence supports a match with one enrolled sensor (Demo camera A (synthetic) / Main sensor) out of 2 compared.");
    await expect(a.getByRole("list", { name: "Ranked candidates" }).getByRole("listitem").filter({ hasText: "Rank 1: Demo camera A (synthetic) / Main sensor" }).first()).toContainText(MATCH);

    const b = result("demo-questioned-B.jpg");
    await expect(b.getByRole("link", { name: "Open the full analysis" })).toBeVisible({ timeout: JOB_TIMEOUT });
    await expect(b).toContainText("The evidence supports a match with one enrolled sensor (Demo camera B (synthetic) / Main sensor) out of 2 compared.");

    // The image from a camera that was never enrolled must not be attributed to either demo camera.
    const c = result("demo-questioned-C.jpg");
    await expect(c.getByRole("link", { name: "Open the full analysis" })).toBeVisible({ timeout: JOB_TIMEOUT });
    await expect(c).toContainText("Synthetic image from a camera that is not enrolled");
    await expect(c).toContainText("No enrolled sensor reached the match threshold.");
    await expect(c).not.toContainText(MATCH);
    await expect(c.getByRole("list", { name: "Ranked candidates" }).locator("> li")).toHaveCount(2);

    // Caveats and policy status accompany every outcome.
    for (const item of [a, b, c]) {
      await expect(item).toContainText("This result is a statistical indication, not proof of origin");
      await expect(item).toContainText("Uncalibrated policy: reference lines, no error rate available");
    }
    await region.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("step 5: generate a report", async () => {
    const region = step("Generate a report");
    await expect(region.getByText("Step 5 of 6")).toBeVisible();
    await region.getByRole("button", { name: "Generate report" }).click();
    await expect(region.getByRole("heading", { name: "Generated reports" })).toBeVisible({ timeout: JOB_TIMEOUT });
    await expect(region.getByText("Comparison report: demo-questioned-A.jpg").first()).toBeVisible();
    await expect(region.getByRole("button", { name: /^Download PDF/ })).toBeVisible();
    await region.getByRole("button", { name: "Continue" }).click();
  });

  await test.step("step 6: finish the guide, keeping the demo data", async () => {
    const region = step("Finish the guide");
    await expect(region.getByText("Step 6 of 6")).toBeVisible();
    await expect(region.getByText(DEMO_NOTICE)).toBeVisible();
    await region.getByRole("button", { name: "Finish the guide" }).click();

    const finished = step("You have finished the guide");
    await expect(finished.getByRole("status")).toContainText("Guide completed");
    await expect(finished.getByText("Synthetic demo", { exact: true })).toBeVisible();
    await finished.getByRole("link", { name: "Keep it and go to the dashboard" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    // Completion is recorded: the getting-started banner is gone, and the demo data is counted.
    await expect(dashboardMetric(page, "Cameras")).toContainText(/^2/);
    await expect(page.getByRole("region", { name: "Set up your first comparison" })).toHaveCount(0);
  });

  await test.step("the demo objects stay labelled as synthetic outside the guide", async () => {
    await goToSection(page, "Cameras", "Cameras");
    const cameras = page.getByRole("table", { name: "Registered cameras" });
    for (const name of ["Demo camera A (synthetic)", "Demo camera B (synthetic)"]) {
      const row = cameras.getByRole("row", { name: new RegExp(name.replace(/[()]/g, "\\$&")) });
      await expect(row).toContainText("Synthetic demo");
      await expect(row).toContainText("1 sensor, 1 with a fingerprint");
    }
  });
});
