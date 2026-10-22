import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller, type PollEvent } from "../src/poll";
import type { Snapshot } from "../src/types";

function goodSnapshot(revision: string, text = '{"a":1}'): Snapshot {
  return {
    protocol: 1,
    revision,
    format: "json",
    display_name: "fixture.json",
    status: "ok",
    text,
  };
}

function response(body: Snapshot, etag: string): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { ETag: etag } });
}

function installFetch() {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flushPromises(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("createPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches immediately and never overlaps or queues a slow request", async () => {
    const fetchMock = installFetch();
    let finishFirst: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    fetchMock.mockResolvedValue(response(goodSnapshot("second"), '"second"'));
    const poller = createPoller({ token: "secret-token", onEvent: () => undefined });

    poller.start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [firstUrl, firstOptions] = fetchMock.mock.calls[0]!;
    expect(firstUrl).toBe(new URL("/api/snapshot", window.location.origin).href);
    expect(new Headers(firstOptions?.headers).get("Authorization")).toBe("Bearer secret-token");
    expect(String(firstUrl)).not.toContain("secret-token");

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishFirst?.(response(goodSnapshot("first"), '"first"'));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("keeps the newest ETag for input errors and accepts a return to the previous revision", async () => {
    const fetchMock = installFetch();
    const invalid: Snapshot = {
      protocol: 1,
      revision: "revision-b",
      format: "json",
      display_name: "fixture.json",
      status: "error",
      error: { code: "FILE_UNAVAILABLE", message: "The target file is unavailable." },
    };
    fetchMock
      .mockResolvedValueOnce(response(goodSnapshot("revision-a"), '"revision-a"'))
      .mockResolvedValueOnce(response(invalid, '"revision-b"'))
      .mockResolvedValueOnce(response(goodSnapshot("revision-a"), '"revision-a"'));
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(events.filter((event) => event.kind === "snapshot").map((event) => event.value.revision))
      .toEqual(["revision-a", "revision-b", "revision-a"]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("If-None-Match")).toBe('"revision-a"');
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("If-None-Match")).toBe('"revision-b"');
    poller.stop();
  });

  it("does not emit a new snapshot for a 304 response", async () => {
    const fetchMock = installFetch();
    fetchMock
      .mockResolvedValueOnce(response(goodSnapshot("revision-a"), '"revision-a"'))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"revision-a"' } }));
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(events.filter((event) => event.kind === "snapshot")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "connection").at(-1)).toMatchObject({
      kind: "connection",
      state: "connected",
    });
    poller.stop();
  });

  it("treats malformed wire JSON as a generic connection error", async () => {
    const fetchMock = installFetch();
    fetchMock.mockResolvedValueOnce(
      new Response('{"revision":"private-input-fragment"', { status: 200, headers: { ETag: '"bad"' } }),
    );
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    await flushPromises();

    expect(events.some((event) => event.kind === "snapshot")).toBe(false);
    const failure = events.find((event) => event.kind === "connection" && event.state === "retrying");
    expect(failure?.kind).toBe("connection");
    if (failure?.kind === "connection") {
      expect(failure.message).toMatch(/invalid snapshot/i);
      expect(failure.message).not.toContain("private-input-fragment");
    }
    poller.stop();
  });

  it("times out requests and stops after five seconds of continuous failures", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(events.some((event) => event.kind === "connection" && event.state === "retrying")).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(events.at(-1)).toMatchObject({ kind: "connection", state: "stopped" });
    expect(fetchMock.mock.calls.length).toBeLessThan(5);
  });

  it("stops immediately on authorization failure and reconnects on the same URL", async () => {
    const fetchMock = installFetch();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(response(goodSnapshot("revision-a"), '"revision-a"'));
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    await flushPromises();
    expect(events.at(-1)).toMatchObject({ kind: "connection", state: "stopped" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const oldUrl = fetchMock.mock.calls[0]?.[0];

    poller.reconnect();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(oldUrl);
    expect(events.some((event) => event.kind === "snapshot")).toBe(true);
    poller.stop();
  });

  it("ignores a response that completes after stop", async () => {
    const fetchMock = installFetch();
    let finish: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const events: PollEvent[] = [];
    const poller = createPoller({ token: "t", onEvent: (event) => events.push(event) });

    poller.start();
    poller.stop();
    finish?.(response(goodSnapshot("late"), '"late"'));
    await flushPromises();

    expect(events).toEqual([]);
  });

  it("keeps the reconnect request deadline when an aborted request settles late", async () => {
    const fetchMock = installFetch();
    let finishFirst: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const poller = createPoller({ token: "t", onEvent: () => undefined });

    poller.start();
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    poller.stop();
    poller.reconnect();
    const reconnectSignal = fetchMock.mock.calls[1]?.[1]?.signal;
    await flushPromises();

    expect(firstSignal?.aborted).toBe(true);
    expect(reconnectSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reconnectSignal?.aborted).toBe(true);

    finishFirst?.(response(goodSnapshot("late"), '"late"'));
    poller.stop();
  });
});
