import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Send, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore, type AIMessage } from "@/store";
import { Markdown } from "@/components/Markdown";

type ConfirmReq = { id: string; tool: string; subject: string; args?: any; rule?: string };

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
  const conversations = useStore((s) => s.aiConversations);
  const activeId = useStore((s) => s.aiActiveId);
  const patchActive = useStore((s) => s.aiPatchActive);
  const newConversation = useStore((s) => s.aiNewConversation);
  const selectConversation = useStore((s) => s.aiSelectConversation);
  const deleteConversation = useStore((s) => s.aiDeleteConversation);
  const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const messages = conv?.messages ?? [];
  const sessionId = conv?.sessionId ?? "";
  const setMessages = (fn: (prev: AIMessage[]) => AIMessage[]) =>
    patchActive((c) => ({ ...c, messages: fn(c.messages), updatedAt: Date.now() }));
  const setSessionId = (v: string) => patchActive((c) => ({ ...c, sessionId: v }));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
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

  const patchLast = (fn: (m: AIMessage) => AIMessage) =>
    setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)));

  const decide = async (decision: "once" | "always" | "deny") => {
    const req = confirmReq;
    if (!req) return;
    setConfirmReq(null);
    try {
      await api.confirmAI(req.id, decision);
    } catch {
      /* the turn will surface the timeout */
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    patchActive((c) => (c.title ? c : { ...c, title: text.slice(0, 60) }));
    setMessages((cur) => [
      ...cur,
      { role: "user", text, tools: [] },
      { role: "assistant", text: "", tools: [] },
    ]);
    abortRef.current = new AbortController();
    try {
      await api.aiChat(
        text,
        sessionId,
        (ev) => {
          if (ev.sessionId) setSessionId(ev.sessionId);
          if (ev.tool) patchLast((m) => ({ ...m, tools: [...m.tools, { name: ev.tool!, args: ev.args }] }));
          if ((ev as any).confirm) setConfirmReq((ev as any).confirm);
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

        {/* Conversation switcher */}
        <div className="flex items-center gap-1.5">
          <Select value={activeId} onValueChange={selectConversation}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {conversations.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.title || t("aiNewChat")}
                  {c.messages.length > 0 && (
                    <span className="ml-1 text-muted-foreground">({c.messages.length})</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={() => newConversation()}
          >
            <Plus className="h-3.5 w-3.5" /> {t("aiNewChat")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 text-xs text-destructive"
            title={t("aiDeleteChat")}
            onClick={() => {
              if (conv) deleteConversation(conv.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

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
                  "max-w-[85%] break-words rounded-lg px-3 py-2",
                  m.role === "user" ? "whitespace-pre-wrap bg-primary text-sm text-primary-foreground" : "bg-muted",
                )}
              >
                {m.role === "user" ? (
                  m.text
                ) : m.text ? (
                  <Markdown text={m.text} />
                ) : busy && i === messages.length - 1 ? (
                  <span className="text-sm text-muted-foreground">{t("aiThinking")}</span>
                ) : null}
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

        {confirmReq && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
              <ShieldAlert className="h-4 w-4" /> {t("aiConfirmTitle")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("aiConfirmAsk")} <code className="font-mono text-foreground">{confirmReq.tool}</code>
              {confirmReq.subject && (
                <>
                  {" · "}
                  <code className="break-all font-mono text-foreground">{confirmReq.subject}</code>
                </>
              )}
            </p>
            {confirmReq.args && Object.keys(confirmReq.args).length > 0 && (
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-background/60 p-1.5 font-mono text-[10px]">
                {JSON.stringify(confirmReq.args, null, 2)}
              </pre>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={() => void decide("once")}>
                {t("aiAllowOnce")}
              </Button>
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => void decide("always")}>
                {t("aiAllowAlways")}
                {confirmReq.rule && <span className="ml-1 opacity-70">({confirmReq.rule})</span>}
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => void decide("deny")}>
                {t("aiDeny")}
              </Button>
            </div>
          </div>
        )}

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
                setMessages(() => []);
                setSessionId("");
                patchActive((c) => ({ ...c, title: "" }));
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
