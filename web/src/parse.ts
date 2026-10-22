import { parseTree } from "jsonc-parser";
import type { Node as JsonNode, ParseError as JsoncParseError } from "jsonc-parser";
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
} from "yaml";
import type { Node as YamlNode } from "yaml";
import type { Format, ParseError, ParseResult } from "./types";

const MAX_INPUT_BYTES = 1_048_576;
const MAX_DEPTH = 100;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type ValueResult = { ok: true; value: unknown } | { ok: false; error: ParseError };

function utf8ByteLengthExceedsLimit(text: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const end = Math.min(Math.max(offset, 0), text.length);
  let line = 1;
  let column = 1;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function failure(
  code: string,
  message: string,
  text?: string,
  offset?: number,
): ValueResult {
  const error: ParseError = { code, message };
  if (text !== undefined && offset !== undefined) {
    const position = positionAt(text, offset);
    error.line = position.line;
    error.column = position.column;
  }
  return { ok: false, error };
}

function resultFailure(error: ParseError): ParseResult {
  return { ok: false, error };
}

function finish(value: unknown): ParseResult {
  const json = JSON.stringify(value);
  if (json === undefined) {
    return { ok: false, error: { code: "INVALID_VALUE", message: "The input is not JSON-compatible." } };
  }
  return { ok: true, json };
}

/**
 * Returns true only when the decimal token denotes an exact integer outside
 * JavaScript's safe integer range. This inspects the source spelling instead
 * of relying on the rounded Number held by a parser node.
 */
function isUnsafeDecimalInteger(token: string): boolean {
  const normalized = token.replaceAll("_", "");
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(normalized);
  if (!match) return false;

  const fraction = match[3] ?? "";
  const significantDigits = `${match[2]}${fraction}`.replace(/^0+/, "");
  if (significantDigits.length === 0) return false;

  const exponentText = match[4] ?? "0";
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) {
    // A huge negative exponent cannot produce a non-zero integer with this
    // finite-length coefficient. A huge positive exponent is unsafe whenever
    // the parsed number is finite (overflow is checked before this function).
    return !exponentText.startsWith("-");
  }

  const scale = exponent - fraction.length;
  if (scale >= 0) {
    const integerDigits = significantDigits.length + scale;
    if (integerDigits > 16) return true;
    if (integerDigits < 16) return false;
    return BigInt(`${significantDigits}${"0".repeat(scale)}`) > MAX_SAFE_BIGINT;
  }

  const digitsToRemove = -scale;
  if (!Number.isSafeInteger(digitsToRemove) || digitsToRemove > significantDigits.length) {
    return false;
  }
  if (digitsToRemove > 0 && !significantDigits.endsWith("0".repeat(digitsToRemove))) {
    return false;
  }

  const integerDigits = significantDigits.slice(0, significantDigits.length - digitsToRemove) || "0";
  if (integerDigits.length > 16) return true;
  return BigInt(integerDigits) > MAX_SAFE_BIGINT;
}

function jsonSyntaxFailure(text: string, error: JsoncParseError): ParseError {
  const position = positionAt(text, error.offset);
  return {
    code: "INVALID_JSON",
    message: "Invalid JSON syntax.",
    line: position.line,
    column: position.column,
  };
}

