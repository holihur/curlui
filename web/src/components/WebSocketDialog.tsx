import { useEffect, useRef, useState } from "react";
import { Plug, Send, Trash2, Unplug } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Frame = { dir: "sent" | "recv" | "info" | "error"; text: string; at: number };

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

// WebSocketDialog is a live WebSocket console: it connects through the server
// bridge (/api/ws) to any ws:// or wss:// target and logs every frame.
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
  const [connected, setConnected] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [draft, setDraft] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = (dir: Frame["dir"], text: string) =>
    setFrames((prev) => [...prev, { dir, text, at: Date.now() }]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [frames]);

  // Tear the socket down when the dialog closes.
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
      push("error", String(err));
      return;
    }
    wsRef.current = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ type: "connect", url: url.trim(), headers: parseHeaders(headers) }));
    };
    sock.onmessage = (e) => {
      let f: { type: string; data?: string; error?: string; reason?: string; url?: string };
      try {
        f = JSON.parse(String(e.data));
      } catch {
        push("recv", String(e.data));
        return;
      }
      if (f.type === "open") {
        setConnected(true);
        push("info", `${t("wsConnected")} ${f.url ?? url}`);
      } else if (f.type === "message") {
        push("recv", f.data ?? "");
      } else if (f.type === "error") {
        push("error", f.error ?? "error");
      } else if (f.type === "close") {
        setConnected(false);
        push("info", `${t("wsDisconnected")} ${f.reason ?? ""}`.trim());
      }
    };
    sock.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    sock.onerror = () => push("error", "socket error");
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
    sock.send(JSON.stringify({ type: "send", data: draft }));
    push("sent", draft);
    setDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(96vw,860px)] max-w-none flex-col gap-3">
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
          <Textarea
            className="min-h-[60px] font-mono text-xs"
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            placeholder={t("wsHeaders")}
          />
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
              <span className="whitespace-pre-wrap break-all">{f.text}</span>
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
            placeholder={t("wsMessage")}
            disabled={!connected}
          />
          <div className="flex flex-col gap-1">
            <Button className="h-9 gap-1.5" onClick={sendMsg} disabled={!connected || !draft}>
              <Send className="h-4 w-4" /> {t("wsSend")}
            </Button>
            <Button variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setFrames([])}>
              <Trash2 className="h-3.5 w-3.5" /> {t("wsClear")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
