import { useEffect, useRef, useState } from "react";
import { Binary, Plug, Send, Trash2, Unplug } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Frame = {
  dir: "sent" | "recv" | "info" | "error";
  text: string;
  at: number;
  binary?: boolean;
  bytes?: number;
};

function bridgeURL() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws`;
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) out[k] = v;
    }
  }
  return out;
}

// byteLength estimates the decoded size of a base64 string.
function byteLength(b64: string) {
  const len = b64.replace(/=+$/, "").length;
  return Math.floor((len * 3) / 4);
}

// WebSocketDialog is a live WebSocket console: it connects through the server
// bridge (/api/ws) to any ws:// or wss:// target and logs every frame,
// including binary payloads, subprotocols and close codes.
export function WebSocketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("wss://echo.websocket.org");
  const [headers, setHeaders] = useState("");
  const [subprotocols, setSubprotocols] = useState("");
  const [connected, setConnected] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [draft, setDraft] = useState("");
  const [binary, setBinary] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = (f: Omit<Frame, "at">) => setFrames((prev) => [...prev, { ...f, at: Date.now() }]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [frames]);

  useEffect(() => {
    if (!open) disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const connect = () => {
    if (!url.trim()) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(bridgeURL());
    } catch (err) {
      push({ dir: "error", text: String(err) });
      return;
    }
    wsRef.current = sock;
    const protos = subprotocols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          type: "connect",
          url: url.trim(),
          headers: parseHeaders(headers),
          subprotocols: protos,
        }),
      );
    };
    sock.onmessage = (e) => {
      let f: {
        type: string;
        data?: string;
        binary?: boolean;
        error?: string;
        reason?: string;
        url?: string;
        subprotocol?: string;
        closeCode?: number;
      };
      try {
        f = JSON.parse(String(e.data));
      } catch {
        push({ dir: "recv", text: String(e.data) });
        return;
      }
      if (f.type === "open") {
        setConnected(true);
        push({
          dir: "info",
          text: `${t("wsConnected")} ${f.url ?? url}${f.subprotocol ? ` · ${f.subprotocol}` : ""}`,
        });
      } else if (f.type === "message") {
        if (f.binary) {
          const b64 = f.data ?? "";
          push({ dir: "recv", text: b64, binary: true, bytes: byteLength(b64) });
        } else {
          push({ dir: "recv", text: f.data ?? "", bytes: (f.data ?? "").length });
        }
      } else if (f.type === "error") {
        push({ dir: "error", text: f.error ?? "error" });
      } else if (f.type === "close") {
        setConnected(false);
        const code = f.closeCode ? ` [${f.closeCode}]` : "";
        push({ dir: "info", text: `${t("wsDisconnected")}${code} ${f.reason ?? ""}`.trim() });
      }
    };
    sock.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    sock.onerror = () => push({ dir: "error", text: "socket error" });
  };

  const disconnect = () => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify({ type: "close" }));
      } catch {
        /* ignore */
      }
    }
    sock?.close();
    wsRef.current = null;
    setConnected(false);
  };

  const sendMsg = () => {
    const sock = wsRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    sock.send(JSON.stringify({ type: "send", data: draft, binary }));
    push({
      dir: "sent",
      text: draft,
      binary,
      bytes: binary ? byteLength(draft) : draft.length,
    });
    setDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] w-[min(96vw,900px)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t("wsConsole")}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            className="h-9 flex-1 font-mono text-sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://example.com/socket"
            disabled={connected}
          />
          {connected ? (
            <Button variant="destructive" className="h-9 gap-1.5" onClick={disconnect}>
              <Unplug className="h-4 w-4" /> {t("wsDisconnect")}
            </Button>
          ) : (
            <Button className="h-9 gap-1.5" onClick={connect}>
              <Plug className="h-4 w-4" /> {t("wsConnect")}
            </Button>
          )}
        </div>

        {!connected && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Textarea
              className="min-h-[52px] font-mono text-xs"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={t("wsHeaders")}
            />
            <Textarea
              className="min-h-[52px] font-mono text-xs"
              value={subprotocols}
              onChange={(e) => setSubprotocols(e.target.value)}
              placeholder={t("wsSubprotocols")}
            />
          </div>
        )}

        <div
          ref={logRef}
          className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs"
        >
          {frames.length === 0 && <div className="text-muted-foreground">{t("wsHint")}</div>}
          {frames.map((f, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-muted-foreground">
                {new Date(f.at).toLocaleTimeString()}
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold",
                  f.dir === "sent" && "text-blue-400",
                  f.dir === "recv" && "text-emerald-400",
                  f.dir === "error" && "text-red-400",
                  f.dir === "info" && "text-muted-foreground",
                )}
              >
                {f.dir === "sent" ? "↑" : f.dir === "recv" ? "↓" : "•"}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                {f.binary && (
                  <span className="mr-1 rounded bg-amber-500/15 px-1 text-[10px] text-amber-400">
                    binary · {f.bytes ?? 0}B
                  </span>
                )}
                {f.text}
                {!f.binary && f.bytes !== undefined && (
                  <span className="ml-1 text-[10px] text-muted-foreground">({f.bytes}B)</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Textarea
            className="min-h-[44px] flex-1 font-mono text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMsg();
              }
            }}
            placeholder={binary ? t("wsBinaryHint") : t("wsMessage")}
            disabled={!connected}
          />
          <div className="flex flex-col gap-1">
            <Button className="h-9 gap-1.5" onClick={sendMsg} disabled={!connected || !draft}>
              <Send className="h-4 w-4" /> {t("wsSend")}
            </Button>
            <div className="flex gap-1">
              <Button
                variant={binary ? "secondary" : "ghost"}
                className={cn("h-7 gap-1 text-xs", binary && "text-amber-400")}
                title={t("wsBinary")}
                onClick={() => setBinary(!binary)}
              >
                <Binary className="h-3.5 w-3.5" /> {t("wsBinary")}
              </Button>
              <Button variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setFrames([])}>
                <Trash2 className="h-3.5 w-3.5" /> {t("wsClear")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
