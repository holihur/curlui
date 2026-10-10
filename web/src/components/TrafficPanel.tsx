import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Download,
  FolderTree,
  List,
  PauseCircle,
  Play,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn, downloadURL, formatMs, shortMethod, statusColor, uid } from "@/lib/utils";
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

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function TrafficPanel() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const openRequest = useStore((s) => s.openRequest);
  const refreshCollections = useStore((s) => s.refreshCollections);

  const [running, setRunning] = useState(false);
  const [addr, setAddr] = useState("");
  const [capture, setCapture] = useState(true);
  const [ttl, setTtl] = useState(0);
  const [filter, setFilter] = useState("");
  const [breakOn, setBreakOn] = useState(false);
  const [breakFilter, setBreakFilter] = useState("");
  const [breakResp, setBreakResp] = useState(false);
  const [breakRespFilter, setBreakRespFilter] = useState("");
  const [view, setView] = useState<"list" | "tree">("list");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<CaptureEntry[]>([]);
  const [selected, setSelected] = useState<CaptureEntry | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inited = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const d = await api.listProxy();
      setRunning(d.running);
      setAddr(d.addr);
      setEntries(d.entries ?? []);
      if (!inited.current) {
        setCapture(d.capture ?? true);
        setTtl(d.ttlSeconds ?? 0);
        setFilter(d.filter ?? "");
        setBreakOn(d.break ?? false);
        setBreakFilter(d.breakFilter ?? "");
        setBreakResp(d.breakResponse ?? false);
        setBreakRespFilter(d.breakResponseFilter ?? "");
        inited.current = true;
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const saveConfig = (
    patch: Partial<{
      capture: boolean;
      ttlSeconds: number;
      filter: string;
      break: boolean;
      breakFilter: string;
      breakResponse: boolean;
      breakResponseFilter: string;
    }>,
  ) =>
    void api.proxyConfig({
      capture,
      ttlSeconds: ttl,
      filter,
      break: breakOn,
      breakFilter,
      breakResponse: breakResp,
      breakResponseFilter: breakRespFilter,
      ...patch,
    });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q) ||
            String(e.status).includes(q) ||
            e.requestBody.toLowerCase().includes(q) ||
            e.responseBody.toLowerCase().includes(q),
        )
      : entries;
    return list;
  }, [entries, search]);

  const groups = useMemo(() => {
    const map = new Map<string, CaptureEntry[]>();
    for (const e of shown) {
      const host = hostOf(e.url);
      const arr = map.get(host);
      if (arr) arr.push(e);
      else map.set(host, [e]);
    }
    return [...map.entries()];
  }, [shown]);

  const saveCaptures = async (ids: string[]) => {
    try {
      const { count } = await api.saveCaptures(ids);
      await refreshCollections();
      toast({ title: t("savedCaptures", { n: count }), variant: "success" });
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  const row = (e: CaptureEntry, indent = false) => (
    <div
      key={e.id}
      onClick={() => setSelected(e)}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-sidebar-accent/70",
        indent ? "pl-6" : "pl-2",
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
  );

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

        {running && (
          <>
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <Switch
                checked={capture}
                onCheckedChange={(v) => {
                  setCapture(v);
                  saveConfig({ capture: v });
                }}
              />
              <span className="text-muted-foreground">{capture ? t("captureOn") : t("captureOff")}</span>
              <span className="ml-auto text-muted-foreground">{t("ttl")}</span>
              <Input
                type="number"
                min={0}
                value={ttl}
                title={t("ttlHint")}
                onChange={(e) => setTtl(Number(e.target.value) || 0)}
                onBlur={() => saveConfig({ ttlSeconds: ttl })}
                className="h-7 w-16 text-xs"
              />
            </div>
            <Textarea
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onBlur={() => saveConfig({})}
              placeholder={t("captureFilterHint")}
              title={t("captureFilter")}
              className="mt-2 min-h-[38px] font-mono text-[11px]"
              spellCheck={false}
            />

            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <Switch
                checked={breakOn}
                onCheckedChange={(v) => {
                  setBreakOn(v);
                  saveConfig({ break: v });
                }}
              />
              <span className={breakOn ? "text-amber-400" : "text-muted-foreground"}>
                <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
                {t("breakpoints")}: {breakOn ? t("breakOn") : t("breakOff")}
              </span>
            </div>
            {breakOn && (
              <Textarea
                value={breakFilter}
                onChange={(e) => setBreakFilter(e.target.value)}
                onBlur={() => saveConfig({ breakFilter })}
                placeholder={t("breakFilterHint")}
                className="mt-2 min-h-[38px] font-mono text-[11px]"
                spellCheck={false}
              />
            )}

            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <Switch
                checked={breakResp}
                onCheckedChange={(v) => {
                  setBreakResp(v);
                  saveConfig({ breakResponse: v });
                }}
              />
              <span className={breakResp ? "text-amber-400" : "text-muted-foreground"}>
                <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
                {t("breakResponse")}: {breakResp ? t("breakOn") : t("breakOff")}
              </span>
            </div>
            {breakResp && (
              <Textarea
                value={breakRespFilter}
                onChange={(e) => setBreakRespFilter(e.target.value)}
                onBlur={() => saveConfig({ breakResponseFilter: breakRespFilter })}
                placeholder={t("breakFilterHint")}
                className="mt-2 min-h-[38px] font-mono text-[11px]"
                spellCheck={false}
              />
            )}
          </>
        )}

        <div className="mt-2 flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchTraffic")}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title={view === "list" ? t("treeView") : t("listView")}
            onClick={() => setView(view === "list" ? "tree" : "list")}
          >
            {view === "list" ? <FolderTree className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title={t("saveCollection")}
            onClick={() => void saveCaptures([])}
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title={t("exportHar")}
            onClick={() => downloadURL("/api/proxy/export?format=har")}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="h-8 shrink-0 text-muted-foreground"
            title={t("exportCurl")}
            onClick={() => downloadURL("/api/proxy/export?format=curl")}
          >
            cURL
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("noCaptures")}</div>
        )}

        {view === "list" && shown.map((e) => row(e))}

        {view === "tree" &&
          groups.map(([host, list]) => {
            const open = expanded[host] ?? true;
            return (
              <div key={host}>
                <div
                  className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/60"
                  onClick={() => setExpanded((s) => ({ ...s, [host]: !open }))}
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
                  <span className="min-w-0 flex-1 truncate" title={host}>
                    {host}
                  </span>
                  <span className="text-[10px]">{list.length}</span>
                </div>
                {open && list.map((e) => row(e, true))}
              </div>
            );
          })}
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
              title={t("saveSelected")}
              onClick={() => void saveCaptures([selected.id])}
            >
              <Save className="h-3.5 w-3.5" />
            </Button>
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
