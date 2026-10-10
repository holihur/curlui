import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function prettyJSON(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
}

/** Returns a human-readable JSON syntax error, or null when the text is valid
 *  (an empty string counts as valid). */
export function jsonError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function statusColor(status: number): string {  if (status === 0) return "text-muted-foreground";
  if (status < 200) return "text-sky-400";
  if (status < 300) return "text-emerald-400";
  if (status < 400) return "text-amber-400";
  if (status < 500) return "text-orange-400";
  return "text-red-400";
}

const SHORT_METHODS: Record<string, string> = {
  OPTIONS: "OPT",
  DELETE: "DEL",
  PATCH: "PATCH",
};

/** Compact HTTP method label for tight spots (keeps GET/POST/PUT as-is). */
export function shortMethod(method: string): string {
  const m = (method || "GET").toUpperCase();
  return SHORT_METHODS[m] ?? m;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Triggers a browser download from a URL (used for exports). */
export function downloadURL(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
