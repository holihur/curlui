import { useMemo, useState } from "react";
import { Check, Copy, Download, FileWarning, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, copyText, formatBytes, formatMs, prettyJSON, statusColor } from "@/lib/utils";
import { highlightJSON } from "@/lib/highlight";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { Tab } from "@/store";
import type { ApiResponse } from "@/lib/types";

export function ResponsePanel({ tab }: { tab: Tab }) {
  const { t } = useI18n();
  const res = tab.response;

  if (tab.sending && !res) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
        {t("sending")}
      </div>
    );
  }

  if (!res) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Inbox className="h-8 w-8 opacity-40" />
        <p className="text-sm">{t("responseEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ResponseStatusBar res={res} />
      <ResponseTabs res={res} />
    </div>
  );
}

function ResponseStatusBar({ res }: { res: ApiResponse }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b bg-card px-3 text-xs">
      {res.error ? (
        <span className="font-semibold text-destructive">{t("error")}</span>
      ) : (
        <span className={cn("font-semibold", statusColor(res.status))}>
          {res.status} {res.statusText}
        </span>
      )}
      <span className="text-muted-foreground">{formatMs(res.duration)}</span>
      <span className="text-muted-foreground">{formatBytes(res.size)}</span>
      {res.isBinary && <span className="text-warning">{t("binaryTag")}</span>}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 text-muted-foreground"
          onClick={async () => {
            const ok = await copyText(res.body);
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

const RESPONSE_TABS: { value: string; label: MessageKey }[] = [
  { value: "body", label: "respBody" },
  { value: "headers", label: "respHeaders" },
  { value: "cookies", label: "respCookies" },
  { value: "timing", label: "respTiming" },
  { value: "request", label: "respRequest" },
];

function ResponseTabs({ res }: { res: ApiResponse }) {
  const { t } = useI18n();
  const [view, setView] = useState<"pretty" | "raw">("pretty");
  const headerCount = Object.keys(res.headers ?? {}).length;
  const cookieCount = res.cookies?.length ?? 0;

  const pretty = useMemo(() => {
    if (res.isBinary) return null;
    return prettyJSON(res.body);
  }, [res]);

  const shown = view === "pretty" && pretty ? pretty : res.body;
  const requestBodyPretty = useMemo(
    () => (res.request.body ? prettyJSON(res.request.body) : null),
    [res.request.body],
  );

  return (
    <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-2 pt-1">
        <TabsList className="h-8 bg-transparent p-0">
          {RESPONSE_TABS.map((tabItem) => (
            <TabsTrigger
              key={tabItem.value}
              value={tabItem.value}
              className="rounded-none border-b-2 border-transparent !bg-transparent px-3 py-2 text-xs data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {t(tabItem.label)}
              {tabItem.value === "headers" && headerCount > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">{headerCount}</span>
              )}
              {tabItem.value === "cookies" && cookieCount > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">{cookieCount}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {pretty && (
          <div className="flex items-center gap-1 pr-1">
            <Button variant={view === "pretty" ? "secondary" : "ghost"} size="xs" onClick={() => setView("pretty")}>
              {t("pretty")}
            </Button>
            <Button variant={view === "raw" ? "secondary" : "ghost"} size="xs" onClick={() => setView("raw")}>
              {t("raw")}
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <TabsContent value="body" className="m-0 h-full">
          {res.error && !res.status ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
              <FileWarning className="h-7 w-7" />
              {res.error}
            </div>
          ) : res.isBinary ? (
            <BinaryView res={res} />
          ) : (
            <pre className="m-0 h-full overflow-auto whitespace-pre-wrap break-words bg-background p-3 font-mono text-xs leading-relaxed">
              {shown ? (
                pretty ? (
                  highlightJSON(shown)
                ) : (
                  shown
                )
              ) : (
                <span className="text-muted-foreground">{t("emptyBody")}</span>
              )}
            </pre>
          )}
        </TabsContent>

        <TabsContent value="headers" className="m-0 h-full overflow-auto">
          <KeyValueTable
            rows={Object.entries(res.headers ?? {}).flatMap(([k, values]) =>
              values.length ? values.map((v) => [k, v] as [string, string]) : [[k, ""] as [string, string]],
            )}
          />
        </TabsContent>

        <TabsContent value="cookies" className="m-0 h-full overflow-auto">
          {cookieCount === 0 ? (
            <Empty text={t("noCookies")} />
          ) : (
            <KeyValueTable
              head={["Name", "Value", "Domain", "Path"]}
              rows={(res.cookies ?? []).map((c) => [c.name, c.value, c.domain, c.path])}
            />
          )}
        </TabsContent>

        <TabsContent value="timing" className="m-0 h-full overflow-auto p-4">
          <TimingView res={res} />
        </TabsContent>

        <TabsContent value="request" className="m-0 h-full overflow-auto p-3">
          <div className="mb-2 font-mono text-xs text-muted-foreground">
            <span className="text-foreground">{res.request.method}</span> {res.request.url}
          </div>
          <KeyValueTable
            rows={Object.entries(res.request.headers ?? {}).flatMap(([k, values]) =>
              values.map((v) => [k, v] as [string, string]),
            )}
          />
          {res.request.body && (
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-xs">
              {requestBodyPretty ? highlightJSON(requestBodyPretty) : res.request.body}
            </pre>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

function BinaryView({ res }: { res: ApiResponse }) {
  const { t } = useI18n();
  const href = `data:${res.contentType || "application/octet-stream"};base64,${res.bodyBase64 ?? ""}`;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <FileWarning className="h-8 w-8 opacity-50" />
      <div>
        {t("binaryResponse")} · {res.contentType} · {formatBytes(res.size)}
      </div>
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <a href={href} download={`response-${Date.now()}`}>
          <Download className="h-4 w-4" /> {t("download")}
        </a>
      </Button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-xs text-muted-foreground">{text}</div>;
}

function KeyValueTable({ rows, head }: { rows: (string | number)[][]; head?: string[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return <Empty text={t("nothingHere")} />;
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      {head && (
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/50 align-top hover:bg-accent/30">
            {row.map((cell, j) => (
              <td
                key={j}
                className={cn(
                  "px-3 py-1.5 font-mono break-words",
                  j === 0 ? "w-1/3 text-primary" : "text-foreground",
                )}
              >
                {String(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TimingView({ res }: { res: ApiResponse }) {
  const { t } = useI18n();
  const timing = res.timing;
  const phases: { label: string; value: number; color: string }[] = [
    { label: t("dnsLookup"), value: timing.dns, color: "bg-sky-400" },
    { label: t("tcpConnect"), value: timing.connect, color: "bg-indigo-400" },
    { label: t("tlsHandshake"), value: timing.tls, color: "bg-purple-400" },
    {
      label: t("waitingTtfb"),
      value: Math.max(timing.firstByte - timing.dns - timing.connect - timing.tls, 0),
      color: "bg-amber-400",
    },
    { label: t("contentDownload"), value: Math.max(timing.total - timing.firstByte, 0), color: "bg-emerald-400" },
  ];
  const max = Math.max(timing.total, 1);
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {phases.map((p) => (
          <div
            key={p.label}
            className={p.color}
            style={{ width: `${(p.value / max) * 100}%` }}
            title={`${p.label}: ${formatMs(p.value)}`}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        {phases.map((p) => (
          <div key={p.label} className="flex items-center gap-3 text-xs">
            <span className={cn("h-2.5 w-2.5 rounded-full", p.color)} />
            <span className="w-40 text-muted-foreground">{p.label}</span>
            <span className="font-mono">{formatMs(p.value)}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-3 border-t pt-2 text-xs font-medium">
          <span className="h-2.5 w-2.5" />
          <span className="w-40">{t("total")}</span>
          <span className="font-mono">{formatMs(timing.total)}</span>
        </div>
      </div>
    </div>
  );
}
