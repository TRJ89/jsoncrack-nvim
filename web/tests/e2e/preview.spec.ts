import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { startPreview } from "./support";

test("renders saved changes, preserves the last valid graph, and reuses unchanged revisions", async ({ page }) => {
  const preview = await startPreview("preview.json");
  const notModifiedResponses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/snapshot") && response.status() === 304) {
      notModifiedResponses.push(response.status());
    }
  });

  try {
    await page.goto(preview.url);
    await expect(page.getByRole("heading", { name: "preview.json" })).toBeVisible();
    await expect(page.getByText("updated: initial")).toBeVisible();
    const lastRendered = page.getByTestId("last-rendered");
    await expect(lastRendered).not.toHaveText("Not rendered yet");
    const renderedAt = await lastRendered.getAttribute("datetime");

    await preview.save('{"value":"visible"}');
    await expect(page.getByText("value: visible")).toBeVisible();
    await expect.poll(() => lastRendered.getAttribute("datetime")).not.toBe(renderedAt);
    const validRenderedAt = await lastRendered.getAttribute("datetime");
    expect(validRenderedAt).not.toBe(renderedAt);

    await preview.save("{");
    await expect(page.getByRole("alert")).toContainText("Input error");
    await expect(page.getByText("value: visible")).toBeVisible();
    expect(await page.getByTestId("last-rendered").getAttribute("datetime")).toBe(validRenderedAt);

    await preview.save('{"value":"visible again"}');
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("value: visible again")).toBeVisible();
    await expect.poll(() => lastRendered.getAttribute("datetime")).not.toBe(validRenderedAt);
    const recoveredRenderedAt = await lastRendered.getAttribute("datetime");

    await preview.save('{"value":"visible again"}');
    await expect.poll(() => notModifiedResponses.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(await page.getByTestId("last-rendered").getAttribute("datetime")).toBe(recoveredRenderedAt);

    await page.reload();
    await expect(page.getByText("value: visible again")).toBeVisible();
    expect(preview.port).toBe(Number(new URL(preview.url).port));
  } finally {
    await preview.dispose();
  }
});

test("recovers from a read failure after atomic replacement", async ({ page }) => {
  const preview = await startPreview("preview.json");
  try {
    await page.goto(preview.url);
    await expect(page.getByText("updated: initial")).toBeVisible();

    await preview.deleteTarget();
    await expect(page.getByRole("alert")).toContainText("File read error");
    await expect(page.getByText("updated: initial")).toBeVisible();

    await preview.atomicReplace('{"value":"atomic replacement restored"}');
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("value: atomic replacement restored")).toBeVisible();
  } finally {
    await preview.dispose();
  }
});

test("reopens a closed browser tab with the same preview process", async ({ page }) => {
  const preview = await startPreview("preview.json");
  const context = page.context();
  try {
    await page.goto(preview.url);
    await expect(page.getByText("updated: initial")).toBeVisible();
    await page.close();

    const reopenedUrl = await preview.open();
    expect(reopenedUrl).toBe(preview.url);
    const reopenedPage = await context.newPage();
    await reopenedPage.goto(reopenedUrl);
    await expect(reopenedPage.getByText("updated: initial")).toBeVisible();
    expect(preview.serverPid).toBeGreaterThan(0);
    await reopenedPage.close();
  } finally {
    await preview.dispose();
  }
});

test("keeps separate Neovim sessions isolated after Stop", async ({ page, context }) => {
  const first = await startPreview("preview.json");
  const second = await startPreview("preview.json");
  const secondPage = await context.newPage();
  try {
    expect(first.port).not.toBe(second.port);
    await page.goto(first.url);
    await secondPage.goto(second.url);
    await expect(page.getByText("updated: initial")).toBeVisible();
    await expect(secondPage.getByText("updated: initial")).toBeVisible();

    await second.save('{"value":"new session only"}');
    await expect(secondPage.getByText("value: new session only")).toBeVisible();
    await first.stop();
    await expect(page.getByText("Preview connection stopped")).toBeVisible({ timeout: 9_000 });
    await expect(page.getByText("value: new session only")).toHaveCount(0);
    await expect(secondPage.getByText("value: new session only")).toBeVisible();
  } finally {
    await secondPage.close();
    await first.dispose();
    await second.dispose();
  }
});

test("renders YAML updates through the saved file", async ({ page }) => {
  const preview = await startPreview("preview.yaml");
  try {
    await page.goto(preview.url);
    await expect(page.getByRole("heading", { name: "preview.yaml" })).toBeVisible();
    await expect(page.getByText("YAML", { exact: true })).toBeVisible();
    await expect(page.getByText("updated: initial")).toBeVisible();

    await preview.save("name: Updated YAML inventory\nupdated: saved-yaml\nitems:\n  - name: Gateway\n    healthy: true\n");
    await expect(page.getByText("updated: saved-yaml")).toBeVisible();
    await expect(page.getByText("Gateway")).toBeVisible();
  } finally {
    await preview.dispose();
  }
});

test("enforces input and node limits while Neovim stays responsive", async ({ page }) => {
  const preview = await startPreview("preview.json");
  try {
    await page.goto(preview.url);
    await expect(page.getByText("updated: initial")).toBeVisible();

    await preview.save('{"payload":"' + "x".repeat(1_048_577) + '"}');
    await expect(page.getByRole("alert")).toContainText("exceeds the 1 MiB limit");
    const pingStarted = performance.now();
    await preview.ping();
    expect(performance.now() - pingStarted).toBeLessThan(500);

    await preview.save("[".repeat(101) + "0" + "]".repeat(101));
    await expect(page.getByRole("alert")).toContainText("Maximum nesting depth is 100");

    await preview.save('{"unsafe":9007199254740993}');
    await expect(page.getByRole("alert")).toContainText("outside JavaScript's safe range");

    await preview.save("1e400");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(/finite|number/i);

    await preview.save(JSON.stringify(Array.from({ length: 1_500 }, (_, index) => index)));
    await expect(page.getByRole("status")).toContainText("Too large to render");

    await preview.save('{"value":"small graph restored"}');
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByText("value: small graph restored")).toBeVisible();
  } finally {
    await preview.dispose();
  }
});

test("applies CSP, renders hostile data as text, and makes no external requests", async ({ page }) => {
  const preview = await startPreview("preview.json");
  const origin = new URL(preview.url).origin;
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  try {
    const response = await page.goto(preview.url);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");

    await page.evaluate(() => {
      (window as typeof window & { __jsoncrackXss?: number }).__jsoncrackXss = 0;
    });
    const payload = '<img src=x onerror="window.__jsoncrackXss=1">';
    await preview.save(JSON.stringify({ payload }));
    await expect(page.getByText(payload)).toBeVisible();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => (window as typeof window & { __jsoncrackXss?: number }).__jsoncrackXss)).toBe(0);
    await expect(page.locator('[data-testid="graph"] [onerror], [data-testid="graph"] script')).toHaveCount(0);

    const fileBytes = await readFile(preview.targetPath);
    expect(JSON.parse(fileBytes.toString("utf8"))).toEqual({ payload });
    expect(externalRequests).toEqual([]);
  } finally {
    await preview.dispose();
  }
});
