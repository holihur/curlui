import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

type Tool = { name: string; args?: any };
type Msg = { role: "user" | "assistant"; text: string; tools: Tool[]; error?: string };

// AIChatDialog talks to the server-side agent. The agent runs with the caller's
// scopes, so it can only do what the session (or token) allows.
export function AIChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const sessionRef = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .aiStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)));

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((cur) => [
      ...cur,
      { role: "user", text, tools: [] },
      { role: "assistant", text: "", tools: [] },
    ]);
    abortRef.current = new AbortController();
    try {
      await api.aiChat(
        text,
        sessionRef.current,
        (ev) => {
          if (ev.sessionId) sessionRef.current = ev.sessionId;
          if (ev.tool) patchLast((m) => ({ ...m, tools: [...m.tools, { name: ev.tool!, args: ev.args }] }));
          if (ev.text) patchLast((m) => ({ ...m, text: m.text + ev.text }));
          if (ev.error) patchLast((m) => ({ ...m, error: ev.error }));
        },
        abortRef.current.signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchLast((m) => ({ ...m, error: message }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(96vw,760px)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t("aiChat")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        {configured === false && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-400">
            {t("aiNotConfigured")}
          </p>
        )}

        <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border p-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("aiAsk")}</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex flex-col gap-1", m.role === "user" && "items-end")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.text || (busy && i === messages.length - 1 ? t("aiThinking") : "")}
              </div>
              {m.tools.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.tools.map((tool, j) => (
                    <span
                      key={j}
                      className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-400"
                      title={JSON.stringify(tool.args ?? {})}
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              )}
              {m.error && <p className="text-[11px] text-destructive">{m.error}</p>}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Textarea
            className="min-h-[52px] flex-1 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("aiAsk")}
            disabled={busy || configured === false}
          />
          <div className="flex flex-col gap-1">
            <Button className="h-9 gap-1.5" onClick={() => void send()} disabled={busy || !draft.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("aiSend")}
            </Button>
            <Button
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                setMessages([]);
                sessionRef.current = "";
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("aiClear")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
