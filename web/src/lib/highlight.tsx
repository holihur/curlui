import type { ReactNode } from "react";

/**
 * A tiny, dependency-free JSON tokenizer that returns React nodes with
 * syntax-highlighting classes. Works on already-formatted (or raw) JSON text.
 */
export function highlightJSON(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const n = code.length;
  let i = 0;
  let key = 0;

  const push = (text: string, cls?: string) => {
    if (!text) return;
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        text
      ),
    );
  };

  while (i < n) {
    const c = code[i];

    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      const str = code.slice(i, j);
      let k = j;
      while (k < n && (code[k] === " " || code[k] === "\t" || code[k] === "\n" || code[k] === "\r")) k++;
      push(str, code[k] === ":" ? "tok-key" : "tok-string");
      i = j;
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(code[j])) j++;
      push(code.slice(i, j), "tok-number");
      i = j;
      continue;
    }

    const literal = /^(true|false|null)/.exec(code.slice(i, i + 5));
    if (literal && (c === "t" || c === "f" || c === "n")) {
      push(literal[0], "tok-bool");
      i += literal[0].length;
      continue;
    }

    if ("{}[],:".includes(c)) {
      push(c, "tok-punct");
      i++;
      continue;
    }

    // whitespace run
    let j = i + 1;
    while (j < n && (code[j] === " " || code[j] === "\n" || code[j] === "\t" || code[j] === "\r")) j++;
    push(code.slice(i, j));
    i = j;
  }

  return out;
}

/** Pretty-print JSON if possible; otherwise return the original text. */
export function tryPrettyJSON(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
}
