import { useRef, useState } from "react";
import { Loader2, Network, Play, Radio, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "@/components/CodeEditor";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { cn, formatMs, prettyJSON } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/store";
import type { GrpcResult, GrpcService, KeyValue } from "@/lib/types";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function GrpcDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);

  const [target, setTarget] = useState("localhost:50051");
  const [plaintext, setPlaintext] = useState(true);
  const [id, setId] = useState("");
  const [services, setServices] = useState<GrpcService[]>([]);
  const [service, setService] = useState("");
  const [method, setMethod] = useState("");
  const [body, setBody] = useState("{}");
  const [metadata, setMetadata] = useState<KeyValue[]>([]);
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (err: unknown) =>
    toast({
      title: t("grpc"),
      description: err instanceof Error ? err.message : String(err),
      variant: "error",
    });

  const apply = (res: { id: string; services: GrpcService[] }) => {
    setId(res.id);
    setServices(res.services ?? []);
    const first = res.services?.[0];
    if (first) {
      setService(`${first.package ? first.package + "." : ""}${first.name}`);
      setMethod(first.methods?.[0]?.name ?? "");
    }
    toast({ title: t("grpc"), description: `${res.services?.length ?? 0} service(s)`, variant: "success" });
  };

  const importPb = async (file: File) => {
    setBusy(true);
    try {
      apply(await api.grpcDescriptor({ descriptor: toBase64(await file.arrayBuffer()), target, plaintext }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reflect = async () => {
    setBusy(true);
    try {
      apply(await api.grpcDescriptor({ reflect: true, target, plaintext, metadata }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const invoke = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.grpcCall({ id, target, service, method, body, plaintext, metadata }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const currentService = services.find(
    (s) => `${s.package ? s.package + "." : ""}${s.name}` === service,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" /> {t("grpc")}
          </DialogTitle>
          <DialogDescription>{t("grpcTarget")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("grpcTarget")}</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="localhost:50051"
              className="h-9 font-mono text-xs"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
              <span>{t("grpcPlaintext")}</span>
              <Switch checked={plaintext} onCheckedChange={setPlaintext} />
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pb,.bin,application/octet-stream"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importPb(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {t("grpcImportPb")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void reflect()}>
              <Radio className="h-3.5 w-3.5" /> {t("grpcReflect")}
            </Button>
          </div>
        </div>

        {services.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            {t("grpcNoServices")}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("grpcService")}</Label>
                <Select value={service} onValueChange={setService}>
                  <SelectTrigger className="h-9 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => {
                      const full = `${s.package ? s.package + "." : ""}${s.name}`;
                      return (
                        <SelectItem key={full} value={full}>
                          {full}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("grpcMethod")}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-9 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(currentService?.methods ?? []).map((m) => (
                      <SelectItem key={m.name} value={m.name}>
                        {m.name}
                        {m.streaming ? " (stream)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("grpcMetadata")}</Label>
              <KeyValueEditor items={metadata} onChange={setMetadata} showDescription />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Request JSON</Label>
                <Button
                  size="sm"
                  className="ml-auto gap-1.5"
                  disabled={busy || !id || !service || !method}
                  onClick={() => void invoke()}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t("grpcInvoke")}
                </Button>
              </div>
              <CodeEditor
                value={body}
                onChange={setBody}
                language="json"
                className="min-h-[120px]"
                placeholder={'{\n  "name": "curlui"\n}'}
              />
            </div>

            {result && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 font-mono font-medium",
                      result.code === "OK" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
                    )}
                  >
                    {result.code}
                  </span>
                  {result.message && <span className="text-red-400">{result.message}</span>}
                  <span className="ml-auto text-muted-foreground">{formatMs(result.duration)}</span>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-[11px]">
                  {prettyJSON(result.response) || result.response}
                </pre>
                {result.trailers && Object.keys(result.trailers).length > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    trailers:{" "}
                    {Object.entries(result.trailers)
                      .map(([k, v]) => `${k}=${v.join(",")}`)
                      .join("  ")}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
