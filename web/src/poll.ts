import type { Format, Snapshot } from "./types";

export type PollEvent =
  | { kind: "snapshot"; value: Snapshot }
  | { kind: "connection"; state: "connected" | "retrying" | "stopped"; message?: string };

const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MESSAGE = "The local preview did not respond in time.";
const FAILURE_LIMIT_MS = 5_000;
const SNAPSHOT_PATH = "/api/snapshot";
const INVALID_SNAPSHOT_MESSAGE = "The server returned an invalid snapshot.";
const CONNECTION_FAILURE_MESSAGE = "Connection to the local preview failed.";
const FAILURE_LIMIT_MESSAGE = "The preview stopped responding. Reconnect to try again.";
const AUTH_FAILURE_MESSAGE = "The preview token was rejected. Reopen the preview from Neovim.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isFormat(value: unknown): value is Format {
  return value === "json" || value === "yaml";
}

const INPUT_ERROR_CODES = new Set([
  "FILE_UNAVAILABLE",
  "FILE_TOO_LARGE",
  "INVALID_ENCODING",
  "TARGET_CHANGED",
]);

export function decodeSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.protocol !== 1 ||
    typeof value.revision !== "string" ||
    value.revision.length === 0 ||
    value.revision.length > 256 ||
    !isFormat(value.format) ||
    typeof value.display_name !== "string" ||
    value.display_name.length === 0 ||
    value.display_name.includes("/") ||
    value.display_name.includes("\0")
  ) {
    return null;
  }

  const common = {
    protocol: 1 as const,
    revision: value.revision,
    format: value.format,
    display_name: value.display_name,
  };

  if (value.status === "ok") {
    if (!hasOnlyKeys(value, ["protocol", "revision", "format", "display_name", "status", "text"])) {
      return null;
    }
    if (typeof value.text !== "string") return null;
    return { ...common, status: "ok", text: value.text };
  }

  if (value.status === "error") {
    if (!hasOnlyKeys(value, ["protocol", "revision", "format", "display_name", "status", "error"])) {
      return null;
    }
    if (
      !isRecord(value.error) ||
      !hasOnlyKeys(value.error, ["code", "message"]) ||
      typeof value.error.code !== "string" ||
      !INPUT_ERROR_CODES.has(value.error.code) ||
      typeof value.error.message !== "string"
    ) {
      return null;
    }
    return {
      ...common,
      status: "error",
      error: { code: value.error.code, message: value.error.message },
    };
  }

  return null;
}

