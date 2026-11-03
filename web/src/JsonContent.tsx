import type { ReactElement } from "react";

type TokenKind = "key" | "string" | "number" | "literal" | "plain";

type Token = {
  kind: TokenKind;
  text: string;
};

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  const add = (kind: TokenKind, end: number): void => {
    tokens.push({ kind, text: content.slice(position, end) });
    position = end;
  };

  while (position < content.length) {
    if (content[position] === '"') {
      let end = position + 1;
      while (end < content.length) {
        if (content[end] === "\\") {
          end += 2;
        } else if (content[end] === '"') {
          end += 1;
          break;
        } else {
          end += 1;
        }
      }

      let next = end;
      while (/\s/.test(content[next] ?? "")) next += 1;
      add(content[next] === ":" ? "key" : "string", end);
      continue;
    }

    const remaining = content.slice(position);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (number) {
      add("number", position + number[0].length);
      continue;
    }

    const literal = /^(?:true|false|null)\b/.exec(remaining);
    if (literal) {
      add("literal", position + literal[0].length);
      continue;
    }

    const plainStart = position;
    while (position < content.length) {
      const character = content[position];
      if (character === '"' || character === "-" || /\d/.test(character ?? "")) break;
      if (/^(?:true|false|null)\b/.test(content.slice(position))) break;
      position += 1;
    }
    if (position === plainStart) position += 1;
    tokens.push({ kind: "plain", text: content.slice(plainStart, position) });
  }

  return tokens;
}

export function JsonContent({ content }: { content: string }): ReactElement {
  return (
    <>
      {tokenize(content).map((token, index) => (
        <span key={index} className={`json-token json-token-${token.kind}`}>
          {token.text}
        </span>
      ))}
    </>
  );
}
