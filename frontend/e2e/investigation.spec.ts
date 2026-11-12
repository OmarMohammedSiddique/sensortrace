import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  addSensor,
  CAMERA_NAME,
  chooseFiles,
  createInvestigation,
  evidenceTable,
  expectResultLoaded,
  fingerprintRow,
  fixture,
  goToSection,
  JOB_TIMEOUT,
  MATCH,
  newAccount,
  QUESTIONED_A,
  QUESTIONED_OTHER,
  REFERENCE_FILES,
  registerAccount,
  registerConventionalCamera,
  runComparison,
  SENSOR_NAME,
  sessionRun,
  signIn,
  signOut,
} from "./helpers";

const SENSOR_LABEL = `${CAMERA_NAME} / ${SENSOR_NAME}`;
const TITLE = "E2E core journey";

function candidateRow(page: Page) {
  return page.getByRole("table", { name: "Candidates ranked by adjusted statistic" }).getByRole("row", { name: new RegExp(SENSOR_LABEL) });
}

/** The count shown next to an outcome label in the summary tally. */
function tally(page: Page, outcome: string) {
  return page.getByRole("region", { name: "Summary" }).getByRole("term").filter({ hasText: new RegExp(`^${outcome}$`) }).locator("xpath=following-sibling::dd[1]");
}

