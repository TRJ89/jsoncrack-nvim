import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const execFileAsync = promisify(execFile);
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../..");
const bridgeScript = join(repositoryRoot, "tests/integration/nvim_bridge.lua");
const nvimBinary = process.env.NVIM_BIN ?? "nvim";

export type Preview = {
  url: string;
  targetPath: string;
  nvimPid: number;
  serverPid: number;
  port: number;
  save(text: string): Promise<{
    writeCompletedAtEpochMs: number;
    rpcAcknowledgedAtEpochMs: number;
    rpcRoundTripMs: number;
    writeToAcknowledgementMs: number;
  }>;
  open(): Promise<string>;
  stop(): Promise<void>;
  deleteTarget(): Promise<void>;
  atomicReplace(text: string): Promise<void>;
  ping(): Promise<number>;
  dispose(): Promise<void>;
};

function vimString(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

async function waitFor<T>(
  description: string,
  predicate: () => Promise<T | null | undefined | false>,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Timed out waiting for " + description + (lastError ? ": " + String(lastError) : ""));
}

async function processCommand(pid: number): Promise<string | null> {
  try {
    return (await readFile("/proc/" + pid + "/cmdline")).toString().replaceAll("\0", " ");
  } catch {
    return null;
  }
}

async function childPids(pid: number): Promise<number[]> {
  try {
    const children = (await readFile("/proc/" + pid + "/task/" + pid + "/children", "utf8")).trim();
    return children ? children.split(/\s+/).map(Number) : [];
  } catch {
    return [];
  }
}

async function descendants(rootPid: number): Promise<Array<{ pid: number; command: string }>> {
  const result: Array<{ pid: number; command: string }> = [];
  const pending = [rootPid];
  const seen = new Set(pending);
  while (pending.length > 0) {
    const parent = pending.shift();
    if (parent === undefined) continue;
    for (const pid of await childPids(parent)) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const command = await processCommand(pid);
      if (command === null) continue;
      result.push({ pid, command });
      pending.push(pid);
    }
  }
  return result;
}

async function serverPid(nvimPid: number): Promise<number | null> {
  const expected = join(repositoryRoot, "server/main.py");
  const children = await descendants(nvimPid);
  return children.find((child) => child.command.includes(expected))?.pid ?? null;
}

async function alive(pid: number): Promise<boolean> {
  try {
    await stat("/proc/" + pid);
    return true;
  } catch {
    return false;
  }
}

async function closeOwnedProcess(pid: number, expectedCommand: string): Promise<void> {
  if (!(await alive(pid))) return;
  const command = await processCommand(pid);
  if (!command?.includes(expectedCommand)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  try {
    await waitFor("owned child process to exit", async () => ((await processCommand(pid)) === null ? true : null), 1_000);
  } catch {
    const current = await processCommand(pid);
    if (current?.includes(expectedCommand)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process may have exited between the identity check and signal.
      }
    }
    try {
      await waitFor("owned child process to exit after SIGKILL", async () => ((await processCommand(pid)) === null ? true : null), 1_000);
    } catch {
      throw new Error("Owned Python preview process did not exit: " + pid);
    }
  }
}

