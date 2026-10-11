import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
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
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";
import type { CollectionNode } from "@/lib/types";

type Format = "markdown" | "html" | "word" | "pdf";

const EXT: Record<Format, string> = { markdown: "md", html: "html", word: "doc", pdf: "pdf" };

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPreview(null);
      setBusy(false);
    }
  }, [open]);

  const url = (fmt: Format) => {
    const p = new URLSearchParams({ format: fmt });
    if (node) p.set("id", node.id);
    if (template.trim()) p.set("template", template);
    return `/api/export/doc?${p.toString()}`;
  };

  const doPreview = async () => {
    if (format === "pdf") {
      setPreview("(PDF preview is not available — use Download)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url(format));
      setPreview(await res.text());
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

  const doDownload = async () => {
    setBusy(true);
    try {
      const res = await fetch(url(format));
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `curlui-docs.${EXT[format]}`;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> {t("exportDocs")}
            {node && <span className="text-muted-foreground">· {node.name}</span>}
          </DialogTitle>
          <DialogDescription>{t("docTemplateHint")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[180px_1fr] gap-3">
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
            <Button variant="outline" className="mt-1 gap-1.5" onClick={() => void doPreview()} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("docPreview")}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("docTemplate")}</label>
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={"# {{.Title}}\n{{range .Requests}}\n## {{.Name}}\n`{{.Method}} {{.URL}}`\n{{end}}"}
              className="min-h-[140px] font-mono text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {preview !== null && (
          <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-[11px]">
            {preview}
          </pre>
        )}

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
