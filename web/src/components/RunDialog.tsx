import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatMs, shortMethod, statusColor } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { BatchResult, BatchSummary, RequestDef } from "@/lib/types";

export type RunItem = { name: string; request: RequestDef };

export function RunDialog({
  open,
  onOpenChange,
  title,
  items,
  defaultRepeat = 1,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: RunItem[];
  defaultRepeat?: number;
}) {
  const { t } = useI18n();
  const activeEnvId = useStore((s) => s.activeEnvId);
  const runtimeVars = useStore((s) => s.runtimeVars);
  const toast = useStore((s) => s.toast);

  const [concurrency, setConcurrency] = useState(5);
  const [repeat, setRepeat] = useState(defaultRepeat);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);

  useEffect(() => {
    if (open) {
      setRepeat(defaultRepeat);
      setResults(null);
      setSummary(null);
    }
  }, [open, defaultRepeat]);

  const run = async () => {
    setRunning(true);
    setResults(null);
    setSummary(null);
    try {
      const res = await api.runBatch({
        items: items.map((it) => ({ name: it.name, request: it.request, repeat })),
        concurrency,
        envId: activeEnvId ?? "",
        variables: runtimeVars,
      });
      setResults(res.results);
      setSummary(res.summary);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>
            {items.length} · {t("repeats")} {repeat}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("concurrency")}</label>
            <Input
              type="number"
              min={1}
              max={64}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
              className="h-9 w-28"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("repeats")}</label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={repeat}
              onChange={(e) => setRepeat(Number(e.target.value) || 1)}
              className="h-9 w-28"
            />
          </div>
          <Button className="h-9 gap-1.5" onClick={() => void run()} disabled={running || items.length === 0}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? t("runningRequests") : t("run")}
          </Button>
        </div>

        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("noRequestsInScope")}</p>
        )}

        {summary && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-400">
              {t("runOk", { ok: summary.ok })}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 font-medium",
                summary.failed > 0 ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground",
              )}
            >
              {t("runFailed", { failed: summary.failed })}
            </span>
            <span className="text-muted-foreground">
              {t("avgTime")} {formatMs(summary.avgMs)} · {t("minTime")} {formatMs(summary.minMs)} ·{" "}
              {t("maxTime")} {formatMs(summary.maxMs)}
            </span>
          </div>
        )}

        {results && (
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs last:border-0"
              >
                {r.error || r.assertionsFailed > 0 ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}
                <span
                  title={r.method}
                  className={cn("w-12 shrink-0 text-[10px] font-semibold", `method-${r.method}`)}
                >
                  {shortMethod(r.method)}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className={cn("font-mono", statusColor(r.status))}>{r.status || "—"}</span>
                <span className="w-16 shrink-0 text-right font-mono text-muted-foreground">
                  {formatMs(r.duration)}
                </span>
                {r.error && <span className="w-40 shrink-0 truncate text-red-400">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
