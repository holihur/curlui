import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";
import { AIChatPanel } from "@/components/AIChatPanel";
import { useI18n } from "@/lib/i18n";

// AIChatDialog is the floating variant of the assistant; the right sidebar
// renders the very same AIChatPanel.
export function AIChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(96vw,760px)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t("aiChat")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <AIChatPanel />
      </DialogContent>
    </Dialog>
  );
}
