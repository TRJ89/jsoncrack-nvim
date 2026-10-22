import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const reaflowDist = resolve(webRoot, "node_modules/reaflow/dist/index.js");
const reaflowPackage = JSON.parse(
  readFileSync(resolve(webRoot, "node_modules/reaflow/package.json"), "utf8"),
) as { version?: string };

const REAFLOW_VERSION = "5.4.1";
const WORKER_DATA_URL =
  /new URL\("data:application\/javascript;base64,([A-Za-z0-9+/]+={0,2})", self\.location\)/g;
const MODIFIED_WORKER_NOTICE =
  "/* Derived from Reaflow 5.4.1 dist/index.js; embedded bytes match elkjs@0.10.0/lib/elk-worker.min.js (Git blob SHA-1 aefee8891cabdaf247410197304c1e4bee3cdb14). Reaflow: Apache-2.0; embedded worker: EPL-2.0. See dist/THIRD-PARTY-NOTICES.md for source availability and license texts. */";

function reaflowWorkerAsset() {
  if (reaflowPackage.version !== REAFLOW_VERSION) {
    throw new Error(
      `Expected Reaflow ${REAFLOW_VERSION} for the verified worker adapter; found ${reaflowPackage.version ?? "unknown"}.`,
    );
  }

  let transformed = false;

  return {
    name: "jsoncrack-reaflow-worker-asset",
    apply: "build" as const,
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (id.split("?", 1)[0] !== reaflowDist) return null;

      if (transformed) {
        throw new Error("Reaflow's pinned renderer module was transformed more than once.");
      }
      transformed = true;

      const matches = [...source.matchAll(WORKER_DATA_URL)];
      if (matches.length !== 1 || matches[0]?.[1] === undefined) {
        throw new Error(
          `Expected exactly one embedded Reaflow ${REAFLOW_VERSION} ELK worker URL; found ${matches.length}.`,
        );
      }

      const encodedWorker = matches[0][1];
      const workerBytes = Buffer.from(encodedWorker, "base64");
      if (workerBytes.toString("base64") !== encodedWorker) {
        throw new Error("Reaflow's embedded ELK worker is not valid base64.");
      }
      const workerSource = workerBytes.toString("utf8");
      if (!workerSource.startsWith("'use strict';") || !workerSource.includes("gwtOnLoad(null, 'elk', null);")) {
        throw new Error("Reaflow's embedded ELK worker does not match the verified payload shape.");
      }

      const assetReference = this.emitFile({
        type: "asset",
        name: "reaflow-elk-worker.js",
        source: `${MODIFIED_WORKER_NOTICE}\n${workerSource}`,
      });
      const replacement = `new URL(import.meta.ROLLUP_FILE_URL_${assetReference}, import.meta.url)`;
      const start = matches[0].index;
      if (start === undefined) throw new Error("Unable to locate Reaflow's worker URL in its module.");
      const end = start + matches[0][0].length;
      return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
    },
    generateBundle() {
      if (!transformed) {
        throw new Error("The pinned Reaflow module was not adapted; refusing to build without its worker asset.");
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const rendererTest = mode === "renderer-test";
  const root = rendererTest ? resolve(webRoot, "tests/renderer") : webRoot;

  return {
    root,
    base: "/",
    publicDir: false,
    plugins: [reaflowWorkerAsset(), react()],
    build: {
      outDir: rendererTest ? resolve(webRoot, ".renderer-dist") : resolve(webRoot, "../dist"),
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
