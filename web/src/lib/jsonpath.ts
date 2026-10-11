// Minimal JSONPath evaluator for the response viewer. Supports:
//   $            root
//   .key  ['key']  field access
//   [0]            array index
//   [*]            wildcard (array items / object values)
//   ..key          recursive descent
export type Token =
  | { type: "key"; key: string }
  | { type: "index"; index: number }
  | { type: "wild" }
  | { type: "recursive"; key: string };

export function tokenizeJSONPath(path: string): Token[] {
  const tokens: Token[] = [];
  let i = path.trim().startsWith("$") ? 1 : 0;
  const p = path.trim();
  while (i < p.length) {
    const ch = p[i];
    if (ch === ".") {
      if (p[i + 1] === ".") {
        i += 2;
        let key = "";
        while (i < p.length && /[^.[\]]/.test(p[i])) key += p[i++];
        if (key) tokens.push({ type: "recursive", key });
      } else {
        i++;
        let key = "";
        while (i < p.length && /[^.[\]]/.test(p[i])) key += p[i++];
        if (key) tokens.push({ type: "key", key });
      }
    } else if (ch === "[") {
      const end = p.indexOf("]", i);
      if (end < 0) break;
      const inner = p.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === "*") tokens.push({ type: "wild" });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: "index", index: Number(inner) });
      else tokens.push({ type: "key", key: inner.replace(/^['"]|['"]$/g, "") });
    } else {
      i++;
    }
  }
  return tokens;
}

function apply(node: unknown, tok: Token, out: unknown[]) {
  if (node == null) return;
  switch (tok.type) {
    case "key": {
      if (typeof node === "object" && !Array.isArray(node)) {
        const v = (node as Record<string, unknown>)[tok.key];
        if (v !== undefined) out.push(v);
      }
      break;
    }
    case "index": {
      if (Array.isArray(node) && tok.index >= 0 && tok.index < node.length) out.push(node[tok.index]);
      break;
    }
    case "wild": {
      if (Array.isArray(node)) out.push(...node);
      else if (typeof node === "object") out.push(...Object.values(node as Record<string, unknown>));
      break;
    }
    case "recursive": {
      const walk = (n: unknown) => {
        if (n == null) return;
        if (Array.isArray(n)) {
          n.forEach(walk);
          return;
        }
        if (typeof n === "object") {
          const obj = n as Record<string, unknown>;
          if (tok.key in obj) out.push(obj[tok.key]);
          Object.values(obj).forEach(walk);
        }
      };
      walk(node);
      break;
    }
  }
}

/** evaluateJSONPath returns every value matched by the path. */
export function evaluateJSONPath(root: unknown, path: string): unknown[] {
  const p = path.trim();
  if (!p || p === "$") return [root];
  let current: unknown[] = [root];
  for (const tok of tokenizeJSONPath(p)) {
    const next: unknown[] = [];
    for (const node of current) apply(node, tok, next);
    current = next;
  }
  return current;
}
