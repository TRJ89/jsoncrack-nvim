import { expect, test, type Page } from "@playwright/test";

const externalRequests = new WeakMap<Page, Set<string>>();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

declare global {
  interface Window {
    __cspViolations: string[];
    __setRendererJson?: (json: string) => void;
  }
}

test.beforeEach(async ({ page }) => {
  const attempted = new Set<string>();
  externalRequests.set(page, attempted);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!loopbackHosts.has(url.hostname)) attempted.add(url.origin);
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (loopbackHosts.has(url.hostname)) {
      await route.continue();
    } else {
      attempted.add(url.origin);
      await route.abort("blockedbyclient");
    }
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    window.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect([...externalRequests.get(page)!], "external requests attempted").toEqual([]);
  expect(await page.evaluate(() => window.__cspViolations), "CSP violations").toEqual([]);
});

const openCase = (page: Page, name: string) => page.goto(`/?case=${name}`);
const clickRendererNode = (page: Page, id: string) =>
  page.locator(`[data-testid="graph"] svg g[id$="-node-${id}"] > rect`).click();

const waitForAnimationFrames = (page: Page, count: number) =>
  page.evaluate((frameCount) => new Promise<void>((resolve) => {
    let remaining = frameCount;
    const nextFrame = (): void => {
      remaining -= 1;
      if (remaining === 0) {
        resolve();
      } else {
        window.requestAnimationFrame(nextFrame);
      }
    };
    window.requestAnimationFrame(nextFrame);
  }), count);

test("renders a primitive without treating it as source code", async ({ page }) => {
  await openCase(page, "string");
  await expect(page.getByText("hello", { exact: true })).toBeVisible();
});

test("uses the official dark graph and same-origin layout worker", async ({ page }) => {
  const workerPromise = page.waitForEvent("worker");
  await openCase(page, "object");
  const worker = await workerPromise;
  expect(new URL(worker.url()).origin).toBe(new URL(page.url()).origin);

  const visualization = page.getByRole("img", { name: "JSON data visualization" });
  await expect(visualization).toBeVisible();
  await expect(page.getByRole("button", { name: "Root" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "-" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+" })).toBeVisible();
  await expect.poll(() => visualization.locator(".jsoncrack-space").evaluate((element) =>
    getComputedStyle(element).transitionDuration,
  )).toBe("0s");
  await expect.poll(() => visualization.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--edge-stroke").trim(),
  )).toBe("#444444");
});

test("renders object and array data", async ({ page }) => {
  await openCase(page, "object");
  await expect(page.getByTestId("graph")).toContainText("Ada");
  await openCase(page, "array");
  await expect(page.getByTestId("graph")).toContainText("first");
  await expect(page.getByTestId("graph")).toContainText("second");
});

test("renders number, boolean, and null roots", async ({ page }) => {
  for (const [name, value] of [
    ["number", "42"],
    ["boolean", "true"],
    ["null", "null"],
  ]) {
    await openCase(page, name);
    await expect(page.getByTestId("graph").getByText(value, { exact: true })).toBeVisible();
  }
});

test("shows a clear label and actual details for empty objects and arrays", async ({ page }) => {
  await openCase(page, "empty-object");
  await expect(page.getByRole("status")).toContainText("Empty JSON object");
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("dialog").locator("pre")).toHaveText("{}");
  await expect(page.getByRole("dialog").locator("code")).toHaveText("$");
  await page.keyboard.press("Escape");

  await openCase(page, "empty-array");
  await expect(page.getByRole("status")).toContainText("Empty JSON array");
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("dialog").locator("pre")).toHaveText("[]");
  await expect(page.getByRole("dialog").locator("code")).toHaveText("$");
});