export async function startPreview(fixture: string): Promise<Preview> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "jsoncrack-e2e-"));
  const targetPath = join(temporaryRoot, basename(fixture));
  const fixturePath = join(repositoryRoot, "tests/fixtures", fixture);
  const address = join(temporaryRoot, "nvim.sock");
  const urlLog = join(temporaryRoot, "opened-urls.log");
  const notificationLog = join(temporaryRoot, "notifications.log");
  await copyFile(fixturePath, targetPath);

  const environment = {
    ...process.env,
    JSONCRACK_PLUGIN_ROOT: repositoryRoot,
    JSONCRACK_URL_LOG: urlLog,
    JSONCRACK_NOTIFICATION_LOG: notificationLog,
    JSONCRACK_CAPTURE_OPEN: "1",
  };
  const nvim = spawn(
    nvimBinary,
    [
      "--headless",
      "--noplugin",
      "-u",
      "NONE",
      "--listen",
      address,
      targetPath,
      "-c",
      "lua dofile([=[" + bridgeScript + "]=])",
    ],
    { env: environment, stdio: ["pipe", "ignore", "pipe"] },
  );
  const nvimPid = nvim.pid;
  if (!nvimPid) throw new Error("Neovim did not start");

  let stderr = "";
  nvim.stderr?.setEncoding("utf8");
  nvim.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_192);
  });
  const exited = new Promise<number>((resolveExit) => {
    nvim.once("exit", (code) => resolveExit(code ?? -1));
  });
  const waitForNvimExit = async (timeoutMs: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const knownServerPids = new Set<number>();
  let disposed = false;

  const rpc = async (expression: string, timeout = 4_000): Promise<string> => {
    const { stdout } = await execFileAsync(
      nvimBinary,
      ["--server", address, "--remote-expr", expression],
      { encoding: "utf8", timeout },
    );
    return stdout.trim();
  };
  const call = async (functionName: string, argument?: string): Promise<string> => {
    const expression = argument === undefined
      ? "luaeval('_G.JsonCrackBridge." + functionName + "()')"
      : "luaeval('_G.JsonCrackBridge." + functionName + "(_A)', " + vimString(argument) + ")";
    return rpc(expression);
  };
  const command = async (action: string): Promise<void> => {
    await call("command", action);
  };
  const readUrls = async (): Promise<string[]> => {
    try {
      return (await readFile(urlLog, "utf8")).split(/\r?\n/).filter(Boolean);
    } catch {
      return [];
    }
  };

  try {
    await waitFor("Neovim RPC socket", async () => {
      try {
        await stat(address);
        return true;
      } catch {
        return null;
      }
    });
    await waitFor("Neovim RPC readiness", async () => {
      try {
        return (await rpc("luaeval('1 + 1')", 1_000)) === "2" ? true : null;
      } catch {
        return null;
      }
    });
    await command("toggle");
    const url = await waitFor("captured vim.ui.open URL", async () => (await readUrls()).at(-1));
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") {
      throw new Error("Preview returned an unexpected URL: " + url);
    }
    const childPid = await waitFor("Python preview child", async () => await serverPid(nvimPid));
    knownServerPids.add(childPid);
    await waitFor("preview HTTP listener", async () => {
      try {
        const response = await fetch(new URL("/", url), { signal: AbortSignal.timeout(300) });
        return response.status === 200 ? true : null;
      } catch {
        return null;
      }
    });

    let stageCounter = 0;
    const preview: Preview = {
      url,
      targetPath,
      nvimPid,
      serverPid: childPid,
      port: Number(parsed.port),
      async save(text) {
        if (disposed) throw new Error("Preview has already been disposed");
        const stage = join(temporaryRoot, "save-" + (++stageCounter) + ".txt");
        await writeFile(stage, text, "utf8");
        const requestStartedAtEpochMs = performance.timeOrigin + performance.now();
        const requestStartedAtMonotonicNs = process.hrtime.bigint();
        const writeCompletedAtMonotonicNs = BigInt(await call("save", stage));
        const requestCompletedAtMonotonicNs = process.hrtime.bigint();
        const rpcAcknowledgedAtEpochMs = performance.timeOrigin + performance.now();
        if (
          writeCompletedAtMonotonicNs < requestStartedAtMonotonicNs ||
          writeCompletedAtMonotonicNs > requestCompletedAtMonotonicNs
        ) {
          throw new Error("Neovim write timestamp fell outside the measured RPC interval");
        }
        return {
          writeCompletedAtEpochMs: requestStartedAtEpochMs +
            Number(writeCompletedAtMonotonicNs - requestStartedAtMonotonicNs) / 1_000_000,
          rpcAcknowledgedAtEpochMs,
          rpcRoundTripMs: Number(requestCompletedAtMonotonicNs - requestStartedAtMonotonicNs) /
            1_000_000,
          writeToAcknowledgementMs: Number(requestCompletedAtMonotonicNs - writeCompletedAtMonotonicNs) /
            1_000_000,
        };
      },
      async open() {
        if (disposed) throw new Error("Preview has already been disposed");
        const previous = (await readUrls()).length;
        await command("open");
        return waitFor("reopened preview URL", async () => {
          const urls = await readUrls();
          return urls.length > previous ? urls.at(-1) : null;
        });
      },
      async stop() {
        if (!disposed) await command("stop");
      },
      async deleteTarget() {
        await unlink(targetPath);
      },
      async atomicReplace(text) {
        const replacement = join(temporaryRoot, "replacement-" + (++stageCounter) + ".tmp");
        await writeFile(replacement, text, "utf8");
        await rename(replacement, targetPath);
      },
      async ping() {
        return Number(await call("ping"));
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (nvim.exitCode === null && nvim.signalCode === null) {
          try {
            await execFileAsync(nvimBinary, ["--server", address, "--remote-send", ":JsonCrackPreviewStop<CR>"], {
              encoding: "utf8",
              timeout: 2_000,
            });
          } catch {
            // Continue with owned-process cleanup if Neovim already exited.
          }
          try {
            await execFileAsync(nvimBinary, ["--server", address, "--remote-send", ":qa!<CR>"], {
              encoding: "utf8",
              timeout: 2_000,
            });
          } catch {
            // A disappearing RPC socket means the parent is already stopping.
          }
          if (!(await waitForNvimExit(1_500))) {
            if (nvim.exitCode === null && nvim.signalCode === null) nvim.kill("SIGTERM");
            if (!(await waitForNvimExit(1_000))) {
              if (nvim.exitCode === null && nvim.signalCode === null) nvim.kill("SIGKILL");
              if (!(await waitForNvimExit(1_000))) {
                throw new Error("Owned Neovim process did not exit: " + nvimPid);
              }
            }
          }
        }
        try {
          for (const pid of knownServerPids) {
            await closeOwnedProcess(pid, join(repositoryRoot, "server/main.py"));
          }
        } finally {
          await rm(temporaryRoot, { recursive: true, force: true });
        }
      },
    };
    return preview;
  } catch (error) {
    if (nvim.exitCode === null && nvim.signalCode === null) nvim.kill("SIGTERM");
    if (!(await waitForNvimExit(1_000)) && nvim.exitCode === null && nvim.signalCode === null) {
      nvim.kill("SIGKILL");
      if (!(await waitForNvimExit(1_000))) {
        throw new Error("Owned Neovim process did not exit after failed setup: " + nvimPid);
      }
    }
    try {
      for (const child of await descendants(nvimPid)) {
        if (child.command.includes(join(repositoryRoot, "server/main.py"))) {
          await closeOwnedProcess(child.pid, join(repositoryRoot, "server/main.py"));
        }
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    throw new Error(String(error) + (stderr ? "\nNeovim stderr: " + stderr : ""));
  }
}

export async function fixturePayload(updated: string): Promise<string> {
  const source = await readFile(join(repositoryRoot, "tests/fixtures/preview.json"), "utf8");
  const fixture = JSON.parse(source) as { updated: string };
  fixture.updated = updated;
  return JSON.stringify(fixture);
}
