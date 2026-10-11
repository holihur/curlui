import { useEffect, useRef, useState } from "react";
import { Loader2, Network, Play, Radio, Save, Send, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "@/components/CodeEditor";
import { cn, formatMs, prettyJSON } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { GrpcResult, GrpcService, GrpcStoredDescriptor, KeyValue } from "@/lib/types";
import { blankRequest } from "@/lib/types";

const TARGET_KEY = "curlui.grpc.target";
const DESC_KEY = "curlui.grpc.descriptor";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// parseMetadata turns "key: value" lines into gRPC metadata.
function parseMetadata(text: string): KeyValue[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      const key = i >= 0 ? line.slice(0, i).trim() : line;
      const value = i >= 0 ? line.slice(i + 1).trim() : "";
      return { id: Math.random().toString(36).slice(2), key, value, enabled: true };
    })
    .filter((kv) => kv.key);
}

export function GrpcPanel() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const createRequest = useStore((s) => s.createRequest);
  const selectedFolderId = useStore((s) => s.selectedFolderId);

  const [target, setTarget] = useState(() => localStorage.getItem(TARGET_KEY) ?? "localhost:50051");
  const [plaintext, setPlaintext] = useState(true);
  const [descriptors, setDescriptors] = useState<GrpcStoredDescriptor[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => localStorage.getItem(DESC_KEY) ?? "");
  const [services, setServices] = useState<GrpcService[]>([]);
  const [service, setService] = useState("");
  const [method, setMethod] = useState("");
  const [body, setBody] = useState("{}");
  const [metadata, setMetadata] = useState("");
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [streamLog, setStreamLog] = useState<{ kind: string; text: string }[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamDraft, setStreamDraft] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fullName = (svc: GrpcService) => (svc.package ? svc.package + "." : "") + svc.name;
  const isStreamingMethod = services.some(
    (svc) => fullName(svc) === service && svc.methods.some((m) => m.name === method && m.streaming),
  );
  const selectedMethod = services
    .find((svc) => fullName(svc) === service)
    ?.methods.find((m) => m.name === method);

  const fail = (err: unknown) =>
    toast({
      title: t("grpc"),
      description: err instanceof Error ? err.message : String(err),
      variant: "error",
    });

  useEffect(() => {
    localStorage.setItem(TARGET_KEY, target);
  }, [target]);
  useEffect(() => {
    if (selectedId) localStorage.setItem(DESC_KEY, selectedId);
  }, [selectedId]);

  const pick = async (d: GrpcStoredDescriptor) => {
    setSelectedId(d.id);
    setServices(d.services ?? []);
    const first = d.services?.[0];
    const svc = first ? `${first.package ? first.package + "." : ""}${first.name}` : "";
    const mth = first?.methods?.[0]?.name ?? "";
    setService(svc);
    setMethod(mth);
    setResult(null);
    if (svc && mth) void loadExample(d.id, svc, mth);
  };

  const refresh = async (selectId?: string) => {
    try {
      const { descriptors: list } = await api.listGrpcDescriptors();
      setDescriptors(list ?? []);
      const want = selectId ?? selectedId;
      const found = (list ?? []).find((d) => d.id === want);
      if (found) await pick(found);
      else if (list?.length) await pick(list[0]);
      else {
        setSelectedId("");
        setServices([]);
        setService("");
        setMethod("");
      }
    } catch (err) {
      fail(err);
    } finally {
      setLoaded(true);
    }
  };

  // Load the saved descriptors once on mount.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExample = async (id: string, svc: string, mth: string) => {
    try {
      const { example } = await api.grpcExample(id, svc, mth);
      if (example) setBody(example);
    } catch {
      /* keep current body */
    }
  };

  const importPb = async (file: File) => {
    setBusy(true);
    try {
      const res = await api.grpcDescriptor({
        descriptor: toBase64(await file.arrayBuffer()),
        name: file.name,
        target,
        plaintext,
      });
      await refresh(res.id);
      toast({ title: t("grpc"), description: `${file.name}: ${res.services?.length ?? 0}`, variant: "success" });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reflect = async () => {
    setBusy(true);
    try {
      const res = await api.grpcDescriptor({ reflect: true, target, plaintext });
      await refresh(res.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteGrpcDescriptor(id);
      if (id === selectedId) setSelectedId("");
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const invoke = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await api.grpcCall({
          id: selectedId,
          target,
          service,
          method,
          body,
          plaintext,
          metadata: parseMetadata(metadata),
        }),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // streamCall opens an interactive streaming RPC over the WebSocket bridge, so
  // messages can be sent and received at the same time (true bidi).
  const streamCall = () => {
    setStreamLog([]);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const sock = new WebSocket(`${proto}//${location.host}/api/ws`);
    wsRef.current = sock;
    const md: Record<string, string> = {};
    for (const kv of parseMetadata(metadata)) if (kv.key) md[kv.key] = kv.value;
    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          type: "connect",
          protocol: "grpc",
          descriptorId: selectedId,
          target,
          service,
          method,
          plaintext,
          metadata: md,
        }),
      );
    };
    sock.onmessage = (e) => {
      let f: { type: string; data?: string; code?: string; reason?: string; error?: string };
      try {
        f = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (f.type === "open") {
        setStreaming(true);
        setStreamLog((l) => [...l, { kind: "meta", text: t("grpcStreamOpen") }]);
        // Send the request body, then half-close for server-streaming methods.
        if (body.trim()) {
          sock.send(JSON.stringify({ type: "send", data: body }));
          setStreamLog((l) => [...l, { kind: "sent", text: body }]);
        }
        if (!selectedMethod?.clientStreaming) sock.send(JSON.stringify({ type: "end" }));
      } else if (f.type === "message") {
        setStreamLog((l) => [...l, { kind: "message", text: f.data ?? "" }]);
      } else if (f.type === "status") {
        setStreamLog((l) => [...l, { kind: "status", text: `${f.code ?? "OK"}${f.reason ? ": " + f.reason : ""}` }]);
        setStreaming(false);
      } else if (f.type === "info") {
        setStreamLog((l) => [...l, { kind: "meta", text: f.reason ?? "" }]);
      } else if (f.type === "error") {
        setStreamLog((l) => [...l, { kind: "error", text: f.error ?? "error" }]);
      }
    };
    sock.onclose = () => {
      setStreaming(false);
      wsRef.current = null;
    };
    sock.onerror = () => setStreamLog((l) => [...l, { kind: "error", text: "socket error" }]);
  };

  const sendStreamMessage = () => {
    const sock = wsRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN || !streamDraft.trim()) return;
    sock.send(JSON.stringify({ type: "send", data: streamDraft }));
    setStreamLog((l) => [...l, { kind: "sent", text: streamDraft }]);
    setStreamDraft("");
  };

  const endSend = () => wsRef.current?.send(JSON.stringify({ type: "end" }));

  const stopStream = () => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "close" }));
    sock?.close();
    wsRef.current = null;
    setStreaming(false);
  };

  // Save the current call into the collection tree (protocol: grpc) so it can
  // be reopened, exported and shared like any HTTP request.
  const saveToCollection = async () => {
    try {
      const id = await createRequest(`gRPC ${method || service || "call"}`, selectedFolderId ?? "", {
        ...blankRequest(),
        protocol: "grpc",
        name: `gRPC ${method || service || "call"}`,
        grpc: {
          target,
          service,
          method,
          descriptorId: selectedId,
          plaintext,
          body,
          metadata: parseMetadata(metadata),
        },
      });
      if (id) toast({ title: t("saved"), variant: "success" });
    } catch (err) {
      fail(err);
    }
  };

  const currentService = services.find((s) => `${s.package ? s.package + "." : ""}${s.name}` === service);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-2 text-xs">
      {/* target + import */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="localhost:50051"
            className="h-7 flex-1 font-mono text-[11px]"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pb,.bin,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importPb(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            title={t("grpcImportPb")}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            title={t("grpcReflect")}
            onClick={() => void reflect()}
          >
            <Radio className="h-3.5 w-3.5" />
          </Button>
        </div>
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{t("grpcPlaintext")}</span>
          <Switch checked={plaintext} onCheckedChange={setPlaintext} />
        </label>
      </div>

      {/* descriptor list */}
      <div className="mt-2 text-[11px] font-medium text-muted-foreground">{t("grpcSaved")}</div>
      <div className="mt-1 flex flex-col rounded-md border">
        {descriptors.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">{t("grpcNoDescriptors")}</p>
        ) : (
          descriptors.map((d) => (
            <div
              key={d.id}
              className={cn(
                "group flex items-center gap-1 border-b border-border/40 px-2 py-1 last:border-0",
                d.id === selectedId && "bg-accent",
              )}
            >
              <button
                onClick={() => void pick(d)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={d.target || d.id}
              >
                <Network className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {d.services?.length ?? 0}
                </span>
              </button>
              <button
                onClick={() => void remove(d.id)}
                className="rounded p-0.5 text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                title={t("delete")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {services.length > 0 && (
        <>
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{t("grpcService")}</span>
            <Select
              value={service}
              onValueChange={(v) => {
                setService(v);
                const svc = services.find((s) => `${s.package ? s.package + "." : ""}${s.name}` === v);
                const m = svc?.methods?.[0]?.name ?? "";
                setMethod(m);
                if (m) void loadExample(selectedId, v, m);
              }}
            >
              <SelectTrigger className="h-7 font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => {
                  const full = `${s.package ? s.package + "." : ""}${s.name}`;
                  return (
                    <SelectItem key={full} value={full} className="text-[11px]">
                      {full}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-1 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{t("grpcMethod")}</span>
            <Select
              value={method}
              onValueChange={(v) => {
                setMethod(v);
                void loadExample(selectedId, service, v);
              }}
            >
              <SelectTrigger className="h-7 font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(currentService?.methods ?? []).map((m) => (
                  <SelectItem key={m.name} value={m.name} className="text-[11px]">
                    {m.name}
                    {m.streaming ? " (stream)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-1 flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t("grpcMetadata")}</span>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto h-6 gap-1 text-[10px] text-muted-foreground"
                onClick={() => void loadExample(selectedId, service, method)}
                title={t("grpcExample")}
              >
                <Sparkles className="h-3 w-3" /> {t("grpcExample")}
              </Button>
            </div>
            <textarea
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              placeholder={"authorization: Bearer …"}
              className="h-12 w-full resize-y rounded-md border bg-background p-1.5 font-mono text-[11px] outline-none"
              spellCheck={false}
            />
          </div>

          <div className="mt-1 flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">JSON</span>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto h-6 gap-1 text-[10px] text-muted-foreground"
                disabled={!selectedId || !service || !method}
                onClick={() => void saveToCollection()}
                title={t("save")}
              >
                <Save className="h-3 w-3" /> {t("save")}
              </Button>
              <Button
                size="xs"
                className="h-6 gap-1 text-[10px]"
                disabled={busy || !selectedId || !service || !method}
                onClick={() => void invoke()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {t("grpcInvoke")}
              </Button>
              {isStreamingMethod && (
                <Button
                  size="xs"
                  variant={streaming ? "destructive" : "secondary"}
                  className="h-6 gap-1 text-[10px]"
                  disabled={!selectedId || !service || !method}
                  onClick={() => (streaming ? stopStream() : streamCall())}
                >
                  {streaming ? <Square className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
                  {streaming ? t("stop") : t("grpcStream")}
                </Button>
              )}
            </div>
            <CodeEditor value={body} onChange={setBody} language="json" className="min-h-[110px]" />
            {streaming && (
              <div className="mt-1 flex gap-1">
                <Input
                  className="h-7 flex-1 font-mono text-[10px]"
                  value={streamDraft}
                  onChange={(e) => setStreamDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendStreamMessage();
                  }}
                  placeholder={t("wsMessage")}
                />
                <Button
                  size="xs"
                  className="h-7 gap-1 text-[10px]"
                  onClick={sendStreamMessage}
                  disabled={!streamDraft.trim()}
                >
                  <Send className="h-3 w-3" /> {t("wsSend")}
                </Button>
                {selectedMethod?.clientStreaming && (
                  <Button size="xs" variant="secondary" className="h-7 text-[10px]" onClick={endSend}>
                    {t("grpcEndSend")}
                  </Button>
                )}
              </div>
            )}
          </div>

          {result && (
            <div className="mt-2 flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                    result.code === "OK" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
                  )}
                >
                  {result.code}
                </span>
                {result.message && (
                  <span className="truncate text-[10px] text-red-400" title={result.message}>
                    {result.message}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">{formatMs(result.duration)}</span>
              </div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 font-mono text-[10px]">
                {prettyJSON(result.response) || result.response}
              </pre>
            </div>
          )}

          {streamLog.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {streamLog.map((e, i) => (
                <pre
                  key={i}
                  className={cn(
                    "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 font-mono text-[10px]",
                    e.kind === "error" && "text-red-400",
                    e.kind === "meta" && "text-muted-foreground",
                    e.kind === "sent" && "text-blue-400",
                    e.kind === "status" && "text-emerald-400",
                  )}
                >
                  {e.kind === "sent" ? "↑ " : e.kind === "message" ? "↓ " : ""}
                  {e.kind === "message" || e.kind === "sent" ? prettyJSON(e.text) || e.text : e.text}
                </pre>
              ))}
            </div>
          )}
        </>
      )}

      {loaded && descriptors.length === 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">{t("grpcNoServices")}</p>
      )}
    </div>
  );
}
