import { describe, expect, it } from "vitest";
import { parseSource } from "../src/parse";
import type { Format } from "../src/types";

function parsedValue(source: string, format: Format): unknown {
  const result = parseSource(source, format);
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return JSON.parse(result.json) as unknown;
}

function expectRejected(source: string, format: Format, code?: string): void {
  const result = parseSource(source, format);
  expect(result.ok).toBe(false);
  if (!result.ok && code) expect(result.error.code).toBe(code);
}

describe("parseSource JSON validation", () => {
  it.each([
    ["comments", "// comment\n{\"a\":1}"],
    ["trailing commas", "{\"a\":1,}"],
    ["multiple roots", "{} {}"],
    ["empty input", ""],
    ["duplicate keys", "{\"a\":1,\"a\":2}"],
    ["escaped duplicate keys", "{\"a\":1,\"\\u0061\":2}"],
  ])("rejects JSON with %s", (_name, source) => {
    expectRejected(source, "json");
  });

  it("normalizes every JSON root value and empty containers", () => {
    const cases: Array<[string, unknown]> = [
      ['{"items":[1,true,null,"text"]}', { items: [1, true, null, "text"] }],
      ["[]", []],
      ["{}", {}],
      ['"root string"', "root string"],
      ["-3.5", -3.5],
      ["true", true],
      ["null", null],
    ];

    for (const [source, expected] of cases) {
      expect(parsedValue(source, "json")).toEqual(expected);
    }
  });

  it("reports a source position for malformed JSON", () => {
    const result = parseSource('{\n  "value": }', "json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBe(2);
      expect(result.error.column).toBeGreaterThan(0);
    }
  });
});

describe("parseSource YAML 1.2 validation", () => {
  it("normalizes mappings, sequences, quoted and multiline strings, booleans, and null", () => {
    const source = [
      'name: "sample"',
      "enabled: true",
      "disabled: false",
      "empty: null",
      "tilde: ~",
      "answer: yes",
      "negative: no",
      "date: 2026-10-22",
      "quoted: 'yes'",
      "literal: |",
      "  first line",
      "  second line",
      "items:",
      "  - 1",
      "  - plain",
    ].join("\n");

    expect(parsedValue(source, "yaml")).toEqual({
      name: "sample",
      enabled: true,
      disabled: false,
      empty: null,
      tilde: null,
      answer: "yes",
      negative: "no",
      date: "2026-10-22",
      quoted: "yes",
      literal: "first line\nsecond line\n",
      items: [1, "plain"],
    });
  });

  it.each([
    ["empty input", "", "EMPTY_DOCUMENT"],
    ["comment-only input", "# only a comment\n", "EMPTY_DOCUMENT"],
  ])("distinguishes %s from explicit null", (_name, source, code) => {
    expectRejected(source, "yaml", code);
  });

  it.each([["null", null], ["~", null]])("accepts explicit YAML null %s", (source, expected) => {
    expect(parsedValue(source, "yaml")).toBe(expected);
  });

  it.each([
    ["multiple documents", "---\na\n---\nb"],
    ["YAML 1.1 directive", "%YAML 1.1\n---\nno"],
    ["standard explicit tag", "!!str value"],
    ["custom explicit tag", "!custom value"],
    ["anchor", "value: &saved text"],
    ["alias", "value: &saved text\ncopy: *saved"],
    ["non-string mapping key", "true: value"],
    ["duplicate keys", "value: 1\nvalue: 2"],
    ["merge key", "<<: { inherited: true }"],
    ["quoted merge key", '"<<": value'],
  ])("rejects YAML with %s", (_name, source) => {
    expectRejected(source, "yaml");
  });

  it("reports a source position for malformed YAML", () => {
    const result = parseSource("items:\n  - [1,\n", "yaml");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBeGreaterThan(0);
      expect(result.error.column).toBeGreaterThan(0);
    }
  });
});

describe("numeric safety and depth limits", () => {
  const formats: Format[] = ["json", "yaml"];

  it.each(formats)("accepts exact safe integer spellings in %s", (format) => {
    for (const source of [
      "9007199254740991",
      "-9007199254740991",
      "9007199254740991.0",
      "90071992547409910e-1",
    ]) {
      expect(parsedValue(source, format)).toBe(Number(source));
    }
  });

  it.each(formats)("rejects unsafe integer values before rounding in %s", (format) => {
    for (const source of [
      "9007199254740992",
      "-9007199254740992",
      "9007199254740992.0",
      "90071992547409920e-1",
    ]) {
      expectRejected(source, format);
    }
  });

  it.each(formats)("rejects numeric overflow in %s", (format) => {
    expectRejected("1e400", format);
    expectRejected("1e999999999999999999999999999999", format);
  });

  it.each([".inf", "-.inf", ".nan"])("rejects YAML non-finite number %s", (source) => {
    expectRejected(source, "yaml");
  });

  it.each(formats)("allows depth 100 and rejects depth 101 in %s", (format) => {
    const atLimit = `${"[".repeat(100)}0${"]".repeat(100)}`;
    const overLimit = `${"[".repeat(101)}0${"]".repeat(101)}`;
    expect(parsedValue(atLimit, format)).toBeDefined();
    expectRejected(overLimit, format);
  });

  it("counts scalar roots as depth zero", () => {
    expect(parsedValue('"scalar"', "json")).toBe("scalar");
    expect(parsedValue("scalar", "yaml")).toBe("scalar");
  });
});

describe("safe data normalization", () => {
  it.each<Format>(["json", "yaml"])("preserves prototype-sensitive names as data in %s", (format) => {
    const source = format === "json"
      ? '{"__proto__":{"polluted":true},"constructor":"kept"}'
      : '"__proto__":\n  polluted: true\nconstructor: kept';
    const value = parsedValue(source, format) as Record<string, unknown>;

    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(value["__proto__"]).toEqual({ polluted: true });
    expect(value.constructor).toBe("kept");
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it.each<Format>(["json", "yaml"])("keeps HTML-like content as a string in %s", (format) => {
    const source = format === "json" ? '"<script>alert(1)</script>"' : '"<script>alert(1)</script>"';
    expect(parsedValue(source, format)).toBe("<script>alert(1)</script>");
  });

  it.each<Format>(["json", "yaml"])("strips one UTF-8 BOM before parsing %s", (format) => {
    const source = format === "json" ? '\uFEFF{"ok":true}' : "\uFEFFok: true";
    expect(parsedValue(source, format)).toEqual(format === "json" ? { ok: true } : { ok: true });
  });

  it("rejects inputs larger than one MiB", () => {
    expectRejected(`"${"x".repeat(1_048_575)}"`, "json", "INPUT_TOO_LARGE");
  });
});
