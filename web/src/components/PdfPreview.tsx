import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// PdfPreview renders a PDF in the browser with pdf.js. It is only imported in
// the full build (the core build drops this chunk entirely).
export function PdfPreview({ url }: { url: string }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const task = pdfjs.getDocument({ url });
    taskRef.current = task;
    task.promise
      .then((doc) => {
        if (cancelled) return;
        docRef.current = doc;
        setPages(doc.numPages);
        setPage(1);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
      void taskRef.current?.destroy();
      taskRef.current = null;
      docRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pages) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(page);
        const viewport = p.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await p.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pages, scale]);

  if (error) {
    return <div className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</div>;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {page} / {pages || "?"}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          disabled={page >= pages}
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-[10px] text-muted-foreground">{t("docPdfPreview")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
        <canvas ref={canvasRef} className="mx-auto block bg-white shadow" />
      </div>
    </div>
  );
}
