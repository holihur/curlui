import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Eye, FileCode2, FileText, Loader2 } from "lucide-react";
import { marked } from "marked";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { CollectionNode } from "@/lib/types";

type Format = "markdown" | "html" | "word" | "pdf";

const EXT: Record<Format, string> = { markdown: "md", html: "html", word: "doc", pdf: "pdf" };

// The PDF preview (pdf.js) only exists in the full build. When the flag is a
// literal false the whole chunk is dropped by the bundler.
const PdfPreview = __PDF_PREVIEW__
  ? lazy(() => import("@/components/PdfPreview").then((m) => ({ default: m.PdfPreview })))
  : null;

// A small, readable stylesheet for the rendered Markdown/HTML preview frame.
const FRAME_CSS = `
  :root { color-scheme: light; }
  body { margin:0; padding:16px 20px; background:#fff; color:#1f2328;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  h1,h2,h3 { line-height:1.25; margin:1.2em 0 .5em; }
  h1 { font-size:1.7em; border-bottom:1px solid #d8dee4; padding-bottom:.3em; }
  h2 { font-size:1.35em; border-bottom:1px solid #d8dee4; padding-bottom:.25em; }
  code { background:#f0f1f3; border-radius:4px; padding:.15em .35em; font-size:.9em;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre { background:#f6f8fa; border-radius:6px; padding:12px; overflow:auto; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; margin:.6em 0; }
  th,td { border:1px solid #d8dee4; padding:6px 10px; text-align:left; }
  th { background:#f6f8fa; }
  blockquote { margin:.6em 0; padding:0 1em; color:#57606a; border-left:4px solid #d0d7de; }
  a { color:#0969da; }
`;

export function DocExportDialog({
  open,
  onOpenChange,
  node,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: CollectionNode | null;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const hasPdf = useStore((s) => s.features.pdf !== false);
  const [format, setFormat] = useState<Format>("markdown");
  const [template, setTemplate] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = useCallback(
    (fmt: Format) => {
      const p = new URLSearchParams({ format: fmt });
      if (node) p.set("id", node.id);
      if (template.trim()) p.set("template", template);
      return `/api/export/doc?${p.toString()}`;
    },
    [node, template],
  );

  const doPreview = useCallback(async () => {
    if (format === "pdf") {
      setPreview(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url(format));
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      setPreview(text);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [format, url, toast, t]);

  // Refresh the preview whenever the dialog opens or the selection changes.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setSource(false);
      return;
    }
    void doPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, node?.id]);

  const frameDoc = useMemo(() => {
    if (preview === null) return "";
    if (format === "markdown") {
      const html = marked.parse(preview, { async: false }) as string;
      return `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`;
    }
    // HTML and Word (.doc) are already HTML documents.
    return preview;
  }, [preview, format]);

  const doDownload = async () => {
    setBusy(true);
    try {
      const res = await fetch(url(format));
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${node ? node.name : "curlui-docs"}.${EXT[format]}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast({
        title: t("requestFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const canToggleSource = format !== "pdf";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] w-[min(96vw,1000px)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> {t("exportDocs")}
            {node && <span className="text-muted-foreground">· {node.name}</span>}
          </DialogTitle>
          <DialogDescription>{t("docTemplateHint")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[200px_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("docFormat")}</label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="markdown">Markdown (.md)</SelectItem>
                <SelectItem value="html">HTML (.html)</SelectItem>
                <SelectItem value="word">Word (.doc)</SelectItem>
                {hasPdf && <SelectItem value="pdf">PDF (.pdf)</SelectItem>}
              </SelectContent>
            </Select>
            <div className="mt-1 flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 gap-1.5"
                onClick={() => void doPreview()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                {t("docPreview")}
              </Button>
              {canToggleSource && (
                <Button
                  variant={source ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 gap-1"
                  title={source ? t("docRendered") : t("docSource")}
                  onClick={() => setSource(!source)}
                >
                  {source ? <Eye className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("docTemplate")}</label>
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={"# {{.Title}}\n{{range .Requests}}\n## {{.Name}}\n`{{.Method}} {{.URL}}`\n{{end}}"}
              className="min-h-[120px] font-mono text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {format === "pdf" ? (
            PdfPreview ? (
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("loading")}
                  </div>
                }
              >
                <PdfPreview url={url("pdf")} />
              </Suspense>
            ) : (
              <pre className="flex-1 overflow-auto rounded-md border bg-background p-3 text-[11px] text-muted-foreground">
                {t("docPdfUnavailable")}
              </pre>
            )
          ) : source || preview === null ? (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-[11px]">
              {preview ?? ""}
            </pre>
          ) : (
            <iframe
              title="doc-preview"
              sandbox=""
              srcDoc={frameDoc}
              className={cn("min-h-0 flex-1 rounded-md border bg-white")}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button className="gap-1.5" onClick={() => void doDownload()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("downloadDoc")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
