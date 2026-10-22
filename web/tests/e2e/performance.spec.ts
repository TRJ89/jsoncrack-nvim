import { expect, test, type Browser, type Page } from "@playwright/test";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixturePayload, startPreview } from "./support";

const execFileAsync = promisify(execFile);

type BrowserRenderObservation = {
  completedRenderMarker: string;
  visibleText: string;
  renderOpacity: string;
  browserCompletedEpochMs: number;
  renderedGraphNodeCount: number;
  svgGroupCount: number;
  documentVisible: boolean;
  documentFocused: boolean;
} | { error: string };

declare global {
  interface Window {
    __jsoncrackPerformanceObservation?: Promise<BrowserRenderObservation>;
  }
}

type ClockAlignment = {
  browserToNodeOffsetMs: number;
  bestRoundTripMs: number;
  uncertaintyMs: number;
};

type Sample = {
  index: number;
  savedText: string;
  writeCompletedAtNodeEpochMs: number;
  saveRpcAcknowledgedAtNodeEpochMs: number;
  saveRpcRoundTripMs: number;
  writeToSaveRpcAcknowledgementMs: number;
  renderCompletedAtNodeEpochMs: number;
  browserCompletedRenderMarker: string;
  visibleText: string;
  renderOpacity: string;
  renderedGraphNodeCount: number;
  svgGroupCount: number;
  durationMs: number;
  nodeObservationReadbackAtEpochMs: number;
  playwrightReadbackOverheadMs: number;
  documentVisible: boolean;
  documentFocused: boolean;
};

function countJsonValues(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, child) => sum + countJsonValues(child), 0);
  if (typeof value === "object" && value !== null) {
    return 1 + Object.values(value).reduce((sum, child) => sum + countJsonValues(child), 0);
  }
  return 1;
}

async function browserDetails(browser: Browser): Promise<Record<string, unknown>> {
  const [nvim, python] = await Promise.all([
    execFileAsync(process.env.NVIM_BIN ?? "nvim", ["--version"], { encoding: "utf8" }),
    execFileAsync(process.env.PYTHON ?? "python3", ["--version"], { encoding: "utf8" }),
  ]);
  return {
    os: { platform: platform(), release: release(), architecture: process.arch },
    display: {
      x11: process.env.DISPLAY ?? null,
      wayland: process.env.WAYLAND_DISPLAY ?? null,
      runtimeDirectory: process.env.XDG_RUNTIME_DIR ?? null,
    },
    cpu: { model: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length },
    memory: { totalBytes: totalmem(), freeAtStartBytes: freemem() },
    software: {
      nvim: nvim.stdout.split(/\r?\n/)[0],
      python: (python.stdout || python.stderr).trim(),
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      browserLaunchVariant: browser.browserType().name() === "chromium"
        ? "Playwright Chromium with ozone=" + (process.env.JSONCRACK_CHROMIUM_OZONE ?? "default")
        : "Playwright Firefox default launch",
      node: process.version,
    },
  };
}

async function alignBrowserClock(page: Page): Promise<ClockAlignment> {
  let bestRoundTripMs = Number.POSITIVE_INFINITY;
  let browserToNodeOffsetMs = 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nodeBeforeEpochMs = performance.timeOrigin + performance.now();
    const browserEpochMs = await page.evaluate(() => performance.timeOrigin + performance.now());
    const nodeAfterEpochMs = performance.timeOrigin + performance.now();
    const roundTripMs = nodeAfterEpochMs - nodeBeforeEpochMs;
    if (roundTripMs < bestRoundTripMs) {
      bestRoundTripMs = roundTripMs;
      browserToNodeOffsetMs = (nodeBeforeEpochMs + nodeAfterEpochMs) / 2 - browserEpochMs;
    }
  }

  return {
    browserToNodeOffsetMs,
    bestRoundTripMs,
    uncertaintyMs: bestRoundTripMs / 2,
  };
}

