import { useEffect, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
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
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/store";

const EXAMPLE = `curl 'https://httpbin.org/post' \\
  -H 'Content-Type: application/json' \\
  -d '{"hello":"world"}'`;

export function ImportCurlDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const openRequest = useStore((s) => s.openRequest);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (open) {
      setCommand("");
      setError(null);
    }
  }, [open]);

  const doImport = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = await api.parseCurl(command);
      openRequest(parsed);
      toast({ title: t("importedCurl"), variant: "success" });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-4 w-4" /> {t("importCurlTitle")}
          </DialogTitle>
          <DialogDescription>{t("importCurlDesc")}</DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={EXAMPLE}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void doImport();
          }}
          className="min-h-[180px] font-mono text-xs"
          spellCheck={false}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void doImport()} disabled={loading || !command.trim()}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
