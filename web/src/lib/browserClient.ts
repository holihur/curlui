import type { ApiResponse, RequestDef } from "./types";

function dynamic(name: string): string | null {
  switch (name) {
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$uuid":
      return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    case "$randomInt":
      return String(Math.floor(Math.random() * 1000));
    default:
      return null;
  }
}

export function resolveVars(input: string, vars: Record<string, string>): string {
  if (!input || !input.includes("{{")) return input;
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim();
    if (name.startsWith("$")) {
      const d = dynamic(name);
      if (d !== null) return d;
    }
    return vars[name] ?? match;
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

function looksBinary(contentType: string, bytes: Uint8Array): boolean {
  const ct = contentType.toLowerCase();
  for (const t of ["image/", "audio/", "video/", "application/octet-stream", "application/pdf", "font/"]) {
    if (ct.includes(t)) return true;
  }
  const sample = bytes.subarray(0, 1024);
  for (const b of sample) if (b === 0) return true;
  return false;
}

function friendlyError(message: string): string {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Browser request failed — usually a CORS or network restriction. Switch this request to Server mode (Options → Send via → Server) to send it from Go instead.";
  }
  if (/aborted|timeout/i.test(message)) return "Browser request timed out";
  return message;
}

/**
 * Sends a request directly from the browser using fetch(). Variables are
 * resolved client-side. Hooks, assertions and parent requests only run in
 * Server mode.
 */
export async function browserSend(req: RequestDef, vars: Record<string, string>): Promise<ApiResponse> {
  const start = performance.now();
  const base: ApiResponse = {
    status: 0,
    statusText: "",
    headers: {},
    cookies: null,
    body: "",
    contentType: "",
    isBinary: false,
    size: 0,
    duration: 0,
    timing: { dns: 0, connect: 0, tls: 0, firstByte: 0, total: 0 },
    request: { method: req.method, url: req.url, headers: {}, body: "" },
  };

  let url = resolveVars(req.url.trim(), vars);
  if (url && !/^[a-z]+:\/\//i.test(url)) url = "http://" + url;
  if (!url) return { ...base, error: "URL is empty" };

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ...base, error: "invalid URL: " + url };
  }
  for (const p of req.params) {
    if (p.enabled && p.key) u.searchParams.append(resolveVars(p.key, vars), resolveVars(p.value, vars));
  }

  const headers = new Headers();
  for (const h of req.headers) {
    if (h.enabled && h.key) headers.set(resolveVars(h.key, vars), resolveVars(h.value, vars));
  }

  const auth = req.auth;
  if (auth.type === "basic") {
    const user = resolveVars(auth.username ?? "", vars);
    const pass = resolveVars(auth.password ?? "", vars);
    headers.set("Authorization", "Basic " + btoa(`${user}:${pass}`));
  } else if (auth.type === "bearer") {
    headers.set("Authorization", "Bearer " + resolveVars(auth.token ?? "", vars));
  } else if (auth.type === "apikey" && auth.key) {
    const k = resolveVars(auth.key, vars);
    const v = resolveVars(auth.value ?? "", vars);
    if (auth.addTo === "query") u.searchParams.set(k, v);
    else headers.set(k, v);
  }

  const type = req.body.type;
  let body: BodyInit | undefined;
  if (type === "json" || type === "xml" || type === "html" || type === "text") {
    body = resolveVars(req.body.raw, vars);
    if (!headers.has("Content-Type")) {
      headers.set(
        "Content-Type",
        { json: "application/json", xml: "application/xml", html: "text/html", text: "text/plain" }[type],
      );
    }
  } else if (type === "graphql") {
    let variables: unknown;
    if ((req.body.variables ?? "").trim()) {
      try {
        variables = JSON.parse(resolveVars(req.body.variables ?? "", vars));
      } catch {
        return { ...base, error: "GraphQL variables is not valid JSON." };
      }
    }
    body = JSON.stringify({
      query: resolveVars(req.body.query ?? "", vars),
      variables,
      ...((req.body.operationName ?? "").trim() ? { operationName: req.body.operationName } : {}),
    });
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  } else if (type === "form-urlencoded") {
    const f = new URLSearchParams();
    for (const kv of req.body.form) if (kv.enabled && kv.key) f.append(resolveVars(kv.key, vars), resolveVars(kv.value, vars));
    body = f;
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/x-www-form-urlencoded");
  } else if (type === "form-data") {
    const f = new FormData();
    for (const kv of req.body.form) if (kv.enabled && kv.key) f.append(resolveVars(kv.key, vars), resolveVars(kv.value, vars));
    body = f;
  } else if (type === "binary") {
    return { ...base, error: "Binary bodies are only supported in Server mode (the file lives on the server)." };
  }

  const controller = new AbortController();
  const timeout = req.options.timeout || 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(u.toString(), {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      redirect: req.options.followRedirects ? "follow" : "manual",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "";
    const isBinary = looksBinary(ct, bytes);
    const text = isBinary ? `[binary content: ${bytes.length} bytes]` : new TextDecoder().decode(bytes);
    const outHeaders: Record<string, string[]> = {};
    res.headers.forEach((value, key) => {
      (outHeaders[key] ??= []).push(value);
    });
    const total = Math.round(performance.now() - start);
    const reqHeaders: Record<string, string[]> = {};
    headers.forEach((value, key) => {
      reqHeaders[key] = [value];
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
      cookies: null,
      body: text,
      bodyBase64: isBinary ? bytesToBase64(bytes) : undefined,
      contentType: ct,
      isBinary,
      size: bytes.length,
      duration: total,
      timing: { dns: 0, connect: 0, tls: 0, firstByte: total, total },
      request: {
        method: req.method,
        url: u.toString(),
        headers: reqHeaders,
        body: typeof body === "string" ? body : "",
      },
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    const total = Math.round(performance.now() - start);
    return {
      ...base,
      duration: total,
      request: { method: req.method, url: u.toString(), headers: {}, body: "" },
      error: friendlyError(message),
    };
  }
}
