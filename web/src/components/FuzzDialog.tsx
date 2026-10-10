import { useEffect, useState } from "react";
import { Bug, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatMs, statusColor } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { FuzzResult, RequestDef } from "@/lib/types";

export function FuzzDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestDef;
}) {
  const { t } = useI18n();
  const activeEnvId = useStore((s) => s.activeEnvId);
  const runtimeVars = useStore((s) => s.runtimeVars);
  const toast = useStore((s) => s.toast);

  const [concurrency, setConcurrency] = useState(8);
  const [payloads, setPayloads] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FuzzResult | null>(null);

  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await api.runFuzz({
        request,
        concurrency,
        payloads: payloads
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        envId: activeEnvId ?? "",
        variables: runtimeVars,
      });
      setResult(res);
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
            <Bug className="h-4 w-4" /> {t("fuzzTitle")}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {request.method} {request.url}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("concurrency")}</label>
            <Input
              type="number"
              min={1}
              max={32}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
              className="h-9"
            />
            <Button className="mt-1 h-9 gap-1.5" onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? t("runningFuzz") : t("run")}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("payloads")}</label>
            <Textarea
              value={payloads}
              onChange={(e) => setPayloads(e.target.value)}
              placeholder={"'\n\"\n<script>\n../../etc/passwd\n{{7*7}}"}
              className="min-h-[120px] font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">{t("payloadsHint")}</p>
          </div>
        </div>

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-0.5">
                {t("baseline")}: <span className={cn("font-mono", statusColor(result.baseline.status))}>{result.baseline.status}</span>{" "}
                · {result.baseline.size} B · {formatMs(result.baseline.duration)}
              </span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-medium",
                  result.summary.issues > 0 ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400",
                )}
              >
                {t("fuzzSummary", { total: result.summary.total, issues: result.summary.issues })}
              </span>
            </div>

            <div className="max-h-[42vh] overflow-y-auto rounded-lg border">
              {result.results.map((r, i) => {
                const bad = (r.issues ?? []).length > 0;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs last:border-0",
                      bad && "bg-red-500/5",
                    )}
                  >
                    {bad ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono" title={r.name}>
                      {r.name}
                    </span>
                    {(r.issues ?? []).length > 0 && (
                      <span className="shrink-0 text-[10px] text-red-400">{(r.issues ?? []).join(", ")}</span>
                    )}
                    <span className={cn("shrink-0 font-mono", statusColor(r.status))}>{r.status || "—"}</span>
                    <span className="w-14 shrink-0 text-right font-mono text-muted-foreground">
                      {formatMs(r.duration)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
