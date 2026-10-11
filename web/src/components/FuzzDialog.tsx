import { useEffect, useMemo, useState } from "react";
import { Bug, CheckCircle2, Download, Loader2, Play, XCircle } from "lucide-react";
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
import { cn, formatBytes, formatMs, statusColor } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { FuzzFinding, FuzzResult, RequestDef } from "@/lib/types";

const CATEGORIES = ["sqli", "xss", "ssti", "traversal", "cmdi", "format", "crlf", "nosql", "type", "overflow"];
const KINDS: { key: string; label: string }[] = [
  { key: "param", label: "query params" },
  { key: "header", label: "headers" },
  { key: "cookie", label: "cookies" },
  { key: "body", label: "body" },
  { key: "path", label: "URL path" },
];

const SEV_STYLE: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-sky-500/15 text-sky-400",
};

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
  const [cats, setCats] = useState<string[]>(CATEGORIES);
  const [kinds, setKinds] = useState<string[]>(KINDS.map((k) => k.key));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FuzzResult | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setOpenRow(null);
    }
  }, [open]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setOpenRow(null);
    try {
      const res = await api.runFuzz({
        request,
        concurrency,
        categories: cats,
        kinds,
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

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "curlui-fuzz.json";
    a.click();
    URL.revokeObjectURL(href);
  };

  const sevCount = useMemo(
    () => ({
      high: result?.summary.high ?? 0,
      medium: result?.summary.medium ?? 0,
    }),
    [result],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> {t("fuzzTitle")}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {request.method} {request.url}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <div className="flex flex-col gap-3">
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
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("injectionPoints")}</span>
              {KINDS.map((k) => (
                <label key={k.key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={kinds.includes(k.key)}
                    onChange={() => toggle(kinds, setKinds, k.key)}
                  />
                  {k.label}
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("fuzzCategories")}</span>
              <div className="flex flex-wrap gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggle(cats, setCats, c)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                      cats.includes(c)
                        ? "border-primary bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <Button className="h-9 gap-1.5" onClick={() => void run()} disabled={running}>
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
              className="min-h-[150px] font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">{t("fuzzHint")}</p>
          </div>
        </div>

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-0.5">
                {t("baseline")}:{" "}
                <span className={cn("font-mono", statusColor(result.baseline.status))}>
                  {result.baseline.status}
                </span>{" "}
                · {formatBytes(result.baseline.size)} · {formatMs(result.baseline.duration)}
              </span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-medium",
                  result.summary.issues > 0 ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400",
                )}
              >
                {result.summary.issues}/{result.summary.total}
              </span>
              {sevCount.high > 0 && (
                <span className={cn("rounded px-2 py-0.5 font-medium", SEV_STYLE.high)}>
                  {t("severityHigh")} {sevCount.high}
                </span>
              )}
              {sevCount.medium > 0 && (
                <span className={cn("rounded px-2 py-0.5 font-medium", SEV_STYLE.medium)}>
                  {t("severityMedium")} {sevCount.medium}
                </span>
              )}
              <Button variant="ghost" size="xs" className="ml-auto gap-1" onClick={exportJson}>
                <Download className="h-3.5 w-3.5" /> {t("exportResults")}
              </Button>
            </div>

            <div className="max-h-[44vh] overflow-y-auto rounded-lg border">
              {result.results.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">{t("noFindings")}</p>
              ) : (
                result.results.map((r, i) => (
                  <FindingRow
                    key={i}
                    finding={r}
                    open={openRow === i}
                    onToggle={() => setOpenRow(openRow === i ? null : i)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FindingRow({
  finding,
  open,
  onToggle,
}: {
  finding: FuzzFinding;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const sev = finding.severity || "low";
  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40"
      >
        {sev === "high" ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        ) : sev === "medium" ? (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        )}
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", SEV_STYLE[sev])}>
          {sev === "high" ? t("severityHigh") : sev === "medium" ? t("severityMedium") : t("severityLow")}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {finding.kind}:{finding.target}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono" title={finding.payload}>
          {finding.payload}
        </span>
        {finding.count && finding.count > 1 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">×{finding.count}</span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{(finding.issues ?? []).join(", ")}</span>
        <span className={cn("shrink-0 font-mono", statusColor(finding.status))}>{finding.status || "—"}</span>
        <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
          {formatMs(finding.duration)}
        </span>
      </button>
      {open && (
        <div className="space-y-1 border-t bg-muted/20 px-3 py-2 text-[11px]">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>
              {t("payloads")}: <span className="font-mono text-foreground">{finding.payload}</span>
            </span>
            <span>
              category: <span className="font-mono text-foreground">{finding.category}</span>
            </span>
            <span>
              size: <span className="font-mono text-foreground">{formatBytes(finding.size)}</span>
            </span>
          </div>
          {(finding.evidence ?? []).length > 0 && (
            <div>
              <div className="mb-0.5 font-medium text-muted-foreground">{t("evidence")}</div>
              {(finding.evidence ?? []).map((e, i) => (
                <pre
                  key={i}
                  className="mb-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-1.5 font-mono text-[10px]"
                >
                  {e}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
