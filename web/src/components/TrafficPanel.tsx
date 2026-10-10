import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatMs, shortMethod, statusColor, uid } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import { blankRequest, type CaptureEntry, type RequestDef } from "@/lib/types";

function captureToRequest(c: CaptureEntry): RequestDef {
  const req = blankRequest();
  req.name = `${c.method} ${c.url}`;
  req.method = c.method;
  req.url = c.url;
  req.headers = Object.entries(c.requestHeaders).flatMap(([k, values]) =>
    values.map((v) => ({ id: uid(), key: k, value: v, enabled: true })),
  );
  if (c.requestBody) {
    const ct =
      (Object.entries(c.requestHeaders).find(([k]) => k.toLowerCase() === "content-type")?.[1][0] ?? "").toLowerCase();
    req.body.type = ct.includes("json") ? "json" : ct.includes("xml") ? "xml" : "text";
    req.body.raw = c.requestBody;
  }
  return req;
}

export function TrafficPanel() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const openRequest = useStore((s) => s.openRequest);

  const [running, setRunning] = useState(false);
  const [addr, setAddr] = useState("");
  const [entries, setEntries] = useState<CaptureEntry[]>([]);
  const [selected, setSelected] = useState<CaptureEntry | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.listProxy();
      setRunning(d.running);
      setAddr(d.addr);
      setEntries(d.entries ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              running ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
            )}
          >
            {running ? `${t("proxyRunning")} ${addr}` : t("proxyOff")}
          </span>
          <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={async () => {
              await api.clearProxy();
              setSelected(null);
              void refresh();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {!running && <div className="mt-1.5 text-[11px] text-muted-foreground">{t("proxyHint")}</div>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {entries.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("noCaptures")}</div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            onClick={() => setSelected(e)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sidebar-accent/70",
              selected?.id === e.id && "bg-sidebar-accent",
            )}
          >
            <span title={e.method} className={cn("shrink-0 text-[10px] font-semibold", `method-${e.method}`)}>
              {shortMethod(e.method)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs" title={e.url}>
              {e.url}
            </span>
            {e.tunnel ? (
              <span className="shrink-0 text-[10px] text-muted-foreground">{t("tunnel")}</span>
            ) : (
              <span className={cn("shrink-0 text-[10px]", statusColor(e.status))}>{e.status || "—"}</span>
            )}
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatMs(e.duration)}</span>
          </div>
        ))}
      </div>

      {selected && (
        <div className="flex min-h-0 flex-col border-t" style={{ maxHeight: "58%" }}>
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs" title={selected.url}>
              {selected.method} {selected.url}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1"
              onClick={() => openRequest(captureToRequest(selected))}
              title={t("openInEditor")}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {t("openInEditor")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1"
              onClick={async () => {
                try {
                  const ne = await api.replayProxy(selected.id);
                  setSelected(ne);
                  await refresh();
                  toast({ title: t("replay"), variant: "success" });
                } catch (err) {
                  toast({
                    title: t("requestFailed"),
                    description: err instanceof Error ? err.message : String(err),
                    variant: "error",
                  });
                }
              }}
              title={t("replay")}
            >
              <Play className="h-3.5 w-3.5" />
              {t("replay")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 text-[11px]">
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t("respRequest")}</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono">
                {selected.requestBody || "(empty)"}
              </pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t("respBody")}</div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-2 font-mono">
                {selected.responseBody || "(empty)"}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
