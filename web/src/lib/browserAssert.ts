import type { ApiResponse, Assertion, AssertionResult } from "./types";

function getPath(root: unknown, path: string): { ok: boolean; value?: unknown } {
  const cleaned = path.trim().replace(/^\$/, "").replace(/^\./, "");
  if (!cleaned) return { ok: true, value: root };
  const segments = cleaned.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur == null) return { ok: false };
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { ok: false };
      cur = cur[i];
    } else if (typeof cur === "object") {
      if (!(seg in (cur as Record<string, unknown>))) return { ok: false };
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return { ok: false };
    }
  }
  return { ok: true, value: cur };
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function cmpString(actual: string, op: string, expected: string): [boolean, string] {
  switch (op) {
    case "eq":
    case "equals":
    case "==":
      return [actual === expected, actual];
    case "ne":
    case "!=":
      return [actual !== expected, actual];
    case "contains":
      return [actual.includes(expected), actual];
    case "not_contains":
      return [!actual.includes(expected), actual];
    case "exists":
      return [actual !== "", actual];
    case "matches":
    case "regex":
      try {
        return [new RegExp(expected).test(actual), actual];
      } catch {
        return [false, "invalid regex"];
      }
    default:
      return [false, "unknown operator: " + op];
  }
}

function cmpNumber(actual: number, op: string, expected: string): [boolean, string] {
  const want = Number(expected);
  if (Number.isNaN(want)) return cmpString(String(actual), op, expected);
  switch (op) {
    case "eq":
    case "equals":
    case "==":
      return [actual === want, String(actual)];
    case "ne":
    case "!=":
      return [actual !== want, String(actual)];
    case "gt":
    case ">":
      return [actual > want, String(actual)];
    case "gte":
    case ">=":
      return [actual >= want, String(actual)];
    case "lt":
    case "<":
      return [actual < want, String(actual)];
    case "lte":
    case "<=":
      return [actual <= want, String(actual)];
    default:
      return cmpString(String(actual), op, expected);
  }
}

function headerValue(res: ApiResponse, name: string): string {
  for (const [k, values] of Object.entries(res.headers ?? {})) {
    if (k.toLowerCase() === name.toLowerCase() && values.length) return values[0];
  }
  return "";
}

/** Client-side assertion evaluation used by browser mode. */
export function evaluateAssertions(res: ApiResponse, rules: Assertion[]): AssertionResult[] {
  const out: AssertionResult[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const op = rule.operator.toLowerCase();
    let passed = false;
    let detail = "";
    try {
      if (rule.source === "status") {
        [passed, detail] = cmpNumber(res.status, op, rule.value);
      } else if (rule.source === "time") {
        [passed, detail] = cmpNumber(res.duration, op, rule.value);
      } else if (rule.source === "header") {
        [passed, detail] = cmpString(headerValue(res, rule.key), op, rule.value);
      } else if (rule.source === "body") {
        [passed, detail] = cmpString(res.body, op, rule.value);
      } else if (rule.source === "jsonpath") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(res.body);
        } catch {
          parsed = undefined;
        }
        const found = parsed === undefined ? { ok: false as const } : getPath(parsed, rule.key);
        if (!found.ok) {
          passed = false;
          detail = "path not found: " + rule.key;
        } else if (op === "exists") {
          passed = true;
          detail = stringify(found.value);
        } else {
          const asNumber = typeof found.value === "number" ? found.value : Number(stringify(found.value));
          const numericOp = ["gt", "gte", "lt", "lte", ">", ">=", "<", "<="].includes(op);
          if (numericOp && !Number.isNaN(asNumber)) {
            [passed, detail] = cmpNumber(asNumber, op, rule.value);
          } else {
            [passed, detail] = cmpString(stringify(found.value), op, rule.value);
          }
        }
      }
    } catch (err) {
      passed = false;
      detail = err instanceof Error ? err.message : String(err);
    }
    const label = `${rule.source}${rule.key ? " " + rule.key : ""} ${rule.operator} ${rule.value}`;
    out.push({ id: rule.id, passed, message: detail ? `${label}  (actual: ${detail})` : label });
  }
  return out;
}
