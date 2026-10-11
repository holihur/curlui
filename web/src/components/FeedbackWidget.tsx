import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, EyeOff, Loader2, Maximize2, MessageSquare, Minimize2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { FeedbackIssue } from "@/lib/types";

// panelStyle anchors the panel next to the (dragged) button, clamped on screen.
function panelStyle(pos: { x: number; y: number } | null) {
  if (!pos || typeof window === "undefined") return undefined;
  const w = 380;
  const h = Math.min(520, window.innerHeight * 0.7);
  const left = pos.x > window.innerWidth / 2 ? pos.x - w - 8 : pos.x;
  const top = pos.y > window.innerHeight / 2 ? pos.y - h : pos.y + 52;
  return {
    left: Math.min(Math.max(left, 8), Math.max(8, window.innerWidth - w - 8)),
    top: Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - h - 8)),
  };
}

// FeedbackWidget is a floating bottom-right panel that files GitHub issues
// through the server's `gh` CLI and shows their replies.
export function FeedbackWidget() {
  const { t } = useI18n();
  const open = useStore((s) => s.feedbackOpen);
  const setOpen = useStore((s) => s.setFeedbackOpen);
  const hidden = useStore((s) => s.feedbackHidden);
  const setHidden = useStore((s) => s.setFeedbackHidden);
  const toast = useStore((s) => s.toast);
  const version = useStore((s) => s.version);
  const variant = useStore((s) => s.buildVariant);
  const platform = useStore((s) => s.platform);
  const pos = useStore((s) => s.feedbackPos);
  const setPos = useStore((s) => s.setFeedbackPos);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);

  // Drag the button anywhere; the position is remembered.
  const onFabDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = fabRef.current?.getBoundingClientRect();
    const offX = e.clientX - (rect?.left ?? 0);
    const offY = e.clientY - (rect?.top ?? 0);
    const startX = e.clientX;
    const startY = e.clientY;
    dragged.current = false;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) dragged.current = true;
      setPos({
        x: Math.min(Math.max(ev.clientX - offX, 4), window.innerWidth - 48),
        y: Math.min(Math.max(ev.clientY - offY, 4), window.innerHeight - 48),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setTimeout(() => (dragged.current = false), 0);
    };
    document.body.style.cursor = "grabbing";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [tab, setTab] = useState<"new" | "issues">("new");
  const [available, setAvailable] = useState(true);
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issues, setIssues] = useState<FeedbackIssue[]>([]);
  const [selected, setSelected] = useState<FeedbackIssue | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) =>
    toast({
      title: t("feedback"),
      description: err instanceof Error ? err.message : String(err),
      variant: "error",
    });

  const load = async () => {
    try {
      const st = await api.feedbackStatus();
      setAvailable(st.available);
      setRepo(st.repo);
      if (st.available) {
        const { issues: list } = await api.listFeedback();
        setIssues(list ?? []);
      }
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (hidden) return null;

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const issue = await api.createFeedback(title.trim(), body);
      setTitle("");
      setBody("");
      setTab("issues");
      await load();
      if (issue?.number) setSelected(issue);
      toast({ title: t("feedback"), description: `#${issue.number}`, variant: "success" });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleState = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.setFeedbackState(selected.number, selected.state === "OPEN");
      setSelected(updated);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      const updated = await api.commentFeedback(selected.number, reply.trim());
      setSelected(updated);
      setReply("");
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={maximized ? undefined : panelStyle(pos)}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl",
        maximized
          ? "inset-2 h-[calc(100vh-1rem)] w-[calc(100vw-1rem)]"
          : "max-h-[70vh] w-[min(92vw,380px)]",
        !maximized && !pos && "bottom-4 right-4",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("feedback")}</span>
        {repo && <span className="truncate text-[10px] text-muted-foreground">{repo}</span>}
        {version && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {version} · {variant}
          </span>
        )}
        <button
          onClick={() => setMaximized(!maximized)}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={maximized ? t("restore") : t("maximize")}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setHidden(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("feedbackHide")}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!available ? (
        <p className="p-4 text-xs text-muted-foreground">{t("feedbackNotAvailable")}</p>
      ) : selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <button
              onClick={() => setSelected(null)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              #{selected.number} {selected.title}
            </span>
            <button
              onClick={() => void toggleState()}
              disabled={busy}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                selected.state === "OPEN"
                  ? "bg-muted text-muted-foreground hover:text-foreground"
                  : "bg-emerald-500/15 text-emerald-400",
              )}
            >
              {selected.state === "OPEN" ? t("feedbackClose") : t("feedbackReopen")}
            </button>
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title="GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="mb-1 text-[10px] text-muted-foreground">
                {selected.author} · {selected.createdAt?.slice(0, 10)}
              </div>
              <div className="whitespace-pre-wrap">{selected.body}</div>
            </div>
            {(selected.comments ?? []).map((c, i) => (
              <div key={i} className="rounded-md border p-2">
                <div className="mb-1 text-[10px] text-muted-foreground">
                  {c.author} · {c.createdAt?.slice(0, 10)}
                </div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-1 border-t p-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t("feedbackReply")}
              className="min-h-[36px] flex-1 text-xs"
            />
            <Button size="sm" className="gap-1" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
            {(["new", "issues"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium",
                  tab === k ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {k === "new" ? t("feedbackNew") : `${t("feedbackIssues")} (${issues.length})`}
              </button>
            ))}
          </div>

          {tab === "new" ? (
            <div className="flex flex-col gap-2 p-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("feedbackSubject")}
                className="h-8 text-xs"
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("feedbackBody")}
                className="min-h-[110px] text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {t("feedbackAttach")} curlui {version || "dev"} ({variant}) · {platform}
              </p>
              <Button size="sm" className="gap-1.5 self-end" disabled={busy || !title.trim()} onClick={() => void submit()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {t("feedbackSubmit")}
              </Button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {issues.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">{t("feedbackNoIssues")}</p>
              ) : (
                issues.map((iss) => (
                  <button
                    key={iss.number}
                    onClick={() => {
                      setSelected(iss);
                      void api
                        .getFeedback(iss.number)
                        .then(setSelected)
                        .catch(fail);
                    }}
                    className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-xs last:border-0 hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium",
                        iss.state === "OPEN" ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {iss.state}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      #{iss.number} {iss.title}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