async function armBrowserRenderObservation(
  page: Page,
  previousMarker: string,
  expectedText: string,
): Promise<void> {
  await page.evaluate(({ previousRenderMarker, expectedVisibleText }) => {
    if (window.__jsoncrackPerformanceObservation) {
      throw new Error("A previous browser render observation is still active");
    }

    const marker = document.querySelector<HTMLElement>('[data-testid="last-rendered"]');
    const graph = document.querySelector<HTMLElement>('[data-testid="graph"]');
    if (!marker || !graph || !graph.querySelector(".jsoncrack-space")) {
      throw new Error("The rendered graph and completion marker must exist before measuring an update");
    }

    let resolveObservation: (value: BrowserRenderObservation) => void = () => undefined;
    window.__jsoncrackPerformanceObservation = new Promise((resolve) => {
      resolveObservation = resolve;
    });

    let finished = false;
    let consecutiveReadyFrames = 0;
    let frameId = 0;
    let timeoutId = 0;

    const finish = (result: BrowserRenderObservation): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      delete window.__jsoncrackPerformanceObservation;
      resolveObservation(result);
    };

    const inspectFrame = (): void => {
      if (finished) return;
      const currentMarker = marker.getAttribute("datetime");
      const currentSpace = graph.querySelector<HTMLElement>(".jsoncrack-space");
      const currentOpacity = currentSpace ? window.getComputedStyle(currentSpace).opacity : "";
      const expectedElement = Array.from(graph.querySelectorAll<HTMLElement>("[data-key]")).find(
        (element) => element.getAttribute("data-key") === expectedVisibleText,
      );
      const bounds = expectedElement?.getBoundingClientRect();
      const textIsVisible = !!expectedElement && !!bounds && bounds.width > 0 && bounds.height > 0 &&
        window.getComputedStyle(expectedElement).visibility !== "hidden" &&
        Number(window.getComputedStyle(expectedElement).opacity) > 0;
      const currentRenderIsReady =
        currentMarker !== null &&
        currentMarker !== previousRenderMarker &&
        textIsVisible &&
        currentOpacity === "1" &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      consecutiveReadyFrames = currentRenderIsReady ? consecutiveReadyFrames + 1 : 0;

      if (consecutiveReadyFrames >= 2) {
        finish({
          completedRenderMarker: currentMarker ?? "missing",
          visibleText: expectedVisibleText,
          renderOpacity: currentOpacity,
          browserCompletedEpochMs: performance.timeOrigin + performance.now(),
          renderedGraphNodeCount: graph.querySelectorAll(
            'svg foreignObject[data-id^="node-"]',
          ).length,
          svgGroupCount: graph.querySelectorAll("svg g").length,
          documentVisible: document.visibilityState === "visible",
          documentFocused: document.hasFocus(),
        });
        return;
      }
      frameId = window.requestAnimationFrame(inspectFrame);
    };

    timeoutId = window.setTimeout(() => {
      const space = graph.querySelector<HTMLElement>(".jsoncrack-space");
      finish({
        error: "Timed out waiting for a new visible graph render: " + JSON.stringify({
          currentMarker: marker.getAttribute("datetime"),
          previousMarker: previousRenderMarker,
          opacity: space ? window.getComputedStyle(space).opacity : null,
          expectedTextFound: Array.from(graph.querySelectorAll<HTMLElement>("[data-key]")).some(
            (element) => element.getAttribute("data-key") === expectedVisibleText,
          ),
          renderedGraphNodeCount: graph.querySelectorAll(
            'svg foreignObject[data-id^="node-"]',
          ).length,
          documentVisible: document.visibilityState === "visible",
          documentFocused: document.hasFocus(),
        }),
      });
    }, 10_000);
    frameId = window.requestAnimationFrame(inspectFrame);
  }, { previousRenderMarker: previousMarker, expectedVisibleText: expectedText });
}

async function waitForBrowserRender(page: Page): Promise<{
  observation: BrowserRenderObservation;
  nodeReadbackEpochMs: number;
}> {
  const observation = await page.evaluate(async () => {
    const pendingObservation = window.__jsoncrackPerformanceObservation;
    if (!pendingObservation) throw new Error("No browser render observation is armed");
    return pendingObservation;
  });
  return {
    observation,
    nodeReadbackEpochMs: performance.timeOrigin + performance.now(),
  };
}