function validateJsonNode(node: JsonNode, depth: number, text: string): ValueResult {
  if (node.type === "object") {
    const currentDepth = depth + 1;
    if (currentDepth > MAX_DEPTH) {
      return failure("DEPTH_EXCEEDED", "Maximum nesting depth is 100.", text, node.offset);
    }

    const output = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    for (const property of node.children ?? []) {
      const children = property.children;
      const keyNode = children?.[0];
      const valueNode = children?.[1];
      if (property.type !== "property" || !keyNode || !valueNode || typeof keyNode.value !== "string") {
        return failure("INVALID_JSON", "Invalid JSON object property.", text, property.offset);
      }

      const key = keyNode.value;
      if (keys.has(key)) {
        return failure("DUPLICATE_KEY", `Duplicate object key: ${key}.`, text, keyNode.offset);
      }
      keys.add(key);

      const value = validateJsonNode(valueNode, currentDepth, text);
      if (!value.ok) return value;
      Object.defineProperty(output, key, {
        value: value.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: output };
  }

  if (node.type === "array") {
    const currentDepth = depth + 1;
    if (currentDepth > MAX_DEPTH) {
      return failure("DEPTH_EXCEEDED", "Maximum nesting depth is 100.", text, node.offset);
    }
    const output: unknown[] = [];
    for (const child of node.children ?? []) {
      const value = validateJsonNode(child, currentDepth, text);
      if (!value.ok) return value;
      output.push(value.value);
    }
    return { ok: true, value: output };
  }

  if (node.type === "number") {
    const value = node.value as number;
    if (!Number.isFinite(value)) {
      return failure("NON_FINITE_NUMBER", "Number is outside JavaScript's finite range.", text, node.offset);
    }
    const token = text.slice(node.offset, node.offset + node.length);
    if (isUnsafeDecimalInteger(token)) {
      return failure(
        "UNSAFE_INTEGER",
        "Integer is outside JavaScript's safe range; encode it as a string.",
        text,
        node.offset,
      );
    }
    return { ok: true, value };
  }

  if (node.type === "string" || node.type === "boolean" || node.type === "null") {
    return { ok: true, value: node.value ?? null };
  }

  return failure("INVALID_JSON", "Invalid JSON value.", text, node.offset);
}

function parseJson(text: string): ParseResult {
  const errors: JsoncParseError[] = [];
  let root: JsonNode | undefined;
  try {
    root = parseTree(text, errors, {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    });
  } catch {
    return resultFailure({ code: "INVALID_JSON", message: "JSON parser could not process this input." });
  }

  if (errors.length > 0) return resultFailure(jsonSyntaxFailure(text, errors[0]));
  if (!root) {
    return resultFailure({ code: "EMPTY_JSON_INPUT", message: "JSON input is empty." });
  }

  const value = validateJsonNode(root, 0, text);
  return value.ok ? finish(value.value) : resultFailure(value.error);
}

function yamlPosition(
  text: string,
  lineCounter: LineCounter,
  offset: number | undefined,
): { line: number; column: number } | undefined {
  if (offset === undefined || offset < 0) return undefined;
  const position = lineCounter.linePos(Math.min(offset, text.length));
  if (position.line > 0) return { line: position.line, column: position.col };
  return positionAt(text, offset);
}

function yamlFailure(
  code: string,
  message: string,
  text: string,
  lineCounter: LineCounter,
  offset?: number,
): { ok: false; error: ParseError } {
  const error: ParseError = { code, message };
  const position = yamlPosition(text, lineCounter, offset);
  if (position) {
    error.line = position.line;
    error.column = position.column;
  }
  return { ok: false, error };
}

function yamlNodeOffset(node: YamlNode | null | undefined): number | undefined {
  return node?.range?.[0];
}

function validateYamlNode(
  node: YamlNode | null,
  depth: number,
  text: string,
  lineCounter: LineCounter,
): ValueResult {
  if (node === null) return { ok: true, value: null };

  const offset = yamlNodeOffset(node);
  if (isAlias(node)) {
    return yamlFailure("YAML_ALIAS_UNSUPPORTED", "YAML aliases are not supported.", text, lineCounter, offset);
  }

  if (node.tag !== undefined) {
    return yamlFailure("YAML_TAG_UNSUPPORTED", "Explicit YAML tags are not supported.", text, lineCounter, offset);
  }

  if ("anchor" in node && node.anchor !== undefined) {
    return yamlFailure("YAML_ANCHOR_UNSUPPORTED", "YAML anchors are not supported.", text, lineCounter, offset);
  }

  if (isMap(node)) {
    const currentDepth = depth + 1;
    if (currentDepth > MAX_DEPTH) {
      return yamlFailure("DEPTH_EXCEEDED", "Maximum nesting depth is 100.", text, lineCounter, offset);
    }

    const output = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    for (const pair of node.items) {
      const keyNode = pair.key as YamlNode | null;
      const keyOffset = yamlNodeOffset(keyNode);
      if (keyNode === null || isAlias(keyNode)) {
        return yamlFailure("YAML_NON_STRING_KEY", "YAML mapping keys must be strings.", text, lineCounter, keyOffset);
      }
      if (keyNode.tag !== undefined) {
        return yamlFailure("YAML_TAG_UNSUPPORTED", "Explicit YAML tags are not supported.", text, lineCounter, keyOffset);
      }
      if ("anchor" in keyNode && keyNode.anchor !== undefined) {
        return yamlFailure("YAML_ANCHOR_UNSUPPORTED", "YAML anchors are not supported.", text, lineCounter, keyOffset);
      }
      if (!isScalar(keyNode) || typeof keyNode.value !== "string") {
        return yamlFailure("YAML_NON_STRING_KEY", "YAML mapping keys must be strings.", text, lineCounter, keyOffset);
      }

      const key = keyNode.value;
      if (key === "<<") {
        return yamlFailure("YAML_MERGE_KEY_UNSUPPORTED", "The YAML merge key << is not supported.", text, lineCounter, keyOffset);
      }
      if (keys.has(key)) {
        return yamlFailure("DUPLICATE_KEY", `Duplicate YAML mapping key: ${key}.`, text, lineCounter, keyOffset);
      }
      keys.add(key);

      const value = validateYamlNode(pair.value as YamlNode | null, currentDepth, text, lineCounter);
      if (!value.ok) return value;
      Object.defineProperty(output, key, {
        value: value.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: output };
  }

  if (isSeq(node)) {
    const currentDepth = depth + 1;
    if (currentDepth > MAX_DEPTH) {
      return yamlFailure("DEPTH_EXCEEDED", "Maximum nesting depth is 100.", text, lineCounter, offset);
    }
    const output: unknown[] = [];
    for (const item of node.items) {
      const value = validateYamlNode(item as YamlNode | null, currentDepth, text, lineCounter);
      if (!value.ok) return value;
      output.push(value.value);
    }
    return { ok: true, value: output };
  }

  if (isScalar(node)) {
    const value: unknown = node.value;
    if (typeof value === "bigint") {
      if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
        return yamlFailure(
          "UNSAFE_INTEGER",
          "Integer is outside JavaScript's safe range; encode it as a string.",
          text,
          lineCounter,
          offset,
        );
      }
      return { ok: true, value: Number(value) };
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return yamlFailure("NON_FINITE_NUMBER", "YAML numbers must be finite.", text, lineCounter, offset);
      }
      const end = node.range?.[1];
      const token = end === undefined || offset === undefined ? "" : text.slice(offset, end);
      if (isUnsafeDecimalInteger(token)) {
        return yamlFailure(
          "UNSAFE_INTEGER",
          "Integer is outside JavaScript's safe range; encode it as a string.",
          text,
          lineCounter,
          offset,
        );
      }
      return { ok: true, value };
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return { ok: true, value };
    }
  }

  return yamlFailure("YAML_VALUE_UNSUPPORTED", "This YAML value cannot be represented as JSON.", text, lineCounter, offset);
}

function yamlErrorOffset(error: { pos?: [number, number] }): number | undefined {
  return error.pos?.[0];
}

function parseYaml(text: string): ParseResult {
  const lineCounter = new LineCounter();
  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(text, {
      version: "1.2",
      schema: "core",
      merge: false,
      intAsBigInt: true,
      uniqueKeys: false,
      prettyErrors: true,
      lineCounter,
      logLevel: "error",
    });
  } catch {
    return resultFailure({ code: "INVALID_YAML", message: "YAML parser could not process this input." });
  }

  if (documents.length > 1) {
    return resultFailure(
      yamlFailure(
        "MULTIPLE_DOCUMENTS",
        "Only one YAML document is supported.",
        text,
        lineCounter,
        documents[1]?.range?.[0],
      ).error,
    );
  }
  if (documents.length === 0) {
    return resultFailure(yamlFailure("EMPTY_DOCUMENT", "Empty YAML document.", text, lineCounter).error);
  }

  const document = documents[0];
  const version = document.directives?.yaml.version;
  if (version === "1.1") {
    return resultFailure(
      yamlFailure("YAML_1_1_UNSUPPORTED", "YAML 1.1 is not supported; use YAML 1.2.", text, lineCounter, document.range?.[0]).error,
    );
  }

  const customTagDirective = Object.keys(document.directives?.tags ?? {}).some((handle) => handle !== "!!");
  if (customTagDirective) {
    return resultFailure(
      yamlFailure("YAML_TAG_UNSUPPORTED", "Custom YAML tag directives are not supported.", text, lineCounter, document.range?.[0]).error,
    );
  }

  if (document.errors.length > 0) {
    const error = document.errors[0];
    return resultFailure(
      yamlFailure("INVALID_YAML", error.message, text, lineCounter, yamlErrorOffset(error)).error,
    );
  }
  if (document.warnings.length > 0) {
    const warning = document.warnings[0];
    return resultFailure(
      yamlFailure("YAML_WARNING", warning.message, text, lineCounter, yamlErrorOffset(warning)).error,
    );
  }
  if (document.contents === null) {
    return resultFailure(yamlFailure("EMPTY_DOCUMENT", "Empty YAML document.", text, lineCounter, document.range?.[0]).error);
  }

  const value = validateYamlNode(document.contents, 0, text, lineCounter);
  return value.ok ? finish(value.value) : resultFailure(value.error);
}

export function parseSource(text: string, format: Format): ParseResult {
  if (utf8ByteLengthExceedsLimit(text, MAX_INPUT_BYTES)) {
    return { ok: false, error: { code: "INPUT_TOO_LARGE", message: "Input exceeds the 1 MiB limit." } };
  }

  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  try {
    return format === "json" ? parseJson(source) : parseYaml(source);
  } catch {
    return {
      ok: false,
      error: {
        code: format === "json" ? "INVALID_JSON" : "INVALID_YAML",
        message: format === "json" ? "JSON parser could not process this input." : "YAML parser could not process this input.",
      },
    };
  }
}
