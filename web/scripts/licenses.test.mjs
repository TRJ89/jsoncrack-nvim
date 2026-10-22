import assert from "node:assert/strict";
import test from "node:test";
import { collectRuntimePackagePaths } from "./licenses.mjs";

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
