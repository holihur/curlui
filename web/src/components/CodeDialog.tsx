import { useEffect, useState } from "react";
import { Check, Code2, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { copyText } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { RequestDef } from "@/lib/types";

export function CodeDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestDef;
}) {
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .generateCurl(request)
      .then((r) => active && setCommand(r.command))
      .catch(() => active && setCommand("# failed to generate curl command"));
    return () => {
      active = false;
    };
  }, [open, request]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="h-4 w-4" /> {t("codeTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("codeDesc")} {t("codeDescVars")}
          </DialogDescription>
        </DialogHeader>

        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-xs">
          {command}
        </pre>

        <div className="flex justify-end">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={async () => {
              const ok = await copyText(command);
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
