import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRuntimePackagePaths, generateNotices } from "./licenses.mjs";

test("runtime closure follows lockfile dependencies and resolves nested production copies", () => {
  const lock = {
    packages: {
      "": {
        dependencies: { app: "1.0.0", shared: "1.0.0" },
        devDependencies: { testTool: "1.0.0" },
      },
      "node_modules/app": {
        version: "1.0.0",
        dependencies: { core: "1.x" },
        optionalDependencies: { platformAddon: "1.x", absentPlatformAddon: "1.x" },
      },
      "node_modules/app/node_modules/core": {
        version: "1.0.0",
        dependencies: { shared: "2.x" },
      },
      "node_modules/app/node_modules/core/node_modules/shared": { version: "2.0.0" },
      "node_modules/app/node_modules/platformAddon": { version: "1.0.0" },
      "node_modules/shared": { version: "1.0.0" },
      "node_modules/testTool": { version: "1.0.0", dev: true, dependencies: { hidden: "1.x" } },
      "node_modules/hidden": { version: "1.0.0" },
    },
  };

  assert.deepEqual(collectRuntimePackagePaths(lock), [
    "node_modules/app",
    "node_modules/app/node_modules/core",
    "node_modules/app/node_modules/core/node_modules/shared",
    "node_modules/app/node_modules/platformAddon",
    "node_modules/shared",
  ]);
});

test("runtime closure fails when a required lockfile dependency cannot be resolved", () => {
  assert.throws(
    () =>
      collectRuntimePackagePaths({
        packages: {
          "": { dependencies: { app: "1.0.0" } },
          "node_modules/app": { version: "1.0.0", dependencies: { missing: "1.x" } },
        },
      }),
    /required runtime dependency missing from node_modules\/app is absent from the lockfile/,
  );
});

test("generated notices identify the embedded worker source as available under EPL-2.0", async (t) => {
  const distributionDirectory = await mkdtemp(join(tmpdir(), "jsoncrack-license-notices-"));
  t.after(() => rm(distributionDirectory, { recursive: true, force: true }));

  const assetsDirectory = new URL("../../dist/assets/", import.meta.url);
  const workerAssets = (await readdir(assetsDirectory)).filter((name) =>
    name.startsWith("reaflow-elk-worker-"),
  );
  assert.equal(workerAssets.length, 1);
  await mkdir(join(distributionDirectory, "assets"), { recursive: true });
  await copyFile(
    new URL(`../../dist/assets/${workerAssets[0]}`, import.meta.url),
    join(distributionDirectory, "assets", workerAssets[0]),
  );

  await generateNotices({ distributionDirectory });
  const notices = await readFile(join(distributionDirectory, "THIRD-PARTY-NOTICES.md"), "utf8");

  assert.match(
    notices,
    /The source code for the embedded worker is available under EPL-2\.0 in the pinned \[elkjs 0\.10\.0 source archive\]\(https:\/\/github\.com\/kieler\/elkjs\/archive\/refs\/tags\/0\.10\.0\.tar\.gz\)/,
  );
  assert.ok(notices.includes("[Eclipse ELK 0.10.0 source archive](https://github.com/eclipse-elk/elk/archive/refs/tags/v0.10.0.tar.gz)"));
});
