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

test("shows a clear label for empty objects and arrays", async ({ page }) => {
  await openCase(page, "empty-object");
  await expect(page.getByRole("status")).toContainText("Empty JSON object");
  await openCase(page, "empty-array");
  await expect(page.getByRole("status")).toContainText("Empty JSON array");
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
