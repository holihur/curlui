import { useRef, useState } from "react";
import { Link2, Loader2, Upload, FileJson2, ChevronLeft, Check } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { CollectionNode, OpenAPIResult } from "@/lib/types";

type Step = "source" | "preview";

export function OpenAPIDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const refreshCollections = useStore((s) => s.refreshCollections);
  const selectedFolderId = useStore((s) => s.selectedFolderId);

  const [step, setStep] = useState<Step>("source");
  const [mode, setMode] = useState<"url" | "paste">("url");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpenAPIResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("source");
    setError(null);
    setResult(null);
    setLoading(false);
    setImporting(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const doFetch = async () => {
    if (mode === "url" && !url.trim()) {
      setError(t("urlRequired"));
      return;
    }
    if (mode === "paste" && !content.trim()) {
      setError(t("contentRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.parseOpenAPI(
        mode === "url" ? { url: url.trim() } : { content },
      );
      if (res.endpoints === 0) {
        setError(t("nothingHere"));
      } else {
        setResult(res);
        setStep("preview");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const doImport = async () => {
    if (!result) return;
    setImporting(true);
    try {
      const { count } = await api.importCollections(selectedFolderId ?? "", result.collections);
      await refreshCollections();
      toast({ title: t("openapiImported", { n: count }), variant: "success" });
      handleOpenChange(false);
    } catch (err) {
      toast({
        title: t("couldNotSave"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setImporting(false);
    }
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setContent(text);
    setMode("paste");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson2 className="h-4 w-4" /> {t("openapiTitle")}
          </DialogTitle>
          <DialogDescription>{t("openapiDesc")}</DialogDescription>
        </DialogHeader>

        {step === "source" && (
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "url" | "paste")}>
              <TabsList className="w-full">
                <TabsTrigger value="url" className="flex-1 gap-1.5">
                  <Link2 className="h-3.5 w-3.5" /> {t("fromUrl")}
                </TabsTrigger>
                <TabsTrigger value="paste" className="flex-1 gap-1.5">
                  <Upload className="h-3.5 w-3.5" /> {t("paste")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url" className="mt-3">
                <Input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doFetch()}
                  placeholder={t("specUrlPlaceholder")}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t("openapiHint")}</p>
              </TabsContent>

              <TabsContent value="paste" className="mt-3">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("pastePlaceholder")}
                  className="min-h-[160px] font-mono text-xs"
                  spellCheck={false}
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,.yaml,.yml,application/json,text/yaml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f);
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> {t("chooseFile")}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{t("openapiHint")}</span>
                </div>
              </TabsContent>
            </Tabs>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={() => void doFetch()} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? t("specLoading") : t("preview")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "preview" && result && (
          <>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{result.title}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {result.baseUrl}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    {result.specType}
                  </span>
                  {result.version && (
                    <span className="text-[11px] text-muted-foreground">v{result.version}</span>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {t("endpointsCount", { n: result.endpoints })}
              </div>
            </div>

            <div className="max-h-[42vh] overflow-y-auto rounded-lg border">
              <EndpointList nodes={result.collections} />
            </div>

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("source")}>
                <ChevronLeft className="h-4 w-4" /> {t("back")}
              </Button>
              <Button onClick={() => void doImport()} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("addToCollections")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EndpointList({ nodes, depth = 0 }: { nodes: CollectionNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((n) =>
        n.type === "request" && n.request ? (
          <div
            key={n.id}
            className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-0"
            style={{ paddingLeft: depth * 14 + 12 }}
          >
            <span className={cn("w-14 shrink-0 text-[10px] font-semibold", `method-${n.request.method}`)}>
              {n.request.method}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{n.request.url}</span>
          </div>
        ) : (
          <div key={n.id}>
            <div
              className="bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground"
              style={{ paddingLeft: depth * 14 + 12 }}
            >
              {n.name}
            </div>
            {n.children && <EndpointList nodes={n.children} depth={depth + 1} />}
          </div>
        ),
      )}
    </>
  );
}