test("opens full long values and node-local object details with keyboard and copy controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openCase(page, "long-string");
  await clickRendererNode(page, "1");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toHaveText(
    JSON.stringify("complete node detail value ".repeat(24), null, 2),
  );
  await page.screenshot({ path: testInfo.outputPath("node-details-narrow-long-string.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await openCase(page, "details-object");
  await clickRendererNode(page, "3");
  await expect(dialog.locator("code")).toHaveText("$.target");
  await expect(dialog.locator("pre")).toHaveText(
    JSON.stringify({ count: 2, emptyObject: {}, emptyArray: [] }, null, 2),
  );
  await expect(dialog.getByText("Child containers are shown as separate nodes.")).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath("node-details-dialog.png") });

  await dialog.getByRole("button", { name: "Copy path" }).click();
  await expect(dialog.locator('[aria-live="polite"]')).toHaveText(
    /^(Path copied\.|Could not copy path\. Select and copy the text instead\.)$/,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("resolves nested array indices and escaped property names from renderer nodes", async ({ page }) => {
  await openCase(page, "details-nested-array");
  const dialog = page.getByRole("dialog");

  await clickRendererNode(page, "2");
  await expect(dialog.locator("code")).toHaveText('$["a.b\\"c"][0]');
  await expect(dialog.locator("pre")).toHaveText(JSON.stringify([{ value: "first" }], null, 2));

  await page.keyboard.press("Escape");
  await clickRendererNode(page, "3");
  await expect(dialog.locator("code")).toHaveText('$["a.b\\"c"][0][0]');
  await expect(dialog.locator("pre")).toHaveText(JSON.stringify({ value: "first" }, null, 2));
});

test("keeps a long path scrollable while content and copy controls stay reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 500 });
  await openCase(page, "deep-details-path");
  await page.getByRole("button", { name: "Fit" }).click();
  await clickRendererNode(page, "2");

  const dialog = page.getByRole("dialog");
  const path = `$[${JSON.stringify(`level.${"segment.".repeat(80)}`)}]`;
  const pathCode = dialog.locator(".node-details-path code");
  await expect(pathCode).toHaveText(path);
  await expect.poll(() => pathCode.evaluate((element) =>
    element.scrollHeight > element.clientHeight,
  )).toBe(true);
  await expect(dialog.getByRole("button", { name: "Copy path" })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Copy content" })).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator("pre")).toHaveText('{\n  "leaf": "deep value"\n}');

  await pathCode.hover();
  const pathBounds = await pathCode.boundingBox();
  if (!pathBounds) throw new Error("Expected the path viewport to be visible.");
  await page.mouse.wheel(0, pathBounds.height);
  await expect.poll(() => pathCode.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await pathCode.selectText();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(path);
  await page.screenshot({ path: testInfo.outputPath("node-details-long-path-narrow.png") });
});

test("does not repeat empty-root completion for an inline state-updating callback", async ({ page }) => {
  await openCase(page, "inline-empty-callback");
  const count = page.getByTestId("inline-completion-count");
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(0);
  await waitForAnimationFrames(page, 6);
  await expect(count).toHaveText("1");
});

test("does not repeat graph completion for an inline state-updating callback", async ({ page }) => {
  await openCase(page, "inline-graph-callback");
  const count = page.getByTestId("inline-completion-count");
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(0);
  await waitForAnimationFrames(page, 6);
  await expect(count).toHaveText("1");
});

test("shows the renderer limit for an oversized array", async ({ page }) => {
  await openCase(page, "limit");
  await expect(page.getByRole("status")).toContainText("1500");
  await expect(page.getByTestId("graph")).not.toContainText("1499");
});

test("recovers from a parse error when the next input is valid", async ({ page }) => {
  await openCase(page, "error-recovery");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText("recovered", { exact: true })).toBeVisible();
});

test("renders string values as text rather than markup", async ({ page }) => {
  await openCase(page, "markup");
  await expect(page.getByText('<img src=x onerror="window.__xss=true">', { exact: true })).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __xss?: boolean }).__xss)).toBeUndefined();
});

test("only reports render completion for the current input", async ({ page }) => {
  await openCase(page, "current-input");
  const completedAfterChange = page.locator(
    '[data-testid="rendered-inputs"] [data-phase="after-change"]',
  );
  await expect(completedAfterChange).toHaveCount(1);
  await expect(completedAfterChange).toHaveText('"current input"');
});

test("reports a saved update after remounting a collapsed graph's new layout", async ({ page }) => {
  await openCase(page, "collapse-update");
  const graph = page.getByTestId("graph");
  const completedInputs = page.locator(
    '[data-testid="rendered-inputs"] [data-phase="before-change"]',
  );
  await expect(completedInputs).toHaveCount(1);

  const initialNodeCount = await graph.locator(
    'svg foreignObject[data-id^="node-"]',
  ).count();
  await graph.getByRole("button", { name: "Collapse" }).first().click();
  await expect.poll(() => graph.locator(
    'svg foreignObject[data-id^="node-"]',
  ).count()).toBeLessThan(initialNodeCount);
  const collapsedNodeCount = await graph.locator(
    'svg foreignObject[data-id^="node-"]',
  ).count();

  await page.evaluate(() => {
    window.__setRendererJson?.(JSON.stringify({
      group: { nested: { leaf: "hidden" }, peer: "hidden" },
      updated: "after",
    }));
  });

  const completedUpdate = page.locator(
    '[data-testid="rendered-inputs"] [data-phase="after-change"]',
  );
  await expect(completedUpdate).toHaveCount(1);
  await expect(graph.locator('[data-key="updated: after"]')).toBeVisible();
  expect(await graph.locator('svg foreignObject[data-id^="node-"]').count()).toBe(initialNodeCount);
  expect(Number(await completedUpdate.getAttribute("data-rendered-node-count"))).toBe(
    initialNodeCount,
  );
  expect(collapsedNodeCount).toBeLessThan(initialNodeCount);
  await expect(completedUpdate).toHaveAttribute("data-opacity", "1");
});
