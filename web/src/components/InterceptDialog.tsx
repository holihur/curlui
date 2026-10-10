import { useEffect, useRef, useState } from "react";
import { PauseCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { PendingIntercept } from "@/lib/types";

function headersToText(h: Record<string, string[]>): string {
  return Object.entries(h)
    .flatMap(([k, values]) => values.map((v) => `${k}: ${v}`))
    .join("\n");
}

function textToHeaders(s: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of s.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) (out[k] ??= []).push(v);
    }
  }
  return out;
}

export function InterceptDialog() {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);

  const [pending, setPending] = useState<PendingIntercept | null>(null);
  const [method, setMethod] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const editingId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const { pending } = await api.listIntercepts();
        if (!active) return;
        const first = (pending ?? [])[0] ?? null;
        if (first && first.id !== editingId.current) {
          editingId.current = first.id;
          setMethod(first.method);
          setUrl(first.url);
          setHeaders(headersToText(first.headers ?? {}));
          setBody(first.body ?? "");
        }
        if (!first) editingId.current = null;
        setPending(first);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const resolve = async (action: "continue" | "abort") => {
    if (!pending) return;
    try {
      await api.resolveIntercept(pending.id, {
        action,
        method,
        url,
        headers: textToHeaders(headers),
        body,
      });
      editingId.current = null;
      setPending(null);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <Dialog open={pending !== null} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-amber-400" /> {t("interceptTitle")}
          </DialogTitle>
          <DialogDescription>{t("interceptHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <Input value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 font-mono text-xs" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 font-mono text-xs" />
          </div>
          <Textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            className="min-h-[80px] font-mono text-xs"
            spellCheck={false}
            placeholder="Header: value"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[100px] font-mono text-xs"
            spellCheck={false}
            placeholder="(body)"
          />
        </div>

        <DialogFooter>
          <Button variant="destructive" onClick={() => void resolve("abort")}>
            {t("abort")}
          </Button>
          <Button onClick={() => void resolve("continue")}>{t("continueAction")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
