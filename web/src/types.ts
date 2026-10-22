export type Format = "json" | "yaml";

export type ParseError = {
  code: string;
  message: string;
  line?: number;
  column?: number;
};

export type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: ParseError };

export type Snapshot = {
  protocol: 1;
  revision: string;
  format: Format;
  display_name: string;
} & (
  | { status: "ok"; text: string }
  | { status: "error"; error: { code: string; message: string } }
);
