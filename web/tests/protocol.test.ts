import { describe, expect, it } from "vitest";
import { decodeSnapshot } from "../src/poll";
import type { Snapshot } from "../src/types";

const fixtures = import.meta.glob("../../tests/fixtures/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const okFixture = fixtures["../../tests/fixtures/snapshot-ok.json"];
const errorFixture = fixtures["../../tests/fixtures/snapshot-error.json"];

describe("snapshot wire protocol", () => {
  it("accepts the shared successful and input-error fixtures", () => {
    expect(decodeSnapshot(okFixture)).toMatchObject({
      protocol: 1,
      revision: "fixture-revision-ok",
      format: "json",
      display_name: "snapshot-ok.json",
      status: "ok",
      text: '{"name":"example"}\n',
    });
    expect(decodeSnapshot(errorFixture)).toMatchObject({
      protocol: 1,
      revision: "fixture-revision-error",
      format: "yaml",
      display_name: "snapshot-error.yaml",
      status: "error",
      error: { code: "FILE_UNAVAILABLE" },
    });
  });

  it("rejects protocol mismatches and missing or incorrectly typed fields", () => {
    const valid = decodeSnapshot(okFixture) as Snapshot;
    expect(decodeSnapshot({ ...valid, protocol: 2 })).toBeNull();
    expect(decodeSnapshot({ ...valid, display_name: 42 })).toBeNull();
    expect(decodeSnapshot({ ...valid, status: "error", error: { code: "OOPS" } })).toBeNull();
    expect(decodeSnapshot(null)).toBeNull();
  });
});
