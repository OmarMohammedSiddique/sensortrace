import { expect, test } from "@playwright/test";

import { buildWorkspace, CAMERA_NAME, dashboardMetric, expectResultLoaded, goToSection, newAccount, QUESTIONED_A, registerAccount, SENSOR_NAME } from "./helpers";

test("one user's investigation and analysis are invisible to another user", async ({ browser }) => {
  const title = `Private case ${Date.now().toString(36)}`;

  // User A builds a camera, an investigation with evidence, and a completed comparison.
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const userA = newAccount("privacy-a");
  await registerAccount(pageA, userA);
  const workspace = await buildWorkspace(pageA, title);
  const analysisUrl = new URL(workspace.analysisUrl, workspace.investigationUrl).toString();
  const investigationId = workspace.investigationUrl.split("/").pop()!;
  const analysisId = analysisUrl.split("/").pop()!;

  // Sanity: A can open both.
  await pageA.goto(workspace.investigationUrl);
  await expect(pageA.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await pageA.goto(analysisUrl);
  await expectResultLoaded(pageA, QUESTIONED_A);

  // User B, in a separate browser context with its own session.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const userB = newAccount("privacy-b");
  await registerAccount(pageB, userB);

  const expectNoneOfAsData = async () => {
    const main = pageB.getByRole("main").last();
    for (const secret of [title, QUESTIONED_A, CAMERA_NAME, SENSOR_NAME, userA.email]) await expect(main).not.toContainText(secret);
  };

  await test.step("B opens A's investigation URL directly", async () => {
    await pageB.goto(workspace.investigationUrl);
    await expect(pageB.getByRole("heading", { name: "Investigation not found" })).toBeVisible();
    await expect(pageB.getByRole("heading", { name: title })).toHaveCount(0);
    await expect(pageB.getByRole("table", { name: "Evidence images in this investigation" })).toHaveCount(0);
    await expectNoneOfAsData();
  });

  await test.step("B opens A's analysis URL directly", async () => {
    await pageB.goto(analysisUrl);
    await expect(pageB.getByRole("heading", { name: "Comparison not found" })).toBeVisible();
    await expect(pageB.getByRole("heading", { name: "Summary" })).toHaveCount(0);
    await expect(pageB.getByRole("table", { name: "Candidates ranked by adjusted statistic" })).toHaveCount(0);
    await expectNoneOfAsData();
  });

  await test.step("the API itself answers B with not found for A's objects", async () => {
    // Same session cookies as B's browser; this is what the pages above received.
    const investigation = await pageB.request.get(`/api/v1/investigations/${investigationId}`);
    expect(investigation.status()).toBe(404);
    const analysis = await pageB.request.get(`/api/v1/analyses/${analysisId}`);
    expect(analysis.status()).toBe(404);
    expect(await investigation.text()).not.toContain(title);
    expect(await analysis.text()).not.toContain(QUESTIONED_A);
  });

  await test.step("B's own lists are empty", async () => {
    await goToSection(pageB, "Investigations", "Investigations");
    await expect(pageB.getByRole("heading", { name: "No investigations yet" })).toBeVisible();
    await expectNoneOfAsData();

    await goToSection(pageB, "Cameras", "Cameras");
    await expect(pageB.getByRole("heading", { name: "No cameras yet" })).toBeVisible();
    await expectNoneOfAsData();

    await goToSection(pageB, "Compare", "Comparison laboratory");
    await expect(pageB.getByRole("region", { name: "Recent comparisons" }).getByRole("heading", { name: "No comparisons yet" })).toBeVisible();
    await pageB.getByRole("tab", { name: "Choose existing" }).click();
    await expect(pageB.getByRole("tabpanel", { name: "Choose existing" }).getByRole("checkbox")).toHaveCount(0);
    await expectNoneOfAsData();

    await goToSection(pageB, "Reports", "Reports");
    await expect(pageB.getByRole("heading", { name: "No reports yet" })).toBeVisible();

    await goToSection(pageB, "Dashboard", "Dashboard");
    for (const metric of ["Cameras", "Investigations", "Analyses"]) await expect(dashboardMetric(pageB, metric)).toContainText(/^0/);
    await expectNoneOfAsData();
  });

  await test.step("A still has everything", async () => {
    await pageA.reload();
    await expectResultLoaded(pageA, QUESTIONED_A);
  });

  await contextA.close();
  await contextB.close();
});