test("20 foreground saves render within the approved nearest-rank p95 limit", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const preview = await startPreview("preview.json");
  const samples: Sample[] = [];
  const reportPath = testInfo.outputPath("task7-performance.json");
  let details: Record<string, unknown> | null = null;
  let fixtureBytes: number | null = null;
  let jsonValueCount: number | null = null;
  let renderedGraphNodeCount: number | null = null;
  let svgGroupCount: number | null = null;
  let clockAlignment: ClockAlignment | null = null;

  const writeReport = async (): Promise<void> => {
    const sorted = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const report = {
      browserProject: testInfo.project.name,
      measurement: "Immediately after Neovim :write completes to a changed render marker, matching visible graph text, and computed graph opacity 1 across two consecutive foreground animation frames.",
      method: "20 sequential headed foreground updates. The bridge timestamps completion of :write with vim.uv.hrtime() and returns that exact timestamp over RPC. The browser observation requires the marker to change, matching graph text to have visible bounds, the graph opacity to be 1, and the document to remain visible and focused for two animation frames. Browser and Node clocks are aligned using the lowest-RTT of five samples. The report records RPC acknowledgement overhead and Playwright readback delay separately.",
      fixture: {
        path: "tests/fixtures/preview.json",
        bytes: fixtureBytes,
        jsonValueCount,
        renderedGraphNodeCount,
        svgGroupCount,
        nodeCountMethod: "jsonValueCount counts JSON containers and scalar values; renderedGraphNodeCount counts jsoncrack-react foreignObject[data-id^=node-] elements in the completed SVG graph.",
      },
      limits: { maxFixtureBytes: 102_400, maxRenderedGraphNodes: 300, p95Ms: 1_000 },
      environment: details,
      clockAlignment,
      samples,
      nearestRankP95Ms: sorted.length === 20 ? sorted[18] : null,
      nodeMemoryRssBytes: process.memoryUsage().rss,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  };

  try {
    const source = await readFile(preview.targetPath, "utf8");
    const fixture = JSON.parse(source) as unknown;
    details = await browserDetails(browser);
    fixtureBytes = Buffer.byteLength(source, "utf8");
    jsonValueCount = countJsonValues(fixture);
    expect(fixtureBytes).toBeLessThanOrEqual(102_400);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(preview.url);
    await expect(page.getByText("updated: initial")).toBeVisible();
    const lastRendered = page.getByTestId("last-rendered");
    await expect(lastRendered).not.toHaveText("Not rendered yet");
    clockAlignment = await alignBrowserClock(page);
    const alignedClock = clockAlignment;
    if (!alignedClock) throw new Error("Browser clock alignment failed");

    for (let index = 1; index <= 20; index += 1) {
      const marker = "sample-" + String(index).padStart(2, "0");
      const expectedText = "updated: " + marker;
      const payload = await fixturePayload(marker);
      await page.bringToFront();
      const previousRenderMarker = await lastRendered.getAttribute("datetime");
      expect(previousRenderMarker).not.toBeNull();
      await armBrowserRenderObservation(page, previousRenderMarker ?? "", expectedText);
      const saveTiming = await preview.save(payload);
      const writeCompletedAtNodeEpochMs = saveTiming.writeCompletedAtEpochMs;
      const { observation, nodeReadbackEpochMs } = await waitForBrowserRender(page);
      if ("error" in observation) throw new Error(observation.error);

      const renderCompletedAtNodeEpochMs = observation.browserCompletedEpochMs + alignedClock.browserToNodeOffsetMs;
      const durationMs = renderCompletedAtNodeEpochMs - writeCompletedAtNodeEpochMs;
      const playwrightReadbackOverheadMs = nodeReadbackEpochMs - renderCompletedAtNodeEpochMs;
      expect(observation.completedRenderMarker).not.toBe(previousRenderMarker);
      expect(observation.visibleText).toBe(expectedText);
      expect(observation.renderOpacity).toBe("1");
      expect(observation.renderedGraphNodeCount).toBeGreaterThan(0);
      expect(observation.renderedGraphNodeCount).toBeLessThanOrEqual(300);
      expect(observation.svgGroupCount).toBeGreaterThan(0);
      expect(observation.documentVisible).toBe(true);
      expect(observation.documentFocused).toBe(true);
      expect(durationMs).toBeGreaterThanOrEqual(-alignedClock.uncertaintyMs);

      renderedGraphNodeCount = observation.renderedGraphNodeCount;
      svgGroupCount = observation.svgGroupCount;
      samples.push({
        index,
        savedText: marker,
        writeCompletedAtNodeEpochMs: Number(writeCompletedAtNodeEpochMs.toFixed(3)),
        saveRpcAcknowledgedAtNodeEpochMs: Number(saveTiming.rpcAcknowledgedAtEpochMs.toFixed(3)),
        saveRpcRoundTripMs: Number(saveTiming.rpcRoundTripMs.toFixed(3)),
        writeToSaveRpcAcknowledgementMs: Number(saveTiming.writeToAcknowledgementMs.toFixed(3)),
        renderCompletedAtNodeEpochMs: Number(renderCompletedAtNodeEpochMs.toFixed(3)),
        browserCompletedRenderMarker: observation.completedRenderMarker,
        visibleText: observation.visibleText,
        renderOpacity: observation.renderOpacity,
        renderedGraphNodeCount: observation.renderedGraphNodeCount,
        svgGroupCount: observation.svgGroupCount,
        durationMs: Number(durationMs.toFixed(3)),
        nodeObservationReadbackAtEpochMs: Number(nodeReadbackEpochMs.toFixed(3)),
        playwrightReadbackOverheadMs: Number(playwrightReadbackOverheadMs.toFixed(3)),
        documentVisible: observation.documentVisible,
        documentFocused: observation.documentFocused,
      });
      await writeReport();
    }

    const sorted = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const nearestRankP95 = sorted[18];
    expect(samples).toHaveLength(20);
    expect(nearestRankP95).toBeLessThanOrEqual(1_000);
  } finally {
    try {
      await writeReport();
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { nearestRankP95Ms: number | null };
      console.log("TASK7_PERFORMANCE " + JSON.stringify({
        browserProject: testInfo.project.name,
        sampleCount: samples.length,
        nearestRankP95Ms: report.nearestRankP95Ms,
        reportPath,
      }));
      await testInfo.attach("task7-performance.json", {
        path: reportPath,
        contentType: "application/json",
      });
    } finally {
      await preview.dispose();
    }
  }
});