export function createPoller(options: {
  token: string;
  onEvent: (event: PollEvent) => void;
}): { start(): void; stop(): void; reconnect(): void } {
  let active = false;
  let generation = 0;
  let nextPollTimer: number | undefined;
  let failureTimer: number | undefined;
  let requestTimer: number | undefined;
  let currentController: AbortController | null = null;
  let cancelRequest: (() => void) | null = null;
  let etag: string | null = null;
  let failureSince: number | null = null;
  let hasConnected = false;

  const notify = (event: PollEvent): void => {
    try {
      options.onEvent(event);
    } catch {
      // Keep polling even if a consumer callback has a transient error.
    }
  };

  const clearScheduledPoll = (): void => {
    if (nextPollTimer !== undefined) window.clearTimeout(nextPollTimer);
    nextPollTimer = undefined;
  };

  const clearFailureDeadline = (): void => {
    if (failureTimer !== undefined) window.clearTimeout(failureTimer);
    failureTimer = undefined;
  };

  const clearRequestDeadline = (): void => {
    if (requestTimer !== undefined) window.clearTimeout(requestTimer);
    requestTimer = undefined;
  };

  const stopInternal = (message?: string): void => {
    if (!active) return;
    active = false;
    generation += 1;
    clearScheduledPoll();
    clearFailureDeadline();
    clearRequestDeadline();
    const controller = currentController;
    currentController = null;
    controller?.abort();
    const cancel = cancelRequest;
    cancelRequest = null;
    cancel?.();
    if (message) notify({ kind: "connection", state: "stopped", message });
  };

  const isCurrent = (run: number): boolean => active && generation === run;

  const stopForAuthorization = (): void => {
    stopInternal(AUTH_FAILURE_MESSAGE);
  };

  const fail = (run: number, message: string): void => {
    if (!isCurrent(run)) return;
    if (failureSince === null) {
      failureSince = Date.now();
      notify({ kind: "connection", state: "retrying", message });
      failureTimer = window.setTimeout(() => {
        stopInternal(FAILURE_LIMIT_MESSAGE);
      }, FAILURE_LIMIT_MS);
    }
  };

  const markConnected = (run: number): void => {
    if (!isCurrent(run)) return;
    const wasRetrying = failureSince !== null;
    failureSince = null;
    clearFailureDeadline();
    if (!hasConnected || wasRetrying) {
      hasConnected = true;
      notify({ kind: "connection", state: "connected" });
    }
  };

  const scheduleNext = (run: number): void => {
    if (!isCurrent(run)) return;
    clearScheduledPoll();
    nextPollTimer = window.setTimeout(() => {
      nextPollTimer = undefined;
      void poll(run);
    }, POLL_INTERVAL_MS);
  };

  const poll = async (run: number): Promise<void> => {
    if (!isCurrent(run)) return;

    const controller = new AbortController();
    currentController = controller;
    let timedOut = false;
    let attemptTimer: number | undefined;
    let attemptCancel: (() => void) | null = null;
    const headers = new Headers({ Authorization: "Bearer " + options.token });
    if (etag !== null) headers.set("If-None-Match", etag);

    const deadline = new Promise<never>((_resolve, reject) => {
      attemptCancel = () => reject(new DOMException("Request cancelled.", "AbortError"));
      cancelRequest = attemptCancel;
      attemptTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new DOMException("Request timed out.", "TimeoutError"));
      }, REQUEST_TIMEOUT_MS);
      requestTimer = attemptTimer;
    });

    try {
      const request = fetch(new URL(SNAPSHOT_PATH, window.location.origin).href, {
        method: "GET",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      const response = await Promise.race([request, deadline]);
      if (!isCurrent(run)) return;

      if (response.status === 401 || response.status === 403) {
        stopForAuthorization();
        return;
      }

      if (response.status === 304) {
        const nextEtag = response.headers.get("ETag");
        if (nextEtag !== null) etag = nextEtag;
        markConnected(run);
        return;
      }

      if (response.status !== 200) {
        fail(run, CONNECTION_FAILURE_MESSAGE);
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(await response.text()) as unknown;
      } catch {
        fail(run, INVALID_SNAPSHOT_MESSAGE);
        return;
      }
      if (!isCurrent(run)) return;

      const snapshot = decodeSnapshot(body);
      if (!snapshot) {
        fail(run, INVALID_SNAPSHOT_MESSAGE);
        return;
      }

      const nextEtag = response.headers.get("ETag");
      if (nextEtag !== null) etag = nextEtag;
      markConnected(run);
      notify({ kind: "snapshot", value: snapshot });
    } catch {
      if (!isCurrent(run)) return;
      fail(run, timedOut ? REQUEST_TIMEOUT_MESSAGE : CONNECTION_FAILURE_MESSAGE);
    } finally {
      if (requestTimer === attemptTimer) clearRequestDeadline();
      if (currentController === controller) currentController = null;
      if (cancelRequest === attemptCancel) cancelRequest = null;
      scheduleNext(run);
    }
  };

  const begin = (): void => {
    if (active) return;
    active = true;
    generation += 1;
    failureSince = null;
    clearFailureDeadline();
    const run = generation;
    hasConnected = false;
    void poll(run);
  };

  return {
    start(): void {
      begin();
    },
    stop(): void {
      stopInternal();
    },
    reconnect(): void {
      begin();
    },
  };
}