test.describe("core investigation journey", () => {
  test.describe.configure({ mode: "serial" });

  const account = newAccount("journey");
  let page: Page;
  let investigationUrl = "";
  let analysisUrls: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("register an account", async () => {
    await registerAccount(page, account);
  });

  test("register a camera declared as a conventional dedicated camera", async () => {
    await registerConventionalCamera(page);
    await expect(page.getByText("Conventional pipeline").first()).toBeVisible();
    const details = page.getByRole("term").filter({ hasText: /^Device type$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(details).toHaveText("Dedicated camera");
  });

  test("add a sensor", async () => {
    await addSensor(page);
    await expect(page.getByText("0 of 30 recommended reference images").first()).toBeVisible();
  });

  test("upload eight reference images and one file that is not an image", async () => {
    await chooseFiles(page, [...REFERENCE_FILES, fixture("not-an-image.jpg")]);
    await expect(page.getByRole("status").filter({ hasText: "Upload finished" })).toHaveText("Upload finished: 8 accepted, 1 rejected.", { timeout: 60_000 });

    const results = page.getByRole("region", { name: "Upload results" });
    await expect(results.getByText("8 accepted, 1 rejected", { exact: true })).toBeVisible();
    const rejected = results.getByRole("listitem").filter({ hasText: "not-an-image.jpg" });
    await expect(rejected).toContainText("Rejected: file content is not a JPEG or PNG image");
    await expect(results.getByRole("listitem").filter({ hasText: "ref-a-01.jpg" }).first()).toContainText("Accepted");

    // The sensor now holds exactly the eight valid images.
    await expect(page.getByRole("tab", { name: "Reference images 8" })).toBeVisible();
    const stored = page.getByRole("region", { name: /^Reference images/ });
    await expect(stored.getByRole("img", { name: /^Preview of reference image ref-a-/ })).toHaveCount(8);
    await expect(stored.getByText("not-an-image.jpg")).toHaveCount(0);
  });

  test("create the fingerprint and wait until it is ready", async () => {
    await page.getByRole("button", { name: "Go to fingerprint" }).click();
    await page.getByRole("button", { name: "Create fingerprint" }).click();

    const row = fingerprintRow(page);
    await expect(row).toContainText("Ready", { timeout: JOB_TIMEOUT });
    await expect(row).toContainText("Active");
    // Columns: Version, Status, Images, Digest, Created, Actions.
    await expect(row.getByRole("cell").nth(2)).toHaveText("8");
    await expect(row.getByRole("cell").nth(3).getByRole("code")).toContainText(/[0-9a-f]{64}/);

    const version = page.getByRole("region", { name: "Fingerprint version 1" });
    await expect(version.getByText("8 reference images were used.")).toBeVisible();
    const digest = version.getByRole("term").filter({ hasText: /^Fingerprint digest$/ }).locator("xpath=following-sibling::dd[1]").getByRole("code");
    await expect(digest).toHaveText(/^[0-9a-f]{64}$/);
  });

  test("create an investigation and upload two questioned images", async () => {
    investigationUrl = await createInvestigation(page, TITLE);
    await chooseFiles(page, [fixture(QUESTIONED_A), fixture(QUESTIONED_OTHER)]);
    await expect(page.getByRole("status").filter({ hasText: "Upload finished" })).toHaveText("Upload finished: 2 accepted.", { timeout: 60_000 });
    await expect(page.getByRole("tab", { name: "Evidence 2" })).toBeVisible();
    for (const name of [QUESTIONED_A, QUESTIONED_OTHER]) {
      const row = evidenceTable(page).getByRole("row", { name: new RegExp(name.replace(".", "\\.")) });
      await expect(row).toContainText("Questioned");
      await expect(row.getByRole("code")).toContainText(/[0-9a-f]{64}/);
    }
  });

  test("compare both images against the sensor in the comparison laboratory", async () => {
    analysisUrls = await runComparison(page, [QUESTIONED_A, QUESTIONED_OTHER]);
    await expect(sessionRun(page, QUESTIONED_A)).toContainText(MATCH, { timeout: JOB_TIMEOUT });
    await expect(sessionRun(page, QUESTIONED_A)).toContainText(`for the top-ranked candidate, ${SENSOR_LABEL}`);
    await expect(sessionRun(page, QUESTIONED_OTHER)).toContainText(SENSOR_LABEL, { timeout: JOB_TIMEOUT });
    await expect(sessionRun(page, QUESTIONED_OTHER)).not.toContainText(MATCH);
    expect(analysisUrls[QUESTIONED_A]).not.toBe(analysisUrls[QUESTIONED_OTHER]);
  });

  test("the result for the image from the enrolled sensor supports a match, with a PCE, limitations and an uncalibrated policy", async () => {
    await sessionRun(page, QUESTIONED_A).getByRole("link", { name: "Open full result" }).click();
    await expect(page).toHaveURL(new RegExp(`${analysisUrls[QUESTIONED_A]}$`));
    await expectResultLoaded(page, QUESTIONED_A);

    // Outcome wording.
    const row = candidateRow(page);
    await expect(row.getByRole("cell").last()).toHaveText(MATCH);
    await expect(tally(page, MATCH)).toHaveText("1");
    await expect(page.getByRole("region", { name: "Summary" })).toContainText("The evidence supports a match with one enrolled sensor");

    // A PCE value is displayed (columns: Rank, Device / sensor, Adjusted, PCE, NCC, Outcome), and it is above the match line of 60.
    await expect(page.getByRole("columnheader", { name: "PCE", exact: true })).toBeVisible();
    const pceText = (await row.getByRole("cell").nth(3).innerText()).trim();
    expect(pceText).toMatch(/^-?[\d,]+(\.\d+)?$/);
    expect(Number(pceText.replace(/,/g, ""))).toBeGreaterThan(60);
    const details = page.getByRole("region", { name: "Candidate details" });
    await expect(details.getByRole("term").filter({ hasText: /^PCE$/ })).toBeVisible();

    // Reasons and limitations sit next to the outcome.
    await expect(details.getByRole("heading", { name: "Outcome and reasons" })).toBeVisible();
    await expect(details.getByRole("heading", { name: "Limitations" })).toBeVisible();
    await expect(details.getByText("This result is a statistical indication, not proof of origin, and not a probability that the image came from the sensor.")).toBeVisible();
    await expect(details.getByText(/Thresholds are uncalibrated reference lines from the literature\./)).toBeVisible();

    // The policy is shown as uncalibrated.
    const policy = page.getByRole("region", { name: "Summary" }).getByRole("region", { name: "Decision policy" });
    await expect(policy.getByRole("heading", { name: "Uncalibrated policy: reference lines, no error rate available" })).toBeVisible();
    await expect(policy).toContainText("literature-reference-uncalibrated");
  });

  test("the result for the image from a different sensor does not support a match", async () => {
    await goToSection(page, "Compare", "Comparison laboratory");
    await page.getByRole("table", { name: "Recent comparisons" }).getByRole("link", { name: QUESTIONED_OTHER }).click();
    await expect(page).toHaveURL(new RegExp(`${analysisUrls[QUESTIONED_OTHER]}$`));
    await expectResultLoaded(page, QUESTIONED_OTHER);

    const row = candidateRow(page);
    await expect(row.getByRole("cell").last()).not.toHaveText(MATCH);
    await expect(row.getByRole("cell").last()).toHaveText(/^(Inconclusive|Evidence supports a non-match)$/);
    await expect(page.getByRole("table", { name: "Candidates ranked by adjusted statistic" })).not.toContainText(MATCH);
    await expect(page.getByRole("region", { name: "Candidate details" })).not.toContainText(MATCH);
    await expect(tally(page, MATCH)).toHaveText("0");
    await expect(page.getByRole("region", { name: "Summary" })).not.toContainText("The evidence supports a match");
    // Limitations and policy status are shown for this outcome too.
    await expect(page.getByRole("region", { name: "Candidate details" }).getByRole("heading", { name: "Limitations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Uncalibrated policy/ }).first()).toBeVisible();
  });

  test("generate the PDF report and download it", async ({}, testInfo) => {
    await page.goto(analysisUrls[QUESTIONED_A]);
    await expectResultLoaded(page, QUESTIONED_A);
    await page.getByRole("button", { name: "Generate PDF report" }).click();

    const link = page.getByRole("link", { name: "Download PDF" });
    await expect(link).toBeVisible({ timeout: JOB_TIMEOUT });
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    const target = testInfo.outputPath("report.pdf");
    await download.saveAs(target);
    const bytes = fs.readFileSync(target);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(5 * 1024);
  });

  async function expectEverythingStillThere() {
    await goToSection(page, "Investigations", "Investigations");
    await page.getByRole("link", { name: TITLE }).click();
    await expect(page).toHaveURL(new RegExp(`${new URL(investigationUrl).pathname}`));
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();

    await expect(page.getByRole("tab", { name: "Evidence 2" })).toBeVisible();
    await expect(evidenceTable(page).getByRole("row", { name: /questioned-a\.jpg/ })).toBeVisible();
    await expect(evidenceTable(page).getByRole("row", { name: /questioned-other\.jpg/ })).toBeVisible();

    await page.getByRole("tab", { name: "Comparisons 2" }).click();
    const comparisons = page.getByRole("tabpanel", { name: /^Comparisons/ });
    await expect(comparisons.getByRole("link", { name: QUESTIONED_OTHER })).toBeVisible();
    await comparisons.getByRole("link", { name: QUESTIONED_A }).click();
    await expect(page).toHaveURL(new RegExp(`${analysisUrls[QUESTIONED_A]}$`));
    await expectResultLoaded(page, QUESTIONED_A);
    await expect(candidateRow(page).getByRole("cell").last()).toHaveText(MATCH);
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  }

  test("everything is still there after a reload", async () => {
    await page.reload();
    await expectResultLoaded(page, QUESTIONED_A);
    await expect(candidateRow(page).getByRole("cell").last()).toHaveText(MATCH);
    await expectEverythingStillThere();
  });

  test("everything is still there after signing out and in again", async () => {
    await signOut(page, account);
    await signIn(page, account);
    await expectEverythingStillThere();

    // The camera, its sensor and the fingerprint persisted as well.
    await goToSection(page, "Cameras", "Cameras");
    await page.getByRole("link", { name: CAMERA_NAME }).click();
    await page.getByRole("link", { name: new RegExp(`^${SENSOR_NAME}`) }).click();
    await page.getByRole("tab", { name: "Fingerprint" }).click();
    await expect(fingerprintRow(page)).toContainText("Ready");
    await expect(fingerprintRow(page).getByRole("cell").nth(2)).toHaveText("8");
  });
});
